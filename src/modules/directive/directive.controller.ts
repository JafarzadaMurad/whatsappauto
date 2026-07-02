import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { getWorkspaceId } from '../../lib/workspace-context';
import { AiService } from '../agent/ai.service';
import { sessions } from '../whatsapp/instance.manager';
import { io } from '../../server';
import { logger } from '../../utils/logger';

const chatSendSchema = z.object({
    clientId: z.string().uuid(),
    agentId: z.string().uuid(),
    text: z.string().min(1).max(3000),
});

const createSchema = z.object({
    clientId: z.string().uuid(),
    agentId: z.string().uuid(),
    text: z.string().min(1).max(2000),
    persistent: z.boolean().optional(),
    source: z.enum(['chat', 'quick_action']).optional(),
    triggerNow: z.boolean().optional(),
});

async function ownsClient(clientId: string, workspaceId: string) {
    return prisma.client.findFirst({ where: { id: clientId, workspaceId }, select: { id: true } });
}
async function ownsAgent(agentId: string, workspaceId: string) {
    return prisma.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } });
}

export class DirectiveController {
    // GET /api/directives/by-contact?accountId=<instanceId>&phone=<digits>
    //
    // One-shot endpoint the inbox panel uses to set itself up: it
    // resolves which agent is actually handling this contact (sticky
    // assignment > instance.agent > instance.routerAgent), looks up
    // the Client row, and returns the active directives list in the
    // same payload — saves the panel a roundtrip on open.
    async byContact(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const accountId = String(req.query.accountId || '');
            const phone = String(req.query.phone || '').replace(/[^0-9]/g, '');
            if (!accountId || !phone) return res.status(400).json({ success: false, message: 'accountId and phone are required' });

            // The accountId can be either a WhatsApp Instance.id or an
            // InstagramAccount.id — both are UUIDs, unique across
            // tables. Try each in turn so the panel loads for either
            // channel's conversations.
            const instance = await prisma.instance.findFirst({
                where: { id: accountId, workspaceId },
                select: {
                    id: true, agentId: true, routerAgentId: true,
                    agent: { select: { id: true, name: true } },
                    routerAgent: { select: { id: true, name: true } },
                },
            });
            const igAccount = instance ? null : await prisma.instagramAccount.findFirst({
                where: { id: accountId, workspaceId },
                select: {
                    id: true, agentId: true, routerAgentId: true,
                    agent: { select: { id: true, name: true } },
                    routerAgent: { select: { id: true, name: true } },
                },
            });
            if (!instance && !igAccount) return res.status(404).json({ success: false, message: 'Account not found' });

            let client = await prisma.client.findFirst({
                where: { workspaceId, phone },
                select: { id: true, assignedAgentId: true, assignedAgent: { select: { id: true, name: true } } },
            });

            // Panel is opened on an existing conversation → the contact
            // is real by construction. If the CRM row somehow wasn't
            // created earlier (legacy IG DMs that landed before
            // upsertCrmContact was wired for IG, workspaceId drift on
            // the InstagramAccount, or a WA thread that skipped
            // upsert), lazy-create it here so operators aren't blocked
            // from steering the agent. Channel + userId + sourceLabel
            // come from whichever account matched.
            if (!client) {
                const { upsertCrmContact } = await import('../client/client.service');
                const channel: 'whatsapp' | 'instagram' = igAccount ? 'instagram' : 'whatsapp';
                const userId = (instance?.agent as any)?.userId
                    || (igAccount?.agent as any)?.userId
                    || (await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } }))?.ownerId
                    || '';
                if (userId) {
                    const created = await upsertCrmContact({
                        userId,
                        workspaceId,
                        phone,
                        name: null,
                        channel,
                        sourceLabel: null,
                    }).catch(() => null);
                    if (created) {
                        client = await prisma.client.findUnique({
                            where: { id: created.id },
                            select: { id: true, assignedAgentId: true, assignedAgent: { select: { id: true, name: true } } },
                        });
                    }
                }
            }

            const primaryAgent = instance?.agent || igAccount?.agent || null;
            const routerAgent = instance?.routerAgent || igAccount?.routerAgent || null;
            const resolved =
                (client?.assignedAgent ? { id: client.assignedAgent.id, name: client.assignedAgent.name } : null)
                || (primaryAgent ? { id: primaryAgent.id, name: primaryAgent.name } : null)
                || (routerAgent ? { id: routerAgent.id, name: routerAgent.name } : null);

            const directives = client && resolved ? await prisma.operatorDirective.findMany({
                where: { clientId: client.id, agentId: resolved.id, workspaceId, consumedAt: null },
                orderBy: { createdAt: 'asc' },
                take: 50,
            }) : [];

            const chatHistory = client && resolved ? await prisma.agentChatMessage.findMany({
                where: { clientId: client.id, agentId: resolved.id, workspaceId },
                orderBy: { createdAt: 'asc' },
                take: 200,
            }) : [];

            return res.json({
                success: true,
                clientId: client?.id || null,
                agentId: resolved?.id || null,
                agentName: resolved?.name || null,
                directives,
                chatHistory,
            });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // GET /api/directives?clientId=...&agentId=...
    async list(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const clientId = String(req.query.clientId || '');
            const agentId = String(req.query.agentId || '');
            if (!clientId || !agentId) return res.status(400).json({ success: false, message: 'clientId and agentId are required' });
            if (!(await ownsClient(clientId, workspaceId))) return res.status(404).json({ success: false, message: 'Client not found' });
            if (!(await ownsAgent(agentId, workspaceId))) return res.status(404).json({ success: false, message: 'Agent not found' });

            const directives = await prisma.operatorDirective.findMany({
                where: { clientId, agentId, workspaceId },
                orderBy: { createdAt: 'desc' },
                take: 100,
            });
            return res.json({ success: true, directives });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // POST /api/directives
    async create(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const data = createSchema.parse(req.body);

            const client = await prisma.client.findFirst({
                where: { id: data.clientId, workspaceId },
                select: { id: true, phone: true },
            });
            if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
            if (!(await ownsAgent(data.agentId, workspaceId))) return res.status(404).json({ success: false, message: 'Agent not found' });

            const directive = await prisma.operatorDirective.create({
                data: {
                    workspaceId, clientId: data.clientId, agentId: data.agentId,
                    text: data.text,
                    persistent: data.persistent ?? true,
                    source: data.source ?? 'chat',
                    triggerNow: data.triggerNow ?? false,
                },
            });

            // Fire-and-forget: when the operator asked to "Run now", look
            // up the instance the contact is bound to and replay the
            // agent turn without waiting for the customer to message us
            // first. Errors are logged but don't block the HTTP response
            // — the directive itself is already saved either way.
            if (data.triggerNow) {
                (async () => {
                    try {
                        const inst = await prisma.instance.findFirst({
                            where: { agentId: data.agentId },
                            select: { id: true },
                        });
                        if (!inst) {
                            logger.warn({ agentId: data.agentId }, '[directive] triggerNow: no instance bound to agent');
                            return;
                        }
                        const sock = sessions.get(inst.id);
                        if (!sock) {
                            logger.warn({ instanceId: inst.id }, '[directive] triggerNow: instance not connected');
                            return;
                        }
                        const remoteJid = `${client.phone}@s.whatsapp.net`;
                        await AiService.handleIncomingMessage(inst.id, remoteJid, sock, io, { operatorTriggered: true } as any);
                    } catch (err: any) {
                        logger.warn({ err: err?.message }, '[directive] triggerNow run failed');
                    }
                })();
            }

            return res.json({ success: true, directive });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // GET /api/directives/chat?clientId=...&agentId=...
    async chatHistory(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const clientId = String(req.query.clientId || '');
            const agentId = String(req.query.agentId || '');
            if (!clientId || !agentId) return res.status(400).json({ success: false, message: 'clientId and agentId are required' });
            if (!(await ownsClient(clientId, workspaceId))) return res.status(404).json({ success: false, message: 'Client not found' });
            if (!(await ownsAgent(agentId, workspaceId))) return res.status(404).json({ success: false, message: 'Agent not found' });

            const messages = await prisma.agentChatMessage.findMany({
                where: { clientId, agentId, workspaceId },
                orderBy: { createdAt: 'asc' },
                take: 200,
            });
            return res.json({ success: true, messages });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // POST /api/directives/chat  — operator sends a turn, agent replies
    async chatSend(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const data = chatSendSchema.parse(req.body);
            if (!(await ownsClient(data.clientId, workspaceId))) return res.status(404).json({ success: false, message: 'Client not found' });
            if (!(await ownsAgent(data.agentId, workspaceId))) return res.status(404).json({ success: false, message: 'Agent not found' });

            const { reply, toolCalls } = await AiService.handleOperatorChat({
                clientId: data.clientId, agentId: data.agentId, workspaceId, text: data.text,
            });

            // Return the trailing two turns the panel needs to render
            // immediately — frontend doesn't have to re-fetch history.
            const tail = await prisma.agentChatMessage.findMany({
                where: { clientId: data.clientId, agentId: data.agentId, workspaceId },
                orderBy: { createdAt: 'desc' },
                take: 2,
            });
            return res.json({ success: true, reply, toolCalls, messages: tail.reverse() });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            logger.error({ err: e?.message }, '[directive] chatSend failed');
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // DELETE /api/directives/:id  (clears a persistent directive)
    async remove(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = String(req.params.id);
            const row = await prisma.operatorDirective.findFirst({ where: { id, workspaceId }, select: { id: true } });
            if (!row) return res.status(404).json({ success: false, message: 'Directive not found' });
            await prisma.operatorDirective.delete({ where: { id } });
            return res.json({ success: true });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }
}

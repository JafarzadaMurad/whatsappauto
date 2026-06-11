import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { buildTemplateExecutor, sanitizeName, type HttpToolTemplate, AiService } from './ai.service';
import { sendIgMessage } from '../instagram/instagram.ai.service';
import { checkPlanLimit, PlanLimitError } from '../../lib/plan-limits';
import { getWorkspaceId } from '../../lib/workspace-context';

const valueSpecSchema = z.union([
    z.object({ mode: z.literal('fixed'), value: z.string() }),
    z.object({ mode: z.literal('ai'), description: z.string() })
]);

const nameValueSchema = z.object({
    name: z.string(),
    value: valueSpecSchema
});

const httpToolTemplateSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().default(''),
    inputMode: z.enum(['form', 'raw']).optional(),
    rawRequest: z.string().optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    url: valueSpecSchema,
    auth: z.union([
        z.object({ type: z.literal('none') }),
        z.object({ type: z.literal('bearer'), token: z.string() }),
        z.object({ type: z.literal('basic'), username: z.string(), password: z.string() })
    ]).optional(),
    queryParams: z.array(nameValueSchema).optional(),
    headers: z.array(nameValueSchema).optional(),
    bodyType: z.enum(['none', 'json', 'raw']).optional(),
    bodyParams: z.array(nameValueSchema).optional(),
    rawBody: valueSpecSchema.optional()
});

const createAgentSchema = z.object({
    name: z.string().min(1),
    providerId: z.string().uuid(),
    model: z.string().min(1),
    systemPrompt: z.string().optional(),
    allowedTableIds: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    allowedUrls: z.array(z.string()).optional(),
    httpTools: z.array(httpToolTemplateSchema).optional(),
    skillPrompts: z.record(z.string(), z.string()).optional(),
    isActive: z.boolean().optional()
});

export class AgentController {
    async getAgents(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const agents = await prisma.agent.findMany({
                where: { workspaceId },
                include: { provider: true, instances: true },
                orderBy: { createdAt: 'desc' }
            });
            return res.json({ success: true, agents });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getAgent(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const agent = await prisma.agent.findFirst({
                where: { id, workspaceId },
                include: { provider: true, instances: true }
            });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });
            return res.json({ success: true, agent });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async createAgent(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const data = createAgentSchema.parse(req.body);

            await checkPlanLimit(userId, 'agent');

            // Verify provider belongs to workspace
            const provider = await prisma.aiProvider.findFirst({ where: { id: data.providerId, workspaceId } });
            if (!provider) return res.status(404).json({ success: false, message: 'Invalid AI Provider' });

            const agent = await prisma.agent.create({
                data: {
                    userId,
                    workspaceId,
                    name: data.name,
                    providerId: data.providerId,
                    model: data.model,
                    systemPrompt: data.systemPrompt || "",
                    allowedTableIds: data.allowedTableIds || [],
                    skills: data.skills || [],
                    allowedUrls: data.allowedUrls || [],
                    httpTools: (data.httpTools || []) as any,
                    skillPrompts: (data.skillPrompts || {}) as any
                }
            });

            return res.status(201).json({ success: true, agent });
        } catch (error: any) {
            if (error instanceof PlanLimitError) return res.status(403).json({ success: false, message: error.message, code: error.code });
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateAgent(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const data = createAgentSchema.parse(req.body);

            const existing = await prisma.agent.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Agent not found' });

            const agent = await prisma.agent.update({
                where: { id },
                data: {
                    name: data.name,
                    provider: { connect: { id: data.providerId } },
                    model: data.model,
                    systemPrompt: data.systemPrompt,
                    allowedTableIds: data.allowedTableIds || [],
                    skills: data.skills || [],
                    allowedUrls: data.allowedUrls || [],
                    httpTools: (data.httpTools || []) as any,
                    skillPrompts: (data.skillPrompts || {}) as any,
                    ...(data.isActive !== undefined ? { isActive: data.isActive } : {})
                }
            });

            return res.json({ success: true, agent });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async deleteAgent(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const force = String(req.query.force || '') === 'true';

            const existing = await prisma.agent.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Agent not found' });

            // Check campaigns linked to this agent.
            const campaigns = await prisma.campaign.findMany({
                where: { agentId: id },
                select: { id: true, name: true, status: true },
            });

            if (campaigns.length > 0 && !force) {
                return res.status(409).json({
                    success: false,
                    requiresConfirmation: true,
                    campaigns,
                    message: `${campaigns.length} campaign(s) use this agent. They will stay but their agent will show as "deleted".`,
                });
            }

            await prisma.agent.delete({ where: { id } });
            return res.json({
                success: true,
                message: 'Agent deleted',
                orphanedCampaigns: campaigns.length,
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getConversations(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const agent = await prisma.agent.findFirst({ where: { id, workspaceId } });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

            const logs = await prisma.aiConversationLog.findMany({
                where: { agentId: id },
                orderBy: { createdAt: 'desc' }
            });

            // Group by remoteJid
            const grouped: Record<string, any> = {};
            for (const log of logs) {
                if (!grouped[log.remoteJid]) {
                    grouped[log.remoteJid] = {
                        remoteJid: log.remoteJid,
                        messageCount: 0,
                        totalTokens: 0,
                        lastMessageAt: log.createdAt,
                    };
                }
                grouped[log.remoteJid].messageCount++;
                grouped[log.remoteJid].totalTokens += log.totalTokens;
            }

            // Enrich Instagram conversations with cached contact profiles
            const igSenderIds = Object.keys(grouped)
                .filter(j => j.startsWith('ig:'))
                .map(j => j.slice(3));
            if (igSenderIds.length > 0) {
                const contacts = await prisma.instagramContact.findMany({
                    where: { senderId: { in: igSenderIds } }
                });
                const bySender: Record<string, any> = {};
                for (const c of contacts) bySender[c.senderId] = c;
                for (const jid of Object.keys(grouped)) {
                    if (!jid.startsWith('ig:')) continue;
                    const c = bySender[jid.slice(3)];
                    grouped[jid].platform = 'instagram';
                    grouped[jid].username = c?.username || null;
                    grouped[jid].name = c?.name || null;
                    grouped[jid].profilePic = c?.profilePic || null;
                    grouped[jid].lastInboundAt = c?.lastMessageAt || null;
                }
            }

            return res.json({ success: true, conversations: Object.values(grouped) });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getConversationMessages(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const remoteJid = req.query.remoteJid as string;

            if (!remoteJid) return res.status(400).json({ success: false, message: 'remoteJid required' });

            const agent = await prisma.agent.findFirst({ where: { id, workspaceId } });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

            const messages = await prisma.aiConversationLog.findMany({
                where: { agentId: id, remoteJid },
                orderBy: { createdAt: 'asc' }
            });

            return res.json({ success: true, messages });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getTokenStats(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const agent = await prisma.agent.findFirst({ where: { id, workspaceId } });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

            const logs = await prisma.aiConversationLog.findMany({
                where: { agentId: id },
                select: { provider: true, model: true, promptTokens: true, completionTokens: true, totalTokens: true }
            });

            // Group by provider + model
            const statsMap: Record<string, any> = {};
            for (const log of logs) {
                const key = `${log.provider}:${log.model}`;
                if (!statsMap[key]) {
                    statsMap[key] = { provider: log.provider, model: log.model, promptTokens: 0, completionTokens: 0, totalTokens: 0, requestCount: 0 };
                }
                statsMap[key].promptTokens += log.promptTokens;
                statsMap[key].completionTokens += log.completionTokens;
                statsMap[key].totalTokens += log.totalTokens;
                statsMap[key].requestCount++;
            }

            const stats = Object.values(statsMap);
            const totals = {
                promptTokens: stats.reduce((s: number, x: any) => s + x.promptTokens, 0),
                completionTokens: stats.reduce((s: number, x: any) => s + x.completionTokens, 0),
                totalTokens: stats.reduce((s: number, x: any) => s + x.totalTokens, 0),
                requestCount: stats.reduce((s: number, x: any) => s + x.requestCount, 0),
            };

            return res.json({ success: true, stats, totals });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Rich activity log for the Agent → Activity tab. Returns recent
    // turns with full tool-call detail (args + redacted results).
    // Auto-pruned to 3 days by activity-cleanup.
    async getActivity(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const agent = await prisma.agent.findFirst({ where: { id, workspaceId } });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

            const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
            const beforeRaw = req.query.before as string | undefined;
            const before = beforeRaw ? new Date(beforeRaw) : null;
            const onlyToolErrors = req.query.onlyErrors === 'true';

            const rows = await prisma.agentActivityLog.findMany({
                where: {
                    agentId: id,
                    ...(before ? { createdAt: { lt: before } } : {}),
                },
                orderBy: { createdAt: 'desc' },
                take: limit + 1,
            });

            const hasMore = rows.length > limit;
            let page = rows.slice(0, limit);

            if (onlyToolErrors) {
                page = page.filter(r => {
                    const calls = Array.isArray(r.toolCalls) ? (r.toolCalls as any[]) : [];
                    return calls.some(c => c && c.ok === false);
                });
            }

            return res.json({ success: true, items: page, hasMore });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async testHttpTool(req: Request, res: Response) {
        try {
            const schema = z.object({
                template: httpToolTemplateSchema,
                aiValues: z.record(z.string(), z.string()).optional()
            });
            const { template, aiValues } = schema.parse(req.body);

            // Map UI aiValues (keyed by raw param name) -> executor arg shape
            // (executor expects keys like `query_<sanitized>`, `header_<sanitized>`, `body_<sanitized>`, `url`, `body`)
            const args: Record<string, string> = {};

            // Raw mode: aiValues are already keyed as ai_0, ai_1, ... matching parser output
            if (template.inputMode === 'raw') {
                Object.assign(args, aiValues || {});
                const executor = buildTemplateExecutor(template as HttpToolTemplate);
                const result = await executor(args);
                return res.json({ success: true, result });
            }

            if (template.url.mode === 'ai' && aiValues?.url !== undefined) args.url = aiValues.url;
            (template.queryParams || []).forEach((p, i) => {
                if (p.value.mode === 'ai') {
                    const key = `query_${sanitizeName(p.name, `p${i}`)}`;
                    args[key] = aiValues?.[`query.${p.name}`] ?? '';
                }
            });
            (template.headers || []).forEach((h, i) => {
                if (h.value.mode === 'ai') {
                    const key = `header_${sanitizeName(h.name, `h${i}`)}`;
                    args[key] = aiValues?.[`header.${h.name}`] ?? '';
                }
            });
            if (template.bodyType === 'json') {
                (template.bodyParams || []).forEach((b, i) => {
                    if (b.value.mode === 'ai') {
                        const key = `body_${sanitizeName(b.name, `b${i}`)}`;
                        args[key] = aiValues?.[`body.${b.name}`] ?? '';
                    }
                });
            } else if (template.bodyType === 'raw' && template.rawBody?.mode === 'ai') {
                args.body = aiValues?.body ?? '';
            }

            const executor = buildTemplateExecutor(template as HttpToolTemplate);
            const result = await executor(args);
            return res.json({ success: true, result });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Send a manual reply into a conversation (currently Instagram only)
    // Ephemeral test conversation. Pick a real CRM contact, run a turn
    // as if you were them. Read-only: nothing is saved to message logs;
    // CRM-mutating tools are stubbed (HTTP tools still fire so external
    // integrations like Bitrix can be validated).
    async testAsContact(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const schema = z.object({
                contactPhone: z.string().min(3).max(50),
                userMessage: z.string().min(1).max(4000),
                sessionMessages: z.array(z.object({
                    role: z.enum(['user', 'assistant']),
                    content: z.string(),
                })).max(100).optional().default([]),
            });
            const { contactPhone, userMessage, sessionMessages } = schema.parse(req.body);

            const agent = await prisma.agent.findFirst({
                where: { id, workspaceId },
                include: { provider: true },
            });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });
            if (!agent.provider) return res.status(400).json({ success: false, message: 'Agent has no AI provider configured' });

            const result = await AiService.runTestTurn({
                agent, workspaceId,
                contactPhone, sessionMessages, userMessage,
            });

            return res.json({ success: true, ...result });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async replyToConversation(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const schema = z.object({
                remoteJid: z.string().min(1),
                text: z.string().min(1).max(950)
            });
            const { remoteJid, text } = schema.parse(req.body);

            const agent = await prisma.agent.findFirst({ where: { id, workspaceId } });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

            if (!remoteJid.startsWith('ig:')) {
                return res.status(400).json({ success: false, message: 'Manual reply is currently supported for Instagram conversations only' });
            }

            const senderId = remoteJid.slice(3);
            const account = await prisma.instagramAccount.findFirst({
                where: { agentId: id, workspaceId }
            });
            if (!account) return res.status(400).json({ success: false, message: 'No Instagram account linked to this agent' });

            try {
                await sendIgMessage(account.igUserId, senderId, text, account.accessToken);
            } catch (e: any) {
                const ig = e.response?.data?.error;
                return res.status(502).json({
                    success: false,
                    message: ig?.error_user_msg || ig?.message || e.message,
                    igCode: ig?.code
                });
            }

            // Record the manual reply so it appears in the conversation thread
            const log = await prisma.aiConversationLog.create({
                data: {
                    agentId: id, instanceId: account.id, remoteJid,
                    userMessage: '', agentReply: text,
                    promptTokens: 0, completionTokens: 0, totalTokens: 0,
                    provider: 'MANUAL', model: 'manual',
                    toolCalls: []
                }
            });

            return res.json({ success: true, message: log });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

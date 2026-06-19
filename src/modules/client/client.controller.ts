import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { getWorkspaceId } from '../../lib/workspace-context';

const updateClientSchema = z.object({
    name: z.string().nullable().optional(),
    status: z.string().optional(),
    tags: z.array(z.string()).optional(),
    summary: z.string().nullable().optional(),
    customFields: z.record(z.string(), z.any()).optional(),
    agentPaused: z.boolean().optional(),
});

const pauseSchema = z.object({
    phone: z.string().min(1),
    channel: z.enum(['whatsapp', 'instagram']).optional(),
    paused: z.boolean(),
});

export class ClientController {
    async getClients(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const page = Math.max(1, Number(req.query.page) || 1);
            const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
            const search = String(req.query.search || '').trim();

            const where: any = { workspaceId };
            if (search) {
                where.OR = [
                    { name:  { contains: search, mode: 'insensitive' } },
                    { phone: { contains: search } },
                ];
            }
            const [total, clients] = await Promise.all([
                prisma.client.count({ where }),
                prisma.client.findMany({
                    where,
                    orderBy: { updatedAt: 'desc' },
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                }),
            ]);
            return res.json({
                success: true,
                clients,
                pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getClient(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const client = await prisma.client.findFirst({
                where: { id, workspaceId }
            });
            if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
            return res.json({ success: true, client });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateClient(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const data = updateClientSchema.parse(req.body);

            const existing = await prisma.client.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Client not found' });

            const updateData: any = {};
            if (data.name !== undefined) updateData.name = data.name;
            if (data.status !== undefined) updateData.status = data.status;
            if (data.tags !== undefined) updateData.tags = data.tags;
            if (data.summary !== undefined) updateData.summary = data.summary;
            if (data.customFields !== undefined) updateData.customFields = data.customFields;
            if (data.agentPaused !== undefined) {
                updateData.agentPaused = data.agentPaused;
                updateData.pausedAt = data.agentPaused ? new Date() : null;
            }

            const client = await prisma.client.update({
                where: { id },
                data: updateData
            });

            return res.json({ success: true, client });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Pause / resume the agent for a contact identified by phone (or IGSID).
    // Used by the chat UI which has the contact's identifier but not always
    // the Client.id — we upsert so that flipping the toggle creates the
    // CRM row on demand.
    async pauseByPhone(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const data = pauseSchema.parse(req.body);
            const cleanPhone = data.phone.replace(/[^0-9]/g, '') || data.phone;

            const existing = await prisma.client.findFirst({ where: { workspaceId, phone: cleanPhone } });
            const client = existing
                ? await prisma.client.update({
                    where: { id: existing.id },
                    data: { agentPaused: data.paused, pausedAt: data.paused ? new Date() : null },
                })
                : await prisma.client.create({
                    data: {
                        userId, workspaceId,
                        phone: cleanPhone,
                        status: 'NEW',
                        tags: [],
                        channel: data.channel || null,
                        agentPaused: data.paused,
                        pausedAt: data.paused ? new Date() : null,
                    },
                });

            return res.json({ success: true, client });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async deleteClient(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            // Purge mode wipes every trace of this contact (messages,
            // AI conversation logs, activity logs, baileys Contact row,
            // LID mappings) so the next inbound message starts a brand
            // new conversation with zero memory. Default true so the
            // contacts UI delete button does the obvious thing.
            const purge = req.query.purge !== 'false';

            const existing = await prisma.client.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Client not found' });

            const phone = existing.phone;
            let counters = { messages: 0, aiLogs: 0, activityLogs: 0, contacts: 0, lidMappings: 0 };

            if (purge) {
                // 1. Find every instance in this workspace — message rows
                //    are scoped per instance, so we only touch ours.
                const instances = await prisma.instance.findMany({
                    where: { workspaceId },
                    select: { id: true },
                });
                const instanceIds = instances.map(i => i.id);

                // 2. Build the full list of JIDs that could have carried
                //    this contact's traffic: the phone JID, the raw "phone"
                //    string as a LID-shaped JID (just in case), plus every
                //    LID that's already been mapped to this phone.
                const lidRows = instanceIds.length > 0
                    ? await prisma.lidMapping.findMany({
                        where: { instanceId: { in: instanceIds }, phone },
                        select: { lid: true },
                    })
                    : [];
                const jids = new Set<string>([
                    `${phone}@s.whatsapp.net`,
                    `${phone}@lid`,
                    `ig:${phone}`,
                    ...lidRows.map(r => r.lid),
                ]);
                const jidList = Array.from(jids);

                if (instanceIds.length > 0 && jidList.length > 0) {
                    const [msgRes, aiRes, actRes, contactRes] = await Promise.all([
                        prisma.message.deleteMany({
                            where: { instanceId: { in: instanceIds }, remoteJid: { in: jidList } },
                        }),
                        prisma.aiConversationLog.deleteMany({
                            where: { instanceId: { in: instanceIds }, remoteJid: { in: jidList } },
                        }),
                        prisma.agentActivityLog.deleteMany({
                            where: { instanceId: { in: instanceIds }, remoteJid: { in: jidList } },
                        }),
                        prisma.contact.deleteMany({
                            where: { instanceId: { in: instanceIds }, remoteJid: { in: jidList } },
                        }),
                    ]);
                    counters.messages = msgRes.count;
                    counters.aiLogs = aiRes.count;
                    counters.activityLogs = actRes.count;
                    counters.contacts = contactRes.count;
                }

                if (instanceIds.length > 0) {
                    const lidRes = await prisma.lidMapping.deleteMany({
                        where: { instanceId: { in: instanceIds }, phone },
                    });
                    counters.lidMappings = lidRes.count;
                }
            }

            await prisma.client.delete({ where: { id } });
            return res.json({ success: true, purged: purge, counters });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

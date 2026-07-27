import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { campaignQueue } from './campaign.queue';
import { getWorkspaceId } from '../../lib/workspace-context';

const createCampaignSchema = z.object({
    name: z.string().min(1),
    // Optional. Required only when mode='ai_compose' — a fixed-template
    // campaign doesn't call any LLM, so there's no reason to force the
    // user to pick an agent. Validated below.
    agentId: z.string().uuid().nullable().optional(),
    instanceId: z.string().uuid(),
    phoneNumbers: z.array(z.string().min(1)).min(1),

    // Optional advanced controls — all default to the previous
    // behaviour so existing callers keep working unchanged.
    mode: z.enum(['ai_compose', 'fixed_template']).default('ai_compose'),
    messageTemplate: z.string().max(4096).optional(),
    mediaUrl: z.string().url().max(2048).optional(),
    mediaType: z.enum(['image', 'video', 'document', 'audio']).optional(),
    minDelaySec: z.number().int().min(1).max(3600).default(10),
    maxDelaySec: z.number().int().min(1).max(3600).default(15),
    scheduledFor: z.string().datetime().nullable().optional(),
    skipExisting: z.boolean().default(false),
});

export class CampaignController {
    async getCampaigns(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const campaigns = await prisma.campaign.findMany({
                where: { workspaceId },
                include: {
                    agent: { select: { name: true } },
                    instance: { select: { name: true } },
                    _count: { select: { recipients: true } }
                },
                orderBy: { createdAt: 'desc' }
            });

            // Get recipient stats per campaign
            const result = await Promise.all(campaigns.map(async c => {
                const stats = await prisma.campaignRecipient.groupBy({
                    by: ['status'],
                    where: { campaignId: c.id },
                    _count: true
                });
                const statusCounts: Record<string, number> = {};
                stats.forEach(s => { statusCounts[s.status] = s._count; });
                return { ...c, statusCounts };
            }));

            return res.json({ success: true, campaigns: result });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getCampaign(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const campaign = await prisma.campaign.findFirst({
                where: { id, workspaceId },
                include: {
                    agent: { select: { name: true, model: true } },
                    instance: { select: { name: true, status: true } },
                    recipients: { orderBy: { createdAt: 'asc' } }
                }
            });

            if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });
            return res.json({ success: true, campaign });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async createCampaign(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const data = createCampaignSchema.parse(req.body);

            // AI-compose mode needs an agent; fixed_template doesn't
            // (no LLM call). Validate here rather than in the Zod
            // schema so we can give the user a plain-language reason.
            if (data.mode === 'ai_compose' && !data.agentId) {
                return res.status(400).json({ success: false, message: 'AI-composed campaigns need an agent. Pick one or switch to a fixed template.' });
            }
            // Verify agent (optional) and instance belong to workspace.
            const [agent, instance] = await Promise.all([
                data.agentId
                    ? prisma.agent.findFirst({ where: { id: data.agentId, workspaceId } })
                    : Promise.resolve(null),
                prisma.instance.findFirst({ where: { id: data.instanceId, workspaceId } })
            ]);
            if (data.agentId && !agent) return res.status(404).json({ success: false, message: 'Agent not found' });
            if (!instance) return res.status(404).json({ success: false, message: 'Instance not found' });

            // Validate pacing (min ≤ max) — a misconfig here would make
            // every message fire in the same 1 ms window on the worker.
            const minMs = Math.max(1000, data.minDelaySec * 1000);
            const maxMs = Math.max(minMs, data.maxDelaySec * 1000);

            // Fixed-template mode without a template is nonsensical.
            if (data.mode === 'fixed_template' && !data.messageTemplate?.trim()) {
                return res.status(400).json({ success: false, message: 'Fixed-template mode requires a message template.' });
            }
            // Media type is required when a media URL is supplied.
            if (data.mediaUrl && !data.mediaType) {
                return res.status(400).json({ success: false, message: 'mediaType is required when mediaUrl is set.' });
            }

            // Optionally skip numbers that already have a conversation
            // with this instance — avoids re-messaging existing customers.
            let filteredPhones = data.phoneNumbers.map(p => p.trim()).filter(Boolean);
            if (data.skipExisting) {
                const jids = filteredPhones.map(p => p.replace(/[^0-9]/g, '') + '@s.whatsapp.net');
                const existing = await prisma.message.findMany({
                    where: { instanceId: data.instanceId, remoteJid: { in: jids } },
                    select: { remoteJid: true },
                    distinct: ['remoteJid'],
                });
                const existingSet = new Set(existing.map(e => e.remoteJid));
                filteredPhones = filteredPhones.filter(p => !existingSet.has(p.replace(/[^0-9]/g, '') + '@s.whatsapp.net'));
            }
            if (filteredPhones.length === 0) {
                return res.status(400).json({ success: false, message: 'No recipients left after filtering.' });
            }

            const scheduledFor = data.scheduledFor ? new Date(data.scheduledFor) : null;
            const scheduledOffsetMs = scheduledFor && scheduledFor.getTime() > Date.now()
                ? scheduledFor.getTime() - Date.now()
                : 0;
            const startAsRunning = scheduledOffsetMs === 0;

            // Create campaign
            const campaign = await prisma.campaign.create({
                data: {
                    userId,
                    workspaceId,
                    agentId: data.agentId || null,
                    instanceId: data.instanceId,
                    name: data.name,
                    status: startAsRunning ? 'RUNNING' : 'PENDING',
                    mode: data.mode,
                    messageTemplate: data.messageTemplate || null,
                    mediaUrl: data.mediaUrl || null,
                    mediaType: data.mediaType || null,
                    minDelaySec: data.minDelaySec,
                    maxDelaySec: data.maxDelaySec,
                    scheduledFor,
                    skipExisting: data.skipExisting,
                },
            });

            // Create recipients
            const recipients = filteredPhones.map(phone => ({
                campaignId: campaign.id,
                phone,
                remoteJid: phone.replace(/[^0-9]/g, '') + '@s.whatsapp.net',
                status: 'PENDING'
            }));

            await prisma.campaignRecipient.createMany({ data: recipients });

            // Enqueue with staggered delays. Add the schedule offset to
            // the first job so scheduled campaigns don't fire until then.
            const created = await prisma.campaignRecipient.findMany({
                where: { campaignId: campaign.id }
            });

            for (let i = 0; i < created.length; i++) {
                const perMsg = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
                const delay = scheduledOffsetMs + (i * perMsg);
                await campaignQueue.add('send-outbound', {
                    recipientId: created[i].id,
                    campaignId: campaign.id,
                }, { delay, attempts: 2, backoff: { type: 'exponential', delay: 5000 } });
            }

            return res.status(201).json({ success: true, campaign, recipientCount: created.length });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async pauseCampaign(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const campaign = await prisma.campaign.findFirst({ where: { id, workspaceId } });
            if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

            await prisma.campaign.update({ where: { id }, data: { status: 'PAUSED' } });
            return res.json({ success: true, message: 'Campaign paused' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async resumeCampaign(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const campaign = await prisma.campaign.findFirst({ where: { id, workspaceId } });
            if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

            await prisma.campaign.update({ where: { id }, data: { status: 'RUNNING' } });

            // Re-enqueue pending recipients with the campaign's
            // configured delay window (defaults to 10-15 s if unset).
            const pending = await prisma.campaignRecipient.findMany({
                where: { campaignId: id, status: 'PENDING' }
            });
            const minMs = Math.max(1000, ((campaign as any).minDelaySec ?? 10) * 1000);
            const maxMs = Math.max(minMs, ((campaign as any).maxDelaySec ?? 15) * 1000);

            for (let i = 0; i < pending.length; i++) {
                const delay = i * (minMs + Math.floor(Math.random() * (maxMs - minMs + 1)));
                await campaignQueue.add('send-outbound', {
                    recipientId: pending[i].id,
                    campaignId: id,
                }, { delay, attempts: 2, backoff: { type: 'exponential', delay: 5000 } });
            }

            return res.json({ success: true, message: 'Campaign resumed' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async deleteCampaign(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const campaign = await prisma.campaign.findFirst({ where: { id, workspaceId } });
            if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

            await prisma.campaign.delete({ where: { id } });
            return res.json({ success: true, message: 'Campaign deleted' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { campaignQueue } from './campaign.queue';

const createCampaignSchema = z.object({
    name: z.string().min(1),
    agentId: z.string().uuid(),
    instanceId: z.string().uuid(),
    phoneNumbers: z.array(z.string().min(1)).min(1)
});

export class CampaignController {
    async getCampaigns(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const campaigns = await prisma.campaign.findMany({
                where: { userId },
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
            const userId = (req as any).user.id;
            const id = req.params.id as string;

            const campaign = await prisma.campaign.findFirst({
                where: { id, userId },
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
            const data = createCampaignSchema.parse(req.body);

            // Verify agent and instance belong to user
            const [agent, instance] = await Promise.all([
                prisma.agent.findFirst({ where: { id: data.agentId, userId } }),
                prisma.instance.findFirst({ where: { id: data.instanceId, userId } })
            ]);
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });
            if (!instance) return res.status(404).json({ success: false, message: 'Instance not found' });

            // Create campaign
            const campaign = await prisma.campaign.create({
                data: {
                    userId,
                    agentId: data.agentId,
                    instanceId: data.instanceId,
                    name: data.name,
                    status: 'RUNNING'
                }
            });

            // Create recipients
            const recipients = data.phoneNumbers.map(phone => ({
                campaignId: campaign.id,
                phone: phone.trim(),
                remoteJid: phone.trim().replace(/[^0-9]/g, '') + '@s.whatsapp.net',
                status: 'PENDING'
            }));

            await prisma.campaignRecipient.createMany({ data: recipients });

            // Enqueue with staggered delays (10-15s apart)
            const created = await prisma.campaignRecipient.findMany({
                where: { campaignId: campaign.id }
            });

            for (let i = 0; i < created.length; i++) {
                const delay = i * (10000 + Math.floor(Math.random() * 5000));
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
            const userId = (req as any).user.id;
            const id = req.params.id as string;

            const campaign = await prisma.campaign.findFirst({ where: { id, userId } });
            if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

            await prisma.campaign.update({ where: { id }, data: { status: 'PAUSED' } });
            return res.json({ success: true, message: 'Campaign paused' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async resumeCampaign(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;

            const campaign = await prisma.campaign.findFirst({ where: { id, userId } });
            if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

            await prisma.campaign.update({ where: { id }, data: { status: 'RUNNING' } });

            // Re-enqueue pending recipients
            const pending = await prisma.campaignRecipient.findMany({
                where: { campaignId: id, status: 'PENDING' }
            });

            for (let i = 0; i < pending.length; i++) {
                const delay = i * (10000 + Math.floor(Math.random() * 5000));
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
            const userId = (req as any).user.id;
            const id = req.params.id as string;

            const campaign = await prisma.campaign.findFirst({ where: { id, userId } });
            if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found' });

            await prisma.campaign.delete({ where: { id } });
            return res.json({ success: true, message: 'Campaign deleted' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

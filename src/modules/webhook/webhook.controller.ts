import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';

const createWebhookSchema = z.object({
    url: z.string().url(),
    events: z.array(z.string()).default([]), // Empty array means all events
    isActive: z.boolean().default(true)
});

export class WebhookController {
    async listWebhooks(req: Request, res: Response) {
        const userId = (req as any).user.id;
        const webhooks = await prisma.webhookConfig.findMany({ where: { userId } });
        return res.status(200).json({ success: true, webhooks });
    }

    async createWebhook(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const data = createWebhookSchema.parse(req.body);

            const webhook = await prisma.webhookConfig.create({
                data: {
                    userId,
                    url: data.url,
                    events: data.events,
                    isActive: data.isActive
                }
            });
            return res.status(201).json({ success: true, webhook });
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, errors: error.issues });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async deleteWebhook(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { id } = req.params;

            const webhook = await prisma.webhookConfig.findFirst({ where: { id, userId } });
            if (!webhook) {
                return res.status(404).json({ success: false, message: 'Webhook not found' });
            }

            await prisma.webhookConfig.delete({ where: { id } });
            return res.status(200).json({ success: true, message: 'Webhook deleted' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

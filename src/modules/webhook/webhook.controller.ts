import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { getWorkspaceId } from '../../lib/workspace-context';
import { generateWebhookSecret } from './webhook.dispatcher';

const createWebhookSchema = z.object({
    url: z.string().url(),
    events: z.array(z.string()).default([]),
    isActive: z.boolean().default(true),
    instanceId: z.string().uuid().optional().nullable()
});

export class WebhookController {
    async listWebhooks(req: Request, res: Response) {
        const workspaceId = getWorkspaceId(req);
        // Never expose the HMAC secret on list — receivers already
        // stored it from the create response. Same reason we don't leak
        // API keys after the initial reveal.
        const webhooks = await prisma.webhookConfig.findMany({
            where: { workspaceId } as any,
            select: {
                id: true, url: true, events: true, isActive: true,
                instanceId: true, createdAt: true, updatedAt: true,
                instance: { select: { name: true } },
            },
        });
        return res.status(200).json({ success: true, webhooks });
    }

    async createWebhook(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const data = createWebhookSchema.parse(req.body);

            // Fresh HMAC secret per webhook. Returned in the create
            // response ONCE; subsequent GETs strip it. Callers store it
            // and use it to verify X-Webhook-Signature on every
            // incoming POST.
            const secret = generateWebhookSecret();
            const webhook = await prisma.webhookConfig.create({
                data: {
                    userId,
                    workspaceId,
                    url: data.url,
                    events: data.events,
                    isActive: data.isActive,
                    instanceId: data.instanceId || null,
                    secret,
                },
            });
            return res.status(201).json({ success: true, webhook, secret });
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, errors: error.issues });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Regenerate the HMAC secret. The response reveals the new value
    // once and the old one is immediately invalid. Use when the secret
    // is suspected leaked.
    async rotateSecret(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const { id } = req.params;
            const webhook = await prisma.webhookConfig.findFirst({ where: { id, workspaceId } as any });
            if (!webhook) return res.status(404).json({ success: false, message: 'Webhook not found' });
            const secret = generateWebhookSecret();
            await prisma.webhookConfig.update({ where: { id }, data: { secret } });
            return res.json({ success: true, secret });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async deleteWebhook(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const { id } = req.params;

            const webhook = await prisma.webhookConfig.findFirst({ where: { id, workspaceId } as any });
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

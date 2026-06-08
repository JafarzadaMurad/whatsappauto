import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { ok, fail, type RegisterToolFn } from '../mcp.server';

export function registerWebhookTools(reg: RegisterToolFn) {
    reg(
        'list_webhooks',
        'Lists outbound webhooks subscribed by the user. Each row: id, url, events, instanceId (or null = all), isActive.',
        {},
        async (_args, ctx) => {
            const rows = await prisma.webhookConfig.findMany({
                where: { workspaceId: ctx.workspaceId },
                orderBy: { createdAt: 'desc' },
            });
            return ok(rows);
        },
    );

    reg(
        'create_webhook',
        'Subscribes a webhook URL to receive events. Use `instanceId=null` to receive events from all instances.',
        {
            url: z.string().url(),
            events: z.array(z.string()).min(1),
            instanceId: z.string().uuid().nullable().optional(),
            isActive: z.boolean().optional(),
        },
        async ({ url, events, instanceId, isActive }, ctx) => {
            if (instanceId) {
                const inst = await prisma.instance.findFirst({ where: { id: instanceId, workspaceId: ctx.workspaceId } });
                if (!inst) return fail(`Instance ${instanceId} not found`);
            }
            const row = await prisma.webhookConfig.create({
                data: {
                    userId: ctx.userId,
                    workspaceId: ctx.workspaceId,
                    url,
                    events,
                    instanceId: instanceId || null,
                    isActive: isActive ?? true,
                },
            });
            return ok(row);
        },
    );

    reg(
        'delete_webhook',
        'Deletes a webhook subscription.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const existing = await prisma.webhookConfig.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
            if (!existing) return fail(`Webhook ${id} not found`);
            await prisma.webhookConfig.delete({ where: { id } });
            return ok({ deleted: true, id });
        },
    );
}

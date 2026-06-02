import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { ok, fail, type RegisterToolFn } from '../mcp.server';

export function registerClientTools(reg: RegisterToolFn) {
    reg(
        'list_clients',
        'Lists CRM contacts (clients). Supports search by phone / name / tags / status.',
        {
            search: z.string().optional(),
            tags: z.array(z.string()).optional(),
            status: z.string().optional(),
            channel: z.enum(['whatsapp', 'instagram']).optional(),
            limit: z.number().int().min(1).max(500).optional(),
        },
        async ({ search, tags, status, channel, limit }, ctx) => {
            const where: any = { userId: ctx.userId };
            if (search) {
                where.OR = [
                    { phone: { contains: search } },
                    { name: { contains: search, mode: 'insensitive' } },
                ];
            }
            if (status) where.status = status;
            if (channel) where.channel = channel;
            if (tags && tags.length) where.tags = { hasSome: tags };
            const rows = await prisma.client.findMany({
                where,
                orderBy: { updatedAt: 'desc' },
                take: Math.min(limit || 100, 500),
            });
            return ok(rows);
        },
    );

    reg(
        'get_client',
        'Returns a single CRM contact.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const row = await prisma.client.findFirst({ where: { id, userId: ctx.userId } });
            if (!row) return fail(`Client ${id} not found`);
            return ok(row);
        },
    );

    reg(
        'update_client',
        'Updates a CRM contact. Any omitted field is left unchanged.',
        {
            id: z.string(),
            name: z.string().optional(),
            status: z.string().optional(),
            tags: z.array(z.string()).optional(),
            summary: z.string().optional(),
            customFields: z.record(z.string(), z.any()).optional(),
        },
        async (args, ctx) => {
            const { id, ...patch } = args;
            const existing = await prisma.client.findFirst({ where: { id, userId: ctx.userId } });
            if (!existing) return fail(`Client ${id} not found`);
            const row = await prisma.client.update({
                where: { id },
                data: {
                    ...(patch.name !== undefined ? { name: patch.name } : {}),
                    ...(patch.status !== undefined ? { status: patch.status } : {}),
                    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
                    ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
                    ...(patch.customFields !== undefined ? { customFields: patch.customFields as any } : {}),
                },
            });
            return ok(row);
        },
    );

    reg(
        'add_client_tag',
        'Adds a tag to a CRM contact (no-op if already present).',
        { id: z.string(), tag: z.string().min(1) },
        async ({ id, tag }, ctx) => {
            const existing = await prisma.client.findFirst({ where: { id, userId: ctx.userId } });
            if (!existing) return fail(`Client ${id} not found`);
            const tags = Array.from(new Set([...(existing.tags || []), tag]));
            const row = await prisma.client.update({ where: { id }, data: { tags } });
            return ok(row);
        },
    );

    reg(
        'remove_client_tag',
        'Removes a tag from a CRM contact.',
        { id: z.string(), tag: z.string().min(1) },
        async ({ id, tag }, ctx) => {
            const existing = await prisma.client.findFirst({ where: { id, userId: ctx.userId } });
            if (!existing) return fail(`Client ${id} not found`);
            const tags = (existing.tags || []).filter(t => t !== tag);
            const row = await prisma.client.update({ where: { id }, data: { tags } });
            return ok(row);
        },
    );

    reg(
        'delete_client',
        'Deletes a CRM contact. This does not delete their message history.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const existing = await prisma.client.findFirst({ where: { id, userId: ctx.userId } });
            if (!existing) return fail(`Client ${id} not found`);
            await prisma.client.delete({ where: { id } });
            return ok({ deleted: true, id });
        },
    );
}

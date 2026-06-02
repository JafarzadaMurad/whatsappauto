import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { ok, fail, type RegisterToolFn } from '../mcp.server';

function maskKey(key: string): string {
    if (key.length < 10) return '***';
    return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

export function registerApiKeyTools(reg: RegisterToolFn) {
    reg(
        'list_api_keys',
        'Lists the user\'s API keys. The full secret is NEVER returned — only a masked prefix and lastUsedAt timestamp.',
        {},
        async (_args, ctx) => {
            const rows = await prisma.apiKey.findMany({
                where: { userId: ctx.userId },
                orderBy: { createdAt: 'desc' },
                select: { id: true, name: true, key: true, createdAt: true, lastUsedAt: true },
            });
            return ok(rows.map(r => ({ id: r.id, name: r.name, maskedKey: maskKey(r.key), createdAt: r.createdAt, lastUsedAt: r.lastUsedAt })));
        },
    );

    reg(
        'create_api_key',
        'Generates a new API key. The full secret is returned ONCE — save it immediately, it cannot be retrieved later. Use it as the Bearer token for the alChatBot REST API or another MCP connection.',
        { name: z.string().min(1) },
        async ({ name }, ctx) => {
            const key = 'sk_live_' + crypto.randomBytes(24).toString('hex');
            const row = await prisma.apiKey.create({
                data: { userId: ctx.userId, name, key },
                select: { id: true, name: true, key: true, createdAt: true },
            });
            return ok({
                ...row,
                warning: 'This secret will not be shown again. Store it in a secure place now.',
            });
        },
    );

    reg(
        'delete_api_key',
        'Revokes an API key. Any clients using it will start receiving 401 errors immediately.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const existing = await prisma.apiKey.findFirst({ where: { id, userId: ctx.userId } });
            if (!existing) return fail(`API key ${id} not found`);
            await prisma.apiKey.delete({ where: { id } });
            return ok({ deleted: true, id });
        },
    );
}

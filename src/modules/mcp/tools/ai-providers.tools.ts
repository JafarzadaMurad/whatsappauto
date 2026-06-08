import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { ok, fail, type RegisterToolFn } from '../mcp.server';

export function registerAiProviderTools(reg: RegisterToolFn) {
    reg(
        'list_ai_providers',
        'Lists AI providers (OPENAI / CLAUDE / GEMINI) configured by the user. The stored API key is never returned.',
        {},
        async (_args, ctx) => {
            const rows = await prisma.aiProvider.findMany({
                where: { workspaceId: ctx.workspaceId },
                select: { id: true, provider: true, createdAt: true, updatedAt: true },
            });
            return ok(rows);
        },
    );

    reg(
        'upsert_ai_provider',
        'Adds or replaces the AI provider record for the given provider type. Each user can have at most one record per provider; calling this for a provider that already exists overwrites the stored API key.',
        {
            provider: z.enum(['OPENAI', 'CLAUDE', 'GEMINI']),
            apiKey: z.string().min(10),
        },
        async ({ provider, apiKey }, ctx) => {
            const existing = await prisma.aiProvider.findFirst({ where: { workspaceId: ctx.workspaceId, provider } });
            const row = existing
                ? await prisma.aiProvider.update({ where: { id: existing.id }, data: { apiKey } })
                : await prisma.aiProvider.create({ data: { userId: ctx.userId, workspaceId: ctx.workspaceId, provider, apiKey } });
            return ok({ id: row.id, provider: row.provider, updatedAt: row.updatedAt });
        },
    );

    void fail;
}

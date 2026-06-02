import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { ok, fail, type RegisterToolFn } from '../mcp.server';

const agentCommonFields = {
    name: z.string().min(1),
    providerId: z.string().uuid(),
    model: z.string().min(1),
    systemPrompt: z.string().optional(),
    skills: z.array(z.string()).optional(),
    allowedTableIds: z.array(z.string()).optional(),
    allowedUrls: z.array(z.string()).optional(),
    httpTools: z.array(z.any()).optional(),
    skillPrompts: z.record(z.string(), z.string()).optional(),
    isActive: z.boolean().optional(),
};

export function registerAgentTools(reg: RegisterToolFn) {
    reg(
        'list_agents',
        'Lists all AI agents owned by the calling user, including their provider, model, skills, and active state.',
        {},
        async (_args, ctx) => {
            const rows = await prisma.agent.findMany({
                where: { userId: ctx.userId },
                include: { provider: { select: { id: true, provider: true } } },
                orderBy: { createdAt: 'desc' },
            });
            return ok(rows);
        },
    );

    reg(
        'get_agent',
        'Returns a single agent with its full configuration: provider, model, system prompt, skills, allowed tables, HTTP tool templates.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const row = await prisma.agent.findFirst({
                where: { id, userId: ctx.userId },
                include: { provider: true },
            });
            if (!row) return fail(`Agent ${id} not found`);
            return ok(row);
        },
    );

    reg(
        'create_agent',
        'Creates a new AI agent. `providerId` must reference an existing AiProvider row owned by you (list with describe_ai_providers). `skills` is any subset of [crm, tables, memory, http]. The agent is inactive by default unless isActive=true.',
        agentCommonFields,
        async (args, ctx) => {
            const provider = await prisma.aiProvider.findFirst({ where: { id: args.providerId, userId: ctx.userId } });
            if (!provider) return fail(`Provider ${args.providerId} not found or not yours`);
            const row = await prisma.agent.create({
                data: {
                    userId: ctx.userId,
                    name: args.name,
                    providerId: args.providerId,
                    model: args.model,
                    systemPrompt: args.systemPrompt || null,
                    skills: args.skills || [],
                    allowedTableIds: args.allowedTableIds || [],
                    allowedUrls: args.allowedUrls || [],
                    httpTools: (args.httpTools || []) as any,
                    skillPrompts: (args.skillPrompts || {}) as any,
                    isActive: args.isActive ?? true,
                },
            });
            return ok(row);
        },
    );

    reg(
        'update_agent',
        'Updates an existing agent. Omitted fields are left unchanged.',
        {
            id: z.string(),
            ...Object.fromEntries(Object.entries(agentCommonFields).map(([k, v]) => [k, (v as any).optional ? (v as any).optional() : v])) as any,
        },
        async (args: any, ctx) => {
            const { id, ...patch } = args;
            const existing = await prisma.agent.findFirst({ where: { id, userId: ctx.userId } });
            if (!existing) return fail(`Agent ${id} not found`);
            if (patch.providerId) {
                const provider = await prisma.aiProvider.findFirst({ where: { id: patch.providerId, userId: ctx.userId } });
                if (!provider) return fail(`Provider ${patch.providerId} not found or not yours`);
            }
            const row = await prisma.agent.update({
                where: { id },
                data: {
                    ...(patch.name !== undefined ? { name: patch.name } : {}),
                    ...(patch.providerId !== undefined ? { providerId: patch.providerId } : {}),
                    ...(patch.model !== undefined ? { model: patch.model } : {}),
                    ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
                    ...(patch.skills !== undefined ? { skills: patch.skills } : {}),
                    ...(patch.allowedTableIds !== undefined ? { allowedTableIds: patch.allowedTableIds } : {}),
                    ...(patch.allowedUrls !== undefined ? { allowedUrls: patch.allowedUrls } : {}),
                    ...(patch.httpTools !== undefined ? { httpTools: patch.httpTools as any } : {}),
                    ...(patch.skillPrompts !== undefined ? { skillPrompts: patch.skillPrompts as any } : {}),
                    ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
                },
            });
            return ok(row);
        },
    );

    reg(
        'delete_agent',
        'Permanently deletes an agent. Any WhatsApp instances or Instagram accounts pointing at this agent will be set to no-agent.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const existing = await prisma.agent.findFirst({ where: { id, userId: ctx.userId } });
            if (!existing) return fail(`Agent ${id} not found`);
            await prisma.agent.delete({ where: { id } });
            return ok({ deleted: true, id });
        },
    );

    reg(
        'list_agent_conversations',
        'Lists the recent conversation threads an agent has had (distinct contact ids it has replied to).',
        { agentId: z.string(), limit: z.number().int().min(1).max(200).optional() },
        async ({ agentId, limit }, ctx) => {
            const agent = await prisma.agent.findFirst({ where: { id: agentId, userId: ctx.userId } });
            if (!agent) return fail(`Agent ${agentId} not found`);
            const rows = await prisma.aiConversationLog.groupBy({
                by: ['remoteJid'],
                where: { agentId },
                _count: { _all: true },
                _max: { createdAt: true },
                take: Math.min(limit || 50, 200),
                orderBy: { _max: { createdAt: 'desc' } },
            });
            return ok(rows.map(r => ({
                contactId: r.remoteJid,
                messageCount: r._count._all,
                lastAt: r._max.createdAt,
            })));
        },
    );

    reg(
        'list_agent_messages',
        'Returns recent message turns between an agent and a specific contact (oldest first).',
        { agentId: z.string(), contactId: z.string(), limit: z.number().int().min(1).max(200).optional() },
        async ({ agentId, contactId, limit }, ctx) => {
            const agent = await prisma.agent.findFirst({ where: { id: agentId, userId: ctx.userId } });
            if (!agent) return fail(`Agent ${agentId} not found`);
            const rows = await prisma.aiConversationLog.findMany({
                where: { agentId, remoteJid: contactId },
                orderBy: { createdAt: 'asc' },
                take: Math.min(limit || 50, 200),
                select: { id: true, userMessage: true, agentReply: true, createdAt: true },
            });
            return ok(rows);
        },
    );
}

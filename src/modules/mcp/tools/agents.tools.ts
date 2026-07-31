import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { ok, fail, type RegisterToolFn } from '../mcp.server';
import { isModelAllowed, loadAllowedModels } from '../../../lib/model-access';

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

    // Behaviour tunables. These were editable in the dashboard but not
    // through MCP, so an assistant configuring an agent end-to-end had
    // to stop and ask the operator to finish by hand.
    historyDepth: z.number().int().min(0).max(100).optional()
        .describe('How many past messages are replayed to the model. 0 disables history.'),
    reminderHours: z.number().int().min(0).max(720).optional()
        .describe('Hours of silence before the agent nudges the contact. 0 turns reminders off.'),
    audioEnabled: z.boolean().optional()
        .describe('Transcribe incoming voice notes (needs an OpenAI key in the workspace).'),
    visionEnabled: z.boolean().optional()
        .describe('Let the agent read incoming images (needs a vision-capable model).'),
    whisperLanguage: z.string().max(10).nullable().optional()
        .describe('ISO code forced for transcription, or null to auto-detect.'),
    whisperModel: z.string().max(60).optional(),
    timezone: z.string().max(60).optional()
        .describe('IANA timezone used to render date/time placeholders in the prompt.'),
    isRouter: z.boolean().optional()
        .describe('Mark this agent as a dispatcher that hands conversations to other agents.'),
    routerDescription: z.string().max(2000).nullable().optional(),
};

export function registerAgentTools(reg: RegisterToolFn) {
    reg(
        'list_agents',
        'Lists all AI agents owned by the calling user, including their provider, model, skills, and active state.',
        {},
        async (_args, ctx) => {
            const rows = await prisma.agent.findMany({
                where: { workspaceId: ctx.workspaceId },
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
                where: { id, workspaceId: ctx.workspaceId },
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
            const provider = await prisma.aiProvider.findFirst({ where: { id: args.providerId, workspaceId: ctx.workspaceId } });
            if (!provider) return fail(`Provider ${args.providerId} not found or not yours`);
            // Same plan-level model gate as the REST agent controller
            // — a workspace opening an MCP session (Claude Desktop) can
            // otherwise spin up any model regardless of what the plan
            // allows.
            const allowed = await loadAllowedModels(ctx.workspaceId);
            if (!isModelAllowed(allowed, provider.provider, args.model)) {
                return fail(`Your plan doesn't include ${provider.provider}/${args.model}. Ask an admin to add it, or pick an allowed model.`);
            }
            const row = await prisma.agent.create({
                data: {
                    userId: ctx.userId,
                    workspaceId: ctx.workspaceId,
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
            const existing = await prisma.agent.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
            if (!existing) return fail(`Agent ${id} not found`);
            // Resolve the provider we'd be running with post-patch so
            // we can check its label against the plan allow-list.
            const effectiveProviderId = patch.providerId ?? existing.providerId;
            const effectiveModel = patch.model ?? existing.model;
            const providerRow = await prisma.aiProvider.findFirst({ where: { id: effectiveProviderId, workspaceId: ctx.workspaceId } });
            if (!providerRow) return fail(`Provider ${effectiveProviderId} not found or not yours`);
            const allowed = await loadAllowedModels(ctx.workspaceId);
            if (!isModelAllowed(allowed, providerRow.provider, effectiveModel)) {
                return fail(`Your plan doesn't include ${providerRow.provider}/${effectiveModel}. Ask an admin to add it, or pick an allowed model.`);
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
                    ...(patch.historyDepth !== undefined ? { historyDepth: patch.historyDepth } : {}),
                    ...(patch.reminderHours !== undefined ? { reminderHours: patch.reminderHours } : {}),
                    ...(patch.audioEnabled !== undefined ? { audioEnabled: patch.audioEnabled } : {}),
                    ...(patch.visionEnabled !== undefined ? { visionEnabled: patch.visionEnabled } : {}),
                    ...(patch.whisperLanguage !== undefined ? { whisperLanguage: patch.whisperLanguage } : {}),
                    ...(patch.whisperModel !== undefined ? { whisperModel: patch.whisperModel } : {}),
                    ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
                    ...(patch.isRouter !== undefined ? { isRouter: patch.isRouter } : {}),
                    ...(patch.routerDescription !== undefined ? { routerDescription: patch.routerDescription } : {}),
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
            const existing = await prisma.agent.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
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
            const agent = await prisma.agent.findFirst({ where: { id: agentId, workspaceId: ctx.workspaceId } });
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
            const agent = await prisma.agent.findFirst({ where: { id: agentId, workspaceId: ctx.workspaceId } });
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

import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { buildTemplateExecutor, sanitizeName, type HttpToolTemplate, AiService } from './ai.service';
import { sendIgMessage } from '../instagram/instagram.ai.service';
import { checkPlanLimit, PlanLimitError } from '../../lib/plan-limits';
import { getWorkspaceId } from '../../lib/workspace-context';
import { isModelAllowed, loadAllowedModels, normaliseProvider } from '../../lib/model-access';

const valueSpecSchema = z.union([
    z.object({ mode: z.literal('fixed'), value: z.string() }),
    z.object({ mode: z.literal('ai'), description: z.string() })
]);

const nameValueSchema = z.object({
    name: z.string(),
    value: valueSpecSchema
});

const httpToolTemplateSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().default(''),
    inputMode: z.enum(['form', 'raw']).optional(),
    rawRequest: z.string().optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    url: valueSpecSchema,
    auth: z.union([
        z.object({ type: z.literal('none') }),
        z.object({ type: z.literal('bearer'), token: z.string() }),
        z.object({ type: z.literal('basic'), username: z.string(), password: z.string() })
    ]).optional(),
    queryParams: z.array(nameValueSchema).optional(),
    headers: z.array(nameValueSchema).optional(),
    bodyType: z.enum(['none', 'json', 'raw']).optional(),
    bodyParams: z.array(nameValueSchema).optional(),
    rawBody: valueSpecSchema.optional()
});

const createAgentSchema = z.object({
    name: z.string().min(1),
    providerId: z.string().uuid(),
    model: z.string().min(1),
    systemPrompt: z.string().optional(),
    allowedTableIds: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    allowedUrls: z.array(z.string()).optional(),
    httpTools: z.array(httpToolTemplateSchema).optional(),
    skillPrompts: z.record(z.string(), z.string()).optional(),
    isActive: z.boolean().optional(),
    audioEnabled: z.boolean().optional(),
    visionEnabled: z.boolean().optional(),
    historyDepth: z.number().int().min(1).max(50).optional(),
    reminderHours: z.number().int().min(1).max(720).optional(),
    whisperLanguage: z.string().min(2).max(8).nullable().optional(),
    whisperModel: z.enum(['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe']).optional(),
    timezone: z.string().min(1).max(64).optional(),
    isRouter: z.boolean().optional(),
    routerDescription: z.string().max(400).nullable().optional(),
    routableAgentIds: z.array(z.string().uuid()).optional(),
});

export class AgentController {
    async getAgents(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            // ?type=ai      → only regular AI agents
            // ?type=router  → only router agents
            // ?type=all|''  → everything
            const type = String(req.query.type || 'all');
            const where: any = { workspaceId };
            if (type === 'ai') where.isRouter = false;
            else if (type === 'router') where.isRouter = true;
            const agents = await prisma.agent.findMany({
                where,
                include: { provider: true, instances: true },
                orderBy: { createdAt: 'desc' }
            });
            return res.json({ success: true, agents });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getAgent(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const agent = await prisma.agent.findFirst({
                where: { id, workspaceId },
                include: { provider: true, instances: true }
            });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });
            return res.json({ success: true, agent });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async createAgent(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const data = createAgentSchema.parse(req.body);

            await checkPlanLimit(workspaceId, 'agent');

            // Verify provider belongs to workspace
            const provider = await prisma.aiProvider.findFirst({ where: { id: data.providerId, workspaceId } });
            if (!provider) return res.status(404).json({ success: false, message: 'Invalid AI Provider' });

            // Plan-level model allow-list. Same rule as copilot: empty
            // list = no restriction; otherwise the agent's model must be
            // on it. Prevents Free-plan workspaces from spinning up an
            // Opus-4 agent and burning credits at 15× the intended rate.
            const allowed = await loadAllowedModels(workspaceId);
            if (!isModelAllowed(allowed, provider.provider, data.model)) {
                return res.status(403).json({
                    success: false,
                    code: 'model_not_allowed',
                    message: `Your plan doesn't include ${provider.provider}/${data.model}. Ask an admin to add it to your plan, or pick an allowed model.`,
                });
            }

            const agent = await prisma.agent.create({
                data: {
                    userId,
                    workspaceId,
                    name: data.name,
                    providerId: data.providerId,
                    model: data.model,
                    systemPrompt: data.systemPrompt || "",
                    allowedTableIds: data.allowedTableIds || [],
                    skills: data.skills || [],
                    allowedUrls: data.allowedUrls || [],
                    httpTools: (data.httpTools || []) as any,
                    skillPrompts: (data.skillPrompts || {}) as any,
                    ...(data.audioEnabled !== undefined ? { audioEnabled: data.audioEnabled } : {}),
                    ...(data.visionEnabled !== undefined ? { visionEnabled: data.visionEnabled } : {}),
                    ...(data.historyDepth !== undefined ? { historyDepth: data.historyDepth } : {}),
                    ...(data.reminderHours !== undefined ? { reminderHours: data.reminderHours } : {}),
                    ...(data.whisperLanguage !== undefined ? { whisperLanguage: data.whisperLanguage } : {}),
                    ...(data.whisperModel !== undefined ? { whisperModel: data.whisperModel } : {}),
                    ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
                    ...(data.isRouter !== undefined ? { isRouter: data.isRouter } : {}),
                    ...(data.routerDescription !== undefined ? { routerDescription: data.routerDescription } : {}),
                    ...(data.routableAgentIds !== undefined ? { routableAgentIds: data.routableAgentIds } : {}),
                }
            });

            return res.status(201).json({ success: true, agent });
        } catch (error: any) {
            if (error instanceof PlanLimitError) return res.status(403).json({ success: false, message: error.message, code: error.code });
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── Portable agent config ──────────────────────────────────────
    // Export produces a self-contained JSON blob the operator can copy
    // and paste into any other workspace — including one on a different
    // account. It deliberately carries no ids: providerId, allowed
    // tables and routable agents are all workspace-local and would be
    // meaningless (or worse, point at someone else's rows) elsewhere.
    // The provider is recorded by *label* so import can re-bind it.
    async exportAgent(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const agent = await prisma.agent.findFirst({
                where: { id, workspaceId },
                include: { provider: { select: { provider: true } } },
            });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

            return res.json({
                success: true,
                export: {
                    _format: 'alchatbot.agent',
                    _version: 1,
                    name: agent.name,
                    provider: agent.provider?.provider ?? null,
                    model: agent.model,
                    systemPrompt: agent.systemPrompt,
                    skills: agent.skills,
                    skillPrompts: agent.skillPrompts,
                    httpTools: agent.httpTools,
                    allowedUrls: agent.allowedUrls,
                    audioEnabled: agent.audioEnabled,
                    visionEnabled: agent.visionEnabled,
                    historyDepth: agent.historyDepth,
                    reminderHours: agent.reminderHours,
                    whisperLanguage: agent.whisperLanguage,
                    whisperModel: agent.whisperModel,
                    timezone: agent.timezone,
                    isRouter: agent.isRouter,
                    routerDescription: agent.routerDescription,
                },
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Import rebuilds the agent in the caller's workspace. The provider
    // is matched by label; if the source used one this workspace doesn't
    // have, we say so plainly rather than silently substituting. Tables
    // and routing targets are dropped — they're workspace-local, and the
    // operator re-picks them after import.
    async importAgent(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);

            const schema = z.object({
                _format: z.literal('alchatbot.agent').optional(),
                name: z.string().min(1).max(120),
                provider: z.string().nullable().optional(),
                providerId: z.string().uuid().optional(),
                model: z.string().min(1),
                systemPrompt: z.string().optional(),
                skills: z.array(z.string()).optional(),
                skillPrompts: z.record(z.string(), z.any()).optional(),
                httpTools: z.array(z.any()).optional(),
                allowedUrls: z.array(z.string()).optional(),
                audioEnabled: z.boolean().optional(),
                visionEnabled: z.boolean().optional(),
                historyDepth: z.number().int().min(0).max(100).optional(),
                reminderHours: z.number().int().min(0).max(720).optional(),
                whisperLanguage: z.string().nullable().optional(),
                whisperModel: z.string().optional(),
                timezone: z.string().optional(),
                isRouter: z.boolean().optional(),
                routerDescription: z.string().nullable().optional(),
            });
            const data = schema.parse(req.body);

            await checkPlanLimit(workspaceId, 'agent');

            // Bind a provider in *this* workspace: explicit id wins, then
            // the exported label, then whatever is available.
            let provider = data.providerId
                ? await prisma.aiProvider.findFirst({ where: { id: data.providerId, workspaceId } })
                : null;
            if (!provider && data.provider) {
                provider = await prisma.aiProvider.findFirst({ where: { workspaceId, provider: data.provider } });
            }
            if (!provider) {
                provider = await prisma.aiProvider.findFirst({ where: { workspaceId } });
            }
            if (!provider) {
                return res.status(400).json({
                    success: false,
                    code: 'no_provider',
                    message: 'This workspace has no AI provider configured yet. Open the agents page once so providers are provisioned, then import again.',
                });
            }

            // The exported model may not be on this plan — fall back to
            // the first allowed one rather than refusing the whole import,
            // and tell the caller what we changed.
            const allowed = await loadAllowedModels(workspaceId);
            let model = data.model;
            let modelChanged = false;
            if (!isModelAllowed(allowed, provider.provider, model)) {
                const catalogue = allowed
                    .filter(m => m.startsWith(`${normaliseProvider(provider.provider)}:`))
                    .map(m => m.split(':').slice(1).join(':'));
                if (catalogue.length === 0) {
                    return res.status(403).json({
                        success: false,
                        code: 'model_not_allowed',
                        message: `Your plan doesn't include ${provider.provider}/${model}, and no other ${provider.provider} model is available. Ask an admin to allow one.`,
                    });
                }
                model = catalogue[0];
                modelChanged = true;
            }

            const agent = await prisma.agent.create({
                data: {
                    userId,
                    workspaceId,
                    name: data.name,
                    providerId: provider.id,
                    model,
                    systemPrompt: data.systemPrompt || '',
                    skills: data.skills || [],
                    skillPrompts: (data.skillPrompts || {}) as any,
                    httpTools: (data.httpTools || []) as any,
                    allowedUrls: data.allowedUrls || [],
                    // Workspace-local references intentionally not carried
                    // over — they'd point at rows that don't exist here.
                    allowedTableIds: [],
                    routableAgentIds: [],
                    ...(data.audioEnabled !== undefined ? { audioEnabled: data.audioEnabled } : {}),
                    ...(data.visionEnabled !== undefined ? { visionEnabled: data.visionEnabled } : {}),
                    ...(data.historyDepth !== undefined ? { historyDepth: data.historyDepth } : {}),
                    ...(data.reminderHours !== undefined ? { reminderHours: data.reminderHours } : {}),
                    ...(data.whisperLanguage !== undefined ? { whisperLanguage: data.whisperLanguage } : {}),
                    ...(data.whisperModel !== undefined ? { whisperModel: data.whisperModel } : {}),
                    ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
                    ...(data.isRouter !== undefined ? { isRouter: data.isRouter } : {}),
                    ...(data.routerDescription !== undefined ? { routerDescription: data.routerDescription } : {}),
                },
            });

            const notes: string[] = [];
            if (modelChanged) notes.push(`Model changed to ${model} — the exported one isn't available on this plan.`);
            if (data.provider && provider.provider !== data.provider) {
                notes.push(`Provider ${data.provider} isn't set up here; bound to ${provider.provider} instead.`);
            }
            notes.push('Allowed tables and routing targets were not copied — they are workspace-specific.');

            return res.status(201).json({ success: true, agent, notes });
        } catch (error: any) {
            if (error instanceof PlanLimitError) return res.status(403).json({ success: false, message: error.message, code: error.code });
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, message: 'That doesn\'t look like an exported agent.', errors: error.issues });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateAgent(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const data = createAgentSchema.parse(req.body);

            const existing = await prisma.agent.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Agent not found' });

            // Same plan-level model gate as create.
            const providerRow = await prisma.aiProvider.findFirst({ where: { id: data.providerId, workspaceId } });
            if (!providerRow) return res.status(404).json({ success: false, message: 'Invalid AI Provider' });
            const allowed = await loadAllowedModels(workspaceId);
            if (!isModelAllowed(allowed, providerRow.provider, data.model)) {
                return res.status(403).json({
                    success: false,
                    code: 'model_not_allowed',
                    message: `Your plan doesn't include ${providerRow.provider}/${data.model}. Ask an admin to add it to your plan, or pick an allowed model.`,
                });
            }

            const agent = await prisma.agent.update({
                where: { id },
                data: {
                    name: data.name,
                    provider: { connect: { id: data.providerId } },
                    model: data.model,
                    systemPrompt: data.systemPrompt,
                    allowedTableIds: data.allowedTableIds || [],
                    skills: data.skills || [],
                    allowedUrls: data.allowedUrls || [],
                    httpTools: (data.httpTools || []) as any,
                    skillPrompts: (data.skillPrompts || {}) as any,
                    ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
                    ...(data.audioEnabled !== undefined ? { audioEnabled: data.audioEnabled } : {}),
                    ...(data.visionEnabled !== undefined ? { visionEnabled: data.visionEnabled } : {}),
                    ...(data.historyDepth !== undefined ? { historyDepth: data.historyDepth } : {}),
                    ...(data.reminderHours !== undefined ? { reminderHours: data.reminderHours } : {}),
                    ...(data.whisperLanguage !== undefined ? { whisperLanguage: data.whisperLanguage } : {}),
                    ...(data.whisperModel !== undefined ? { whisperModel: data.whisperModel } : {}),
                    ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
                    ...(data.isRouter !== undefined ? { isRouter: data.isRouter } : {}),
                    ...(data.routerDescription !== undefined ? { routerDescription: data.routerDescription } : {}),
                    ...(data.routableAgentIds !== undefined ? { routableAgentIds: data.routableAgentIds } : {}),
                }
            });

            return res.json({ success: true, agent });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async deleteAgent(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const force = String(req.query.force || '') === 'true';

            const existing = await prisma.agent.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Agent not found' });

            // Check campaigns linked to this agent.
            const campaigns = await prisma.campaign.findMany({
                where: { agentId: id },
                select: { id: true, name: true, status: true },
            });

            if (campaigns.length > 0 && !force) {
                return res.status(409).json({
                    success: false,
                    requiresConfirmation: true,
                    campaigns,
                    message: `${campaigns.length} campaign(s) use this agent. They will stay but their agent will show as "deleted".`,
                });
            }

            await prisma.agent.delete({ where: { id } });
            return res.json({
                success: true,
                message: 'Agent deleted',
                orphanedCampaigns: campaigns.length,
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getConversations(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const agent = await prisma.agent.findFirst({ where: { id, workspaceId } });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

            const logs = await prisma.aiConversationLog.findMany({
                where: { agentId: id },
                orderBy: { createdAt: 'desc' }
            });

            // Group by remoteJid
            const grouped: Record<string, any> = {};
            for (const log of logs) {
                if (!grouped[log.remoteJid]) {
                    grouped[log.remoteJid] = {
                        remoteJid: log.remoteJid,
                        messageCount: 0,
                        totalTokens: 0,
                        lastMessageAt: log.createdAt,
                    };
                }
                grouped[log.remoteJid].messageCount++;
                grouped[log.remoteJid].totalTokens += log.totalTokens;
            }

            // Enrich Instagram conversations with cached contact profiles
            const igSenderIds = Object.keys(grouped)
                .filter(j => j.startsWith('ig:'))
                .map(j => j.slice(3));
            if (igSenderIds.length > 0) {
                const contacts = await prisma.instagramContact.findMany({
                    where: { senderId: { in: igSenderIds } }
                });
                const bySender: Record<string, any> = {};
                for (const c of contacts) bySender[c.senderId] = c;
                for (const jid of Object.keys(grouped)) {
                    if (!jid.startsWith('ig:')) continue;
                    const c = bySender[jid.slice(3)];
                    grouped[jid].platform = 'instagram';
                    grouped[jid].username = c?.username || null;
                    grouped[jid].name = c?.name || null;
                    grouped[jid].profilePic = c?.profilePic || null;
                    grouped[jid].lastInboundAt = c?.lastMessageAt || null;
                }
            }

            return res.json({ success: true, conversations: Object.values(grouped) });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getConversationMessages(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const remoteJid = req.query.remoteJid as string;

            if (!remoteJid) return res.status(400).json({ success: false, message: 'remoteJid required' });

            const agent = await prisma.agent.findFirst({ where: { id, workspaceId } });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

            const messages = await prisma.aiConversationLog.findMany({
                where: { agentId: id, remoteJid },
                orderBy: { createdAt: 'asc' }
            });

            return res.json({ success: true, messages });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getTokenStats(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const agent = await prisma.agent.findFirst({ where: { id, workspaceId } });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

            const logs = await prisma.aiConversationLog.findMany({
                where: { agentId: id },
                select: { provider: true, model: true, promptTokens: true, completionTokens: true, totalTokens: true }
            });

            // Group by provider + model
            const statsMap: Record<string, any> = {};
            for (const log of logs) {
                const key = `${log.provider}:${log.model}`;
                if (!statsMap[key]) {
                    statsMap[key] = { provider: log.provider, model: log.model, promptTokens: 0, completionTokens: 0, totalTokens: 0, requestCount: 0 };
                }
                statsMap[key].promptTokens += log.promptTokens;
                statsMap[key].completionTokens += log.completionTokens;
                statsMap[key].totalTokens += log.totalTokens;
                statsMap[key].requestCount++;
            }

            const stats = Object.values(statsMap);
            const totals = {
                promptTokens: stats.reduce((s: number, x: any) => s + x.promptTokens, 0),
                completionTokens: stats.reduce((s: number, x: any) => s + x.completionTokens, 0),
                totalTokens: stats.reduce((s: number, x: any) => s + x.totalTokens, 0),
                requestCount: stats.reduce((s: number, x: any) => s + x.requestCount, 0),
            };

            return res.json({ success: true, stats, totals });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Rich activity log for the Agent → Activity tab. Returns recent
    // turns with full tool-call detail (args + redacted results).
    // Auto-pruned to 3 days by activity-cleanup.
    async getActivity(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const agent = await prisma.agent.findFirst({ where: { id, workspaceId } });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

            const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
            const beforeRaw = req.query.before as string | undefined;
            const before = beforeRaw ? new Date(beforeRaw) : null;
            const onlyToolErrors = req.query.onlyErrors === 'true';

            const rows = await prisma.agentActivityLog.findMany({
                where: {
                    agentId: id,
                    ...(before ? { createdAt: { lt: before } } : {}),
                },
                orderBy: { createdAt: 'desc' },
                take: limit + 1,
            });

            const hasMore = rows.length > limit;
            let page = rows.slice(0, limit);

            if (onlyToolErrors) {
                page = page.filter(r => {
                    const calls = Array.isArray(r.toolCalls) ? (r.toolCalls as any[]) : [];
                    return calls.some(c => c && c.ok === false);
                });
            }

            return res.json({ success: true, items: page, hasMore });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async testHttpTool(req: Request, res: Response) {
        try {
            const schema = z.object({
                template: httpToolTemplateSchema,
                aiValues: z.record(z.string(), z.string()).optional()
            });
            const { template, aiValues } = schema.parse(req.body);

            // Map UI aiValues (keyed by raw param name) -> executor arg shape
            // (executor expects keys like `query_<sanitized>`, `header_<sanitized>`, `body_<sanitized>`, `url`, `body`)
            const args: Record<string, string> = {};

            // Raw mode: aiValues are already keyed as ai_0, ai_1, ... matching parser output
            if (template.inputMode === 'raw') {
                Object.assign(args, aiValues || {});
                const executor = buildTemplateExecutor(template as HttpToolTemplate);
                const result = await executor(args);
                return res.json({ success: true, result });
            }

            if (template.url.mode === 'ai' && aiValues?.url !== undefined) args.url = aiValues.url;
            (template.queryParams || []).forEach((p, i) => {
                if (p.value.mode === 'ai') {
                    const key = `query_${sanitizeName(p.name, `p${i}`)}`;
                    args[key] = aiValues?.[`query.${p.name}`] ?? '';
                }
            });
            (template.headers || []).forEach((h, i) => {
                if (h.value.mode === 'ai') {
                    const key = `header_${sanitizeName(h.name, `h${i}`)}`;
                    args[key] = aiValues?.[`header.${h.name}`] ?? '';
                }
            });
            if (template.bodyType === 'json') {
                (template.bodyParams || []).forEach((b, i) => {
                    if (b.value.mode === 'ai') {
                        const key = `body_${sanitizeName(b.name, `b${i}`)}`;
                        args[key] = aiValues?.[`body.${b.name}`] ?? '';
                    }
                });
            } else if (template.bodyType === 'raw' && template.rawBody?.mode === 'ai') {
                args.body = aiValues?.body ?? '';
            }

            const executor = buildTemplateExecutor(template as HttpToolTemplate);
            const result = await executor(args);
            return res.json({ success: true, result });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Send a manual reply into a conversation (currently Instagram only)
    // Ephemeral test conversation. Pick a real CRM contact, run a turn
    // as if you were them. Read-only: nothing is saved to message logs;
    // CRM-mutating tools are stubbed (HTTP tools still fire so external
    // integrations like Bitrix can be validated).
    async testAsContact(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const schema = z.object({
                contactPhone: z.string().min(3).max(50),
                userMessage: z.string().min(1).max(4000),
                sessionMessages: z.array(z.object({
                    role: z.enum(['user', 'assistant']),
                    content: z.string(),
                })).max(100).optional().default([]),
            });
            const { contactPhone, userMessage, sessionMessages } = schema.parse(req.body);

            const agent = await prisma.agent.findFirst({
                where: { id, workspaceId },
                include: { provider: true },
            });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });
            if (!agent.provider) return res.status(400).json({ success: false, message: 'Agent has no AI provider configured' });

            const result = await AiService.runTestTurn({
                agent, workspaceId,
                contactPhone, sessionMessages, userMessage,
            });

            return res.json({ success: true, ...result });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async replyToConversation(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const schema = z.object({
                remoteJid: z.string().min(1),
                text: z.string().min(1).max(950)
            });
            const { remoteJid, text } = schema.parse(req.body);

            const agent = await prisma.agent.findFirst({ where: { id, workspaceId } });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

            if (!remoteJid.startsWith('ig:')) {
                return res.status(400).json({ success: false, message: 'Manual reply is currently supported for Instagram conversations only' });
            }

            const senderId = remoteJid.slice(3);
            const account = await prisma.instagramAccount.findFirst({
                where: { agentId: id, workspaceId }
            });
            if (!account) return res.status(400).json({ success: false, message: 'No Instagram account linked to this agent' });

            try {
                await sendIgMessage(account.igUserId, senderId, text, account.accessToken);
            } catch (e: any) {
                const ig = e.response?.data?.error;
                return res.status(502).json({
                    success: false,
                    message: ig?.error_user_msg || ig?.message || e.message,
                    igCode: ig?.code
                });
            }

            // Record the manual reply so it appears in the conversation thread
            const log = await prisma.aiConversationLog.create({
                data: {
                    agentId: id, instanceId: account.id, remoteJid,
                    userMessage: '', agentReply: text,
                    promptTokens: 0, completionTokens: 0, totalTokens: 0,
                    provider: 'MANUAL', model: 'manual',
                    toolCalls: []
                }
            });

            return res.json({ success: true, message: log });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

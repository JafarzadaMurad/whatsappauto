// In-app copilot endpoints.
//
//   POST /api/copilot/chat            - text turn (SSE)
//     body: { sessionId?, message, currentPath? }
//     stream chunks: {type:'chunk', delta}, {type:'tool', name, args},
//                    {type:'done', sessionId, totalCredits}
//
//   POST /api/copilot/sessions/new    - start a fresh session
//   GET  /api/copilot/sessions/:id    - fetch full transcript
//   GET  /api/copilot/sessions        - recent sessions for the sidebar
//   POST /api/copilot/voice/session   - mint an OpenAI Realtime ephemeral token
//
//   GET  /api/copilot/config          - workspace's custom prompt + whether copilot is enabled

import { Request, Response } from 'express';
import { z } from 'zod';
import { generateText, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import axios from 'axios';

import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { getWorkspaceId } from '../../lib/workspace-context';
import { recordUsagePostHoc, getCreditBalance } from '../../lib/credit-guard';
import { resolvePlatformKey } from '../../lib/ai-pricing';
import { isModelAllowed, loadCatalog, normaliseProvider } from '../../lib/model-access';
import { buildCopilotTools, buildCopilotVoiceTools } from './copilot.tools';
import { runCopilotSubscriptionTurn, copilotCanUseSubscription, SubscriptionError } from './copilot.subscription';
import { DEFAULT_COPILOT_PROMPT, buildRuntimeContext } from './copilot.prompt';

// Which model the copilot runs on. Admin-configurable via SystemConfig
// key COPILOT_MODEL. Falls back to Sonnet 5 (best tool-use quality at
// mid-tier price) when unset.
const DEFAULT_COPILOT_PROVIDER = 'CLAUDE';
const DEFAULT_COPILOT_MODEL = 'claude-sonnet-5';

async function loadPlanAccess(workspaceId: string) {
    const ws = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
            id: true, name: true, planId: true,
            copilotCustomPrompt: true,
            plan: { select: { copilotEnabled: true, copilotVoiceEnabled: true, copilotVoiceMultiplier: true } },
            owner: {
                select: {
                    planId: true,
                    plan: { select: { copilotEnabled: true, copilotVoiceEnabled: true, copilotVoiceMultiplier: true } },
                },
            },
        },
    });
    if (!ws) return null;
    // Plan resolution priority:
    //   1. Workspace's own planId (explicit assignment)
    //   2. Owner user's planId (Stripe billing updates User.planId — the
    //      workspace row can lag behind if the sync webhook missed one)
    //   3. Global default (Plan.isDefault=true)
    // Without step 2 an admin who upgrades a user to Ultra sees the
    // copilot toggle apply to the user but stay dark on their workspace.
    if (!ws.plan && ws.owner?.plan) {
        (ws as any).plan = ws.owner.plan;
        // Best-effort self-heal so the next request skips the fallback.
        prisma.workspace.update({
            where: { id: ws.id },
            data: { planId: ws.owner.planId },
        }).catch(() => {});
    }
    if (!ws.plan) {
        const defaultPlan = await prisma.plan.findFirst({
            where: { isDefault: true },
            select: { copilotEnabled: true, copilotVoiceEnabled: true, copilotVoiceMultiplier: true },
        });
        (ws as any).plan = defaultPlan || null;
    }
    return ws;
}

async function loadAdminBasePrompt(): Promise<string> {
    const row = await prisma.systemConfig.findUnique({ where: { key: 'COPILOT_SYSTEM_PROMPT' } });
    return (row?.value || '').trim() || DEFAULT_COPILOT_PROMPT;
}

async function loadCopilotModel(): Promise<{ provider: string; model: string }> {
    const [providerRow, modelRow] = await Promise.all([
        prisma.systemConfig.findUnique({ where: { key: 'COPILOT_PROVIDER' } }),
        prisma.systemConfig.findUnique({ where: { key: 'COPILOT_MODEL' } }),
    ]);
    return {
        provider: providerRow?.value?.trim() || DEFAULT_COPILOT_PROVIDER,
        model: modelRow?.value?.trim() || DEFAULT_COPILOT_MODEL,
    };
}

function buildModel(provider: string, apiKey: string, model: string): any {
    const p = provider.toUpperCase();
    if (p === 'CLAUDE' || p === 'ANTHROPIC') return createAnthropic({ apiKey })(model);
    if (p === 'OPENAI') return createOpenAI({ apiKey } as any).chat(model);
    throw new Error(`Copilot does not support provider ${provider}`);
}

// ─── Handlers ──────────────────────────────────────────────────────

const chatSchema = z.object({
    sessionId: z.string().uuid().optional(),
    message: z.string().min(1).max(8000),
    currentPath: z.string().max(200).optional(),
    // Per-request overrides — the frontend model+language picker.
    // The admin default (COPILOT_PROVIDER / COPILOT_MODEL) is used when omitted.
    provider: z.enum(['CLAUDE', 'OPENAI']).optional(),
    model: z.string().min(1).max(120).optional(),
    // Free-text language name/code; goes into the runtime context so the
    // model consistently replies in that language regardless of what the
    // user typed in with.
    language: z.string().max(60).optional(),
});

export class CopilotController {
    async config(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const ws = await loadPlanAccess(workspaceId);
            const enabled = !!ws?.plan?.copilotEnabled;
            let reason: string | null = null;
            if (!ws) reason = 'no-workspace';
            else if (!ws.plan) reason = 'no-plan';
            else if (!ws.plan.copilotEnabled) reason = 'plan-disabled';

            // Model picker source: the AI Models Catalogue (admin-owned
            // canonical list) intersected with the plan's allowedModels
            // restriction. Empty restriction = whole catalogue allowed.
            // Realtime models are filtered out — those belong to voice
            // mode which has its own admin-set model.
            const [defaults, catalog] = await Promise.all([
                loadCopilotModel(),
                loadCatalog(),
            ]);
            const allowed = ws?.plan?.allowedModels || [];
            const flat: { provider: string; model: string }[] = [];
            for (const p of ['OPENAI', 'CLAUDE'] as const) {
                for (const m of catalog[p]) {
                    if (/realtime/i.test(m)) continue;
                    if (allowed.length > 0 && !allowed.includes(`${p}:${m}`)) continue;
                    flat.push({ provider: p, model: m });
                }
            }
            const availableModels = flat;

            return res.json({
                success: true,
                enabled,
                voiceEnabled: !!ws?.plan?.copilotVoiceEnabled,
                customPrompt: ws?.copilotCustomPrompt || '',
                reason,
                defaultProvider: defaults.provider,
                defaultModel: defaults.model,
                availableModels,
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async saveCustomPrompt(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const body = z.object({ customPrompt: z.string().max(8000) }).parse(req.body);
            await prisma.workspace.update({
                where: { id: workspaceId },
                data: { copilotCustomPrompt: body.customPrompt.trim() || null },
            });
            return res.json({ success: true });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async listSessions(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const rows = await prisma.copilotSession.findMany({
                where: { workspaceId },
                orderBy: { updatedAt: 'desc' },
                take: 30,
                select: { id: true, title: true, mode: true, totalCredits: true, createdAt: true, updatedAt: true },
            });
            return res.json({ success: true, sessions: rows });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getSession(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const row = await prisma.copilotSession.findFirst({
                where: { id: req.params.id, workspaceId },
            });
            if (!row) return res.status(404).json({ success: false, message: 'Session not found' });
            return res.json({ success: true, session: row });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async newSession(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const userId = (req as any).user.id;
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const row = await prisma.copilotSession.create({
                data: { workspaceId, userId, mode: 'text', messages: [] },
                select: { id: true, createdAt: true },
            });
            return res.json({ success: true, session: row });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Non-streaming chat: kept simple for the first cut. Streaming can
    // be added by swapping generateText for streamText and pushing
    // chunks as SSE. The frontend is written against the non-streaming
    // response so it "just works" today.
    async chat(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const userId = (req as any).user.id;
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });

            const body = chatSchema.parse(req.body);

            // 1. Plan gate
            const ws = await loadPlanAccess(workspaceId);
            if (!ws) return res.status(404).json({ success: false, message: 'Workspace not found' });
            if (!ws.plan?.copilotEnabled) {
                return res.status(403).json({
                    success: false,
                    message: 'The in-app copilot is not enabled on your plan.',
                });
            }

            // 1b. Credit gate. Copilot always uses the platform key
            // (no BYOK bypass), so a workspace out of credits must be
            // hard-blocked before we spend more platform tokens on it.
            // `top_up` plans explicitly opt into past-zero use.
            const overageBehavior = (ws.plan as any)?.overageBehavior || 'hard_block';
            if (overageBehavior === 'hard_block') {
                const bal = await getCreditBalance(workspaceId);
                if (bal && bal.totalBudget > 0 && bal.used >= bal.totalBudget) {
                    return res.status(402).json({
                        success: false,
                        code: 'credits_exhausted',
                        message: 'Your credit pool is empty. Upgrade your plan or wait for the next reset.',
                        remaining: 0,
                        totalBudget: bal.totalBudget,
                        periodResetAt: bal.periodResetAt,
                    });
                }
            }

            // 2. Load or create session
            let sessionId = body.sessionId;
            let existing: any = null;
            if (sessionId) {
                existing = await prisma.copilotSession.findFirst({
                    where: { id: sessionId, workspaceId },
                });
                if (!existing) sessionId = undefined;
            }
            if (!sessionId) {
                existing = await prisma.copilotSession.create({
                    data: { workspaceId, userId, mode: 'text', messages: [] },
                });
                sessionId = existing.id;
            }
            const history: any[] = Array.isArray(existing.messages) ? existing.messages : [];

            // 3. Build model. Per-request `provider`/`model` from the
            // frontend picker wins; admin defaults fill the gaps. Both
            // must be in the AiPricing catalogue so we know how to bill,
            // AND on the plan's allowedModels list if the plan sets one.
            const defaults = await loadCopilotModel();
            const provider = body.provider || defaults.provider;
            const model = body.model || defaults.model;
            const planAllowed = ws?.plan?.allowedModels || [];
            if (!isModelAllowed(planAllowed, provider, model)) {
                return res.status(403).json({
                    success: false,
                    code: 'model_not_allowed',
                    message: `Your plan doesn't include ${normaliseProvider(provider)}/${model}. Pick a different model or upgrade the plan.`,
                });
            }
            const apiKey = await resolvePlatformKey(provider);
            // The subscription pool is a credential in its own right, so a
            // missing API key is only fatal when the pool can't serve this
            // request either. Demanding a key we would never call was
            // turning a working setup into an error.
            const canUseSub = await copilotCanUseSubscription({ provider, useOwnKey: false }).catch(() => false);
            if (!apiKey && !canUseSub) {
                return res.status(500).json({
                    success: false,
                    message: `Platform ${provider} key is not configured, and no Claude subscription token is available. ` +
                        `Set one under Admin → AI Providers & Pricing.`,
                });
            }

            // 4. Build tools + system prompt
            const tools = buildCopilotTools({
                userId,
                workspaceId,
                auth: { userId, workspaceId, authKind: 'oauth' } as any,
            });
            const adminPrompt = await loadAdminBasePrompt();
            const balance = await getCreditBalance(workspaceId);
            const runtimeCtx = buildRuntimeContext({
                workspaceName: ws.name,
                currentPath: body.currentPath,
                creditRemaining: balance?.remaining,
            });
            const languageDirective = body.language
                ? `\n\n[Language override]\nReply in ${body.language} regardless of the language the user's message is in. This is a hard rule set by the user in the language picker.`
                : '';
            const systemPrompt = [
                adminPrompt,
                ws.copilotCustomPrompt ? `\n\n[Workspace-specific rules]\n${ws.copilotCustomPrompt}` : '',
                runtimeCtx,
                languageDirective,
            ].filter(Boolean).join('');

            // 5. Assemble messages
            const messagesForLlm = [
                ...history.map((m: any) => ({ role: m.role, content: m.content })),
                { role: 'user' as const, content: body.message },
            ];

            // A user on a Claude seat runs through their own subscription
            // rather than the platform API key: same tools, same prompt,
            // no per-token cost and nothing deducted from the workspace
            // pool. Anyone not on a seat takes the API path unchanged.
            //
            // A seat failing must not fail the request — losing the
            // subscription should cost money, not function — so any error
            // here falls through to the API below.
            let reply = '';
            let toolCalls: { name: string; args: any }[] = [];
            let durationMs = 0;
            let engine: 'subscription' | 'api' = 'api';
            let servedBy: string | null = null;
            let result: any = null;
            let subUsage: any = null;
            let subMeta: any = null;
            // What actually ran, which can differ from what was picked if
            // the pool is pinned to an override.
            let servedModel: string | null = null;

            if (canUseSub) {
                try {
                    const turn = await runCopilotSubscriptionTurn({
                        userId,
                        workspaceId,
                        systemPrompt,
                        message: body.message,
                        history: history.map((m: any) => ({ role: m.role, content: m.content })),
                        model,
                    });
                    reply = turn.text;
                    toolCalls = turn.toolCalls;
                    durationMs = turn.durationMs;
                    engine = 'subscription';
                    servedBy = turn.tokenId;
                    subUsage = turn.usage;
                    subMeta = turn.providerMetadata;
                    servedModel = turn.model;
                } catch (err: any) {
                    const code = err instanceof SubscriptionError ? err.code : 'error';
                    logger.warn(
                        `[copilot] subscription turn failed (${code}: ${err.message}) — falling back to the API key`
                    );
                }
            }

            if (engine === 'api') {
                // Reachable when the pool was eligible but the turn failed
                // on it and there is no key to fall back to. Say which
                // half is missing rather than letting the SDK raise a
                // generic "no API key" from three layers down.
                if (!apiKey) {
                    return res.status(503).json({
                        success: false,
                        message: `The Claude subscription could not serve this message and no platform ${provider} key is set as a fallback. Check the pool under Admin → AI Providers & Pricing.`,
                    });
                }
                const aiModel = buildModel(provider, apiKey, model);
                const t0 = Date.now();
                result = await generateText({
                    model: aiModel,
                    system: systemPrompt,
                    messages: messagesForLlm as any,
                    tools,
                    stopWhen: stepCountIs(15),
                } as any);
                durationMs = Date.now() - t0;

                reply = (result.text || '').trim();
                toolCalls = (result.steps || []).flatMap((s: any) =>
                    (s.toolCalls || []).map((tc: any) => ({
                        name: tc.toolName,
                        args: tc.args ?? tc.input ?? null,
                    }))
                );
            }

            // 6. Bill cai. Both rails are billed the same: the customer
            // bought the work, priced by the model they picked. Where the
            // capacity came from is our side of the ledger.
            //
            // Awaited rather than fired-and-forgotten because the turn's
            // cost is shown next to the reply, and a number that only
            // appears on some turns reads as a bug.
            const billable = result || {
                usage: subUsage,
                providerMetadata: subMeta,
            };
            const credits = await recordUsagePostHoc({
                workspaceId,
                userId,
                agentId: null,
                providerInfo: { provider, apiKey: '', useOwnKey: false },
                model,
                cause: 'other',
            }, billable).catch(() => null);

            const servedWith = servedModel || model;

            // 7. Persist the turn. The model and cost are stored on the
            // message, not derived at render time — reopening a session
            // months later should show what that turn actually ran on,
            // not what the picker happens to say today.
            const updatedMessages = [
                ...history,
                { role: 'user', content: body.message, at: new Date().toISOString() },
                {
                    role: 'assistant', content: reply, toolCalls,
                    model: servedWith,
                    credits,
                    at: new Date().toISOString(),
                },
            ];
            // Auto-derive a title from the first user turn if the session
            // doesn't have one yet — the history sidebar shows it.
            const title = existing.title || body.message.slice(0, 60);
            await prisma.copilotSession.update({
                where: { id: sessionId },
                data: {
                    messages: updatedMessages,
                    title,
                    updatedAt: new Date(),
                    ...(credits ? { totalCredits: { increment: credits } } : {}),
                },
            });

            return res.json({
                success: true,
                sessionId,
                reply,
                toolCalls,
                durationMs,
                model: servedWith,
                credits,
                // Which rail served this turn. Not shown to the user —
                // which credential we used is our business, not theirs —
                // but logged and available for debugging.
                engine,
                servedBy,
                usage: result?.usage ?? subUsage,
            });
        } catch (error: any) {
            // Anthropic/OpenAI SDK errors expose status + a nested `error`
            // object with the real reason (`invalid_api_key`, `not_found`,
            // `overloaded_error`, etc.). Surface those to the frontend so
            // the operator sees WHY the copilot failed, not just "500".
            const status = error.status || error.response?.status;
            const nested = error.error || error.response?.data?.error;
            const nestedMsg = typeof nested === 'string' ? nested : nested?.message;
            logger.error({
                err: error.message,
                status,
                type: nested?.type,
                code: nested?.code,
                nestedMsg,
                stack: error.stack?.split('\n').slice(0, 5).join('\n'),
            }, '[copilot] chat failed');
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            const humanMessage = nestedMsg
                ? `Provider ${status || ''} ${nested?.type || nested?.code || ''}: ${nestedMsg}`.trim()
                : error.message;
            return res.status(500).json({ success: false, message: humanMessage });
        }
    }

    // OpenAI Realtime API — mint an ephemeral client-side session token
    // so the browser can open a WebRTC connection directly to OpenAI.
    // Our server never proxies audio. Usage is billed via a post-hoc
    // ledger row when the session ends (frontend calls /voice/finish).
    async voiceSession(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const ws = await loadPlanAccess(workspaceId);
            if (!ws?.plan?.copilotEnabled) return res.status(403).json({ success: false, message: 'Copilot is not enabled on your plan.' });
            if (!ws.plan.copilotVoiceEnabled) return res.status(403).json({ success: false, message: 'Voice mode is not enabled on your plan.' });

            // Same credit gate as the text path. Voice sessions bill
            // per-second so an empty pool must reject BEFORE we mint an
            // ephemeral OpenAI token that would then burn dollars.
            const overageBehavior = (ws.plan as any)?.overageBehavior || 'hard_block';
            if (overageBehavior === 'hard_block') {
                const bal = await getCreditBalance(workspaceId);
                if (bal && bal.totalBudget > 0 && bal.used >= bal.totalBudget) {
                    return res.status(402).json({
                        success: false,
                        code: 'credits_exhausted',
                        message: 'Your credit pool is empty — voice mode is blocked. Upgrade your plan or wait for the next reset.',
                        remaining: 0,
                        totalBudget: bal.totalBudget,
                        periodResetAt: bal.periodResetAt,
                    });
                }
            }

            const openaiKey = await resolvePlatformKey('OPENAI');
            if (!openaiKey) return res.status(500).json({ success: false, message: 'Platform OpenAI key not configured. An admin must set PLATFORM_OPENAI_KEY in System Config.' });

            const adminPrompt = await loadAdminBasePrompt();
            // Voice used to be told the workspace name and nothing else,
            // so it had no idea what page the user was looking at — and
            // "open that" had nothing to resolve against. Text mode has
            // always had this; the gap was an oversight, not a design.
            const currentPath = typeof req.body?.currentPath === 'string' ? req.body.currentPath.slice(0, 200) : undefined;
            const runtimeCtx = buildRuntimeContext({ workspaceName: ws.name, currentPath });
            const instructions = [
                adminPrompt,
                ws.copilotCustomPrompt ? `\n\n[Workspace rules]\n${ws.copilotCustomPrompt}` : '',
                runtimeCtx,
                // Spoken answers hide failure better than written ones —
                // there's no tool-call chip on screen to contradict a
                // confident "done". So the rule gets restated here.
                '\n\n[Voice mode]\nKeep replies short (1-2 sentences) since they will be spoken. '
                + 'Match the user\'s language. Act first, then speak: when asked to open or show a page, '
                + 'call navigate_to BEFORE saying anything about it, and never claim you have done '
                + 'something unless the tool actually ran and returned success.',
            ].filter(Boolean).join('');

            const modelRow = await prisma.systemConfig.findUnique({ where: { key: 'COPILOT_VOICE_MODEL' } });
            // Default to the current GA Realtime model. `gpt-4o-realtime-preview-*`
            // dated snapshots are still accepted but shouldn't be the default —
            // they get rotated out. Admin can override in /admin/copilot.
            const model = modelRow?.value?.trim() || 'gpt-realtime';

            // GA endpoint (Aug 2025): mints an ephemeral client secret the
            // browser can use to open a WebRTC connection directly to OpenAI.
            // The legacy `POST /v1/realtime/sessions` (beta) was removed
            // for the GA `gpt-realtime` model — using it now returns
            // `404 Invalid URL`. The new shape wraps the session config
            // under `session` and returns `value` at the top level (vs.
            // `client_secret.value` on the old endpoint).
            const r = await axios.post('https://api.openai.com/v1/realtime/client_secrets', {
                session: {
                    type: 'realtime',
                    model,
                    instructions,
                },
            }, {
                headers: {
                    Authorization: `Bearer ${openaiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: 15_000,
                validateStatus: () => true,
            });

            if (r.status >= 400) {
                const oaiErr = r.data?.error || {};
                logger.error({
                    status: r.status,
                    oaiCode: oaiErr.code,
                    oaiType: oaiErr.type,
                    oaiParam: oaiErr.param,
                    oaiMessage: oaiErr.message,
                    body: r.data,
                    model,
                }, '[copilot] OpenAI Realtime client_secret mint rejected');
                return res.status(500).json({
                    success: false,
                    message: `OpenAI ${r.status}: ${oaiErr.message || 'client_secret mint failed'}`,
                    oaiError: oaiErr,
                });
            }

            // GA response: { value, expires_at, session }
            // Legacy response was: { client_secret: { value, expires_at } }
            // Accept either shape defensively so a future rollback of the
            // endpoint doesn't break the flow.
            const clientSecret = r.data?.value || r.data?.client_secret?.value;
            const expiresAt = r.data?.expires_at || r.data?.client_secret?.expires_at;
            if (!clientSecret) {
                logger.error({ body: r.data }, '[copilot] OpenAI Realtime response missing client secret value');
                return res.status(500).json({
                    success: false,
                    message: 'OpenAI response did not include an ephemeral secret. The Realtime API shape may have changed — check backend logs.',
                });
            }

            return res.json({
                success: true,
                clientSecret,
                expiresAt,
                model,
            });
        } catch (error: any) {
            const status = error.response?.status;
            const oaiErr = error.response?.data?.error;
            logger.error({
                err: error.message,
                status,
                oaiCode: oaiErr?.code,
                oaiMessage: oaiErr?.message,
                body: error.response?.data,
            }, '[copilot] voice session mint threw');
            return res.status(500).json({
                success: false,
                message: oaiErr?.message
                    ? `OpenAI ${status}: ${oaiErr.message}`
                    : (error.code === 'ECONNABORTED' ? 'OpenAI request timed out (15s)' : error.message),
            });
        }
    }

    // Returns the tool schemas the Realtime API needs in a
    // session.update. Also used by the frontend to know what
    // capabilities the voice session has.
    async toolSchemas(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const userId = (req as any).user.id;
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const { schemas } = buildCopilotVoiceTools({
                userId, workspaceId,
                auth: { userId, workspaceId, authKind: 'oauth' } as any,
            });
            return res.json({ success: true, tools: schemas });
        } catch (error: any) {
            logger.error({ err: error.message }, '[copilot] toolSchemas failed');
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Executor called from the browser when the Realtime model emits a
    // `response.function_call_arguments.done` event. Runs the tool
    // under the caller's own workspace/user context (never trusting
    // client-supplied ctx), and returns whatever the MCP tool returned.
    // Same broadcast side-effect as the text-mode path.
    async toolCall(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const userId = (req as any).user.id;
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const body = z.object({
                name: z.string().min(1).max(120),
                args: z.any().optional(),
            }).parse(req.body);
            const { executors } = buildCopilotVoiceTools({
                userId, workspaceId,
                auth: { userId, workspaceId, authKind: 'oauth' } as any,
            });
            const exec = executors.get(body.name);
            if (!exec) return res.status(404).json({ success: false, message: `Unknown tool: ${body.name}` });
            const result = await exec(body.args || {});
            return res.json({ success: true, result });
        } catch (error: any) {
            logger.error({ err: error.message, tool: req.body?.name }, '[copilot] toolCall failed');
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Called by the frontend when the voice session ends, with the
    // total input/output audio seconds tallied client-side. Prices
    // them through AiPricing (openai/gpt-4o-realtime rows) with the
    // plan's copilotVoiceMultiplier, deducts cai, writes ledger.
    async voiceFinish(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const userId = (req as any).user.id;
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const body = z.object({
                inputAudioSeconds: z.number().nonnegative(),
                outputAudioSeconds: z.number().nonnegative(),
                inputTextTokens: z.number().nonnegative().optional(),
                outputTextTokens: z.number().nonnegative().optional(),
                model: z.string().optional(),
            }).parse(req.body);

            // OpenAI Realtime bills audio in tokens: 1 audio-second ≈
            // 100 tokens (rough conversion the docs suggest). We fake
            // the AiResult shape so recordUsagePostHoc can price it.
            const inputTokens = Math.round(body.inputAudioSeconds * 100) + (body.inputTextTokens || 0);
            const outputTokens = Math.round(body.outputAudioSeconds * 100) + (body.outputTextTokens || 0);
            const fakeResult = { usage: { inputTokens, outputTokens } };

            const ws = await loadPlanAccess(workspaceId);
            const multiplier = ws?.plan?.copilotVoiceMultiplier || 5.0;
            // Multiplier applied by faking bigger token counts. Ugly
            // but avoids a second recordUsagePostHoc pathway.
            fakeResult.usage.inputTokens = Math.round(fakeResult.usage.inputTokens * multiplier);
            fakeResult.usage.outputTokens = Math.round(fakeResult.usage.outputTokens * multiplier);

            await recordUsagePostHoc({
                workspaceId,
                userId,
                agentId: null,
                providerInfo: { provider: 'OPENAI', apiKey: '', useOwnKey: false },
                model: body.model || 'gpt-4o-realtime-preview-2024-12-17',
                cause: 'other',
            }, fakeResult);

            return res.json({ success: true });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

// ─── Admin sub-controller ──────────────────────────────────────────
export class AdminCopilotController {
    async getSettings(_req: Request, res: Response) {
        try {
            const [rows, pricing] = await Promise.all([
                prisma.systemConfig.findMany({
                    where: { key: { in: ['COPILOT_SYSTEM_PROMPT', 'COPILOT_PROVIDER', 'COPILOT_MODEL', 'COPILOT_VOICE_MODEL'] } },
                }),
                prisma.aiPricing.findMany({
                    where: { isActive: true },
                    select: { provider: true, model: true },
                    orderBy: [{ provider: 'asc' }, { model: 'asc' }],
                }),
            ]);
            const cfg: Record<string, string> = {};
            for (const r of rows) cfg[r.key] = r.value;

            // Split the pricing catalogue into three model lists so the
            // admin UI can render sensible dropdowns:
            //   textModels    — Anthropic + OpenAI chat models (not realtime)
            //   voiceModels   — OpenAI `-realtime` variants (voice mode only)
            //   (Google/Gemini available too but the copilot backend
            //    only wires Claude/OpenAI right now, so we filter.)
            const textModels = pricing
                .filter(p => (p.provider === 'anthropic' || p.provider === 'openai') && !/realtime/i.test(p.model))
                .map(p => ({ provider: p.provider === 'anthropic' ? 'CLAUDE' : 'OPENAI', model: p.model }));
            const voiceModels = pricing
                .filter(p => p.provider === 'openai' && /realtime/i.test(p.model))
                .map(p => p.model);

            return res.json({
                success: true,
                systemPrompt: cfg.COPILOT_SYSTEM_PROMPT || '',
                defaultSystemPrompt: DEFAULT_COPILOT_PROMPT,
                provider: cfg.COPILOT_PROVIDER || DEFAULT_COPILOT_PROVIDER,
                model: cfg.COPILOT_MODEL || DEFAULT_COPILOT_MODEL,
                voiceModel: cfg.COPILOT_VOICE_MODEL || 'gpt-4o-realtime-preview-2024-12-17',
                textModels,
                voiceModels,
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async saveSettings(req: Request, res: Response) {
        try {
            const body = z.object({
                systemPrompt: z.string().max(20000).optional(),
                provider: z.enum(['CLAUDE', 'OPENAI']).optional(),
                model: z.string().max(120).optional(),
                voiceModel: z.string().max(120).optional(),
            }).parse(req.body);
            const entries: Record<string, string> = {};
            if (body.systemPrompt !== undefined) entries.COPILOT_SYSTEM_PROMPT = body.systemPrompt;
            if (body.provider) entries.COPILOT_PROVIDER = body.provider;
            if (body.model) entries.COPILOT_MODEL = body.model;
            if (body.voiceModel) entries.COPILOT_VOICE_MODEL = body.voiceModel;
            const ops = Object.entries(entries).map(([key, value]) =>
                prisma.systemConfig.upsert({
                    where: { key }, update: { value }, create: { key, value },
                })
            );
            await Promise.all(ops);
            return res.json({ success: true });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

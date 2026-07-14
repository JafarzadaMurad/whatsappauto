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
import { buildCopilotTools } from './copilot.tools';
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
            id: true, name: true,
            copilotCustomPrompt: true,
            plan: { select: { copilotEnabled: true, copilotVoiceEnabled: true, copilotVoiceMultiplier: true } },
        },
    });
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
});

export class CopilotController {
    async config(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const ws = await loadPlanAccess(workspaceId);
            const enabled = !!ws?.plan?.copilotEnabled;
            return res.json({
                success: true,
                enabled,
                voiceEnabled: !!ws?.plan?.copilotVoiceEnabled,
                customPrompt: ws?.copilotCustomPrompt || '',
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

            // 3. Build model — copilot model is admin-selected; the key
            // is always the platform key (this feature is a platform
            // product, never BYOK).
            const { provider, model } = await loadCopilotModel();
            const apiKey = await resolvePlatformKey(provider);
            if (!apiKey) {
                return res.status(500).json({
                    success: false,
                    message: `Platform ${provider} key is not configured. Ask an admin to set it in System Config.`,
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
            const systemPrompt = [
                adminPrompt,
                ws.copilotCustomPrompt ? `\n\n[Workspace-specific rules]\n${ws.copilotCustomPrompt}` : '',
                runtimeCtx,
            ].filter(Boolean).join('');

            // 5. Assemble messages
            const messagesForLlm = [
                ...history.map((m: any) => ({ role: m.role, content: m.content })),
                { role: 'user' as const, content: body.message },
            ];

            const aiModel = buildModel(provider, apiKey, model);
            const t0 = Date.now();
            const result: any = await generateText({
                model: aiModel,
                system: systemPrompt,
                messages: messagesForLlm as any,
                tools,
                stopWhen: stepCountIs(15),
            } as any);
            const durationMs = Date.now() - t0;

            const reply = (result.text || '').trim();
            const toolCalls = (result.steps || []).flatMap((s: any) =>
                (s.toolCalls || []).map((tc: any) => ({
                    name: tc.toolName,
                    args: tc.args ?? tc.input ?? null,
                }))
            );

            // 6. Persist the turn
            const updatedMessages = [
                ...history,
                { role: 'user', content: body.message, at: new Date().toISOString() },
                { role: 'assistant', content: reply, toolCalls, at: new Date().toISOString() },
            ];
            // Auto-derive a title from the first user turn if the session
            // doesn't have one yet — the future history sidebar shows it.
            const title = existing.title || body.message.slice(0, 60);
            await prisma.copilotSession.update({
                where: { id: sessionId },
                data: { messages: updatedMessages, title, updatedAt: new Date() },
            });

            // 7. Bill cai
            void recordUsagePostHoc({
                workspaceId,
                userId,
                agentId: null,
                providerInfo: { provider, apiKey: '', useOwnKey: false },
                model,
                cause: 'other',
            }, result);

            return res.json({
                success: true,
                sessionId,
                reply,
                toolCalls,
                durationMs,
                usage: result.usage,
            });
        } catch (error: any) {
            logger.error({ err: error.message }, '[copilot] chat failed');
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
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

            const openaiKey = await resolvePlatformKey('OPENAI');
            if (!openaiKey) return res.status(500).json({ success: false, message: 'Platform OpenAI key not configured.' });

            const adminPrompt = await loadAdminBasePrompt();
            const runtimeCtx = buildRuntimeContext({ workspaceName: ws.name });
            const instructions = [
                adminPrompt,
                ws.copilotCustomPrompt ? `\n\n[Workspace rules]\n${ws.copilotCustomPrompt}` : '',
                runtimeCtx,
                '\n\n[Voice mode]\nKeep replies short (1-2 sentences) since they will be spoken. Match the user\'s language.',
            ].filter(Boolean).join('');

            const modelRow = await prisma.systemConfig.findUnique({ where: { key: 'COPILOT_VOICE_MODEL' } });
            const model = modelRow?.value?.trim() || 'gpt-4o-realtime-preview-2024-12-17';

            const r = await axios.post('https://api.openai.com/v1/realtime/sessions', {
                model,
                voice: 'alloy',
                instructions,
            }, {
                headers: {
                    Authorization: `Bearer ${openaiKey}`,
                    'Content-Type': 'application/json',
                    'OpenAI-Beta': 'realtime=v1',
                },
                timeout: 15_000,
            });

            return res.json({
                success: true,
                clientSecret: r.data.client_secret?.value,
                expiresAt: r.data.client_secret?.expires_at,
                model,
            });
        } catch (error: any) {
            logger.error({ err: error.response?.data || error.message }, '[copilot] voice session failed');
            return res.status(500).json({ success: false, message: error.response?.data?.error?.message || error.message });
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
            const rows = await prisma.systemConfig.findMany({
                where: { key: { in: ['COPILOT_SYSTEM_PROMPT', 'COPILOT_PROVIDER', 'COPILOT_MODEL', 'COPILOT_VOICE_MODEL'] } },
            });
            const cfg: Record<string, string> = {};
            for (const r of rows) cfg[r.key] = r.value;
            return res.json({
                success: true,
                systemPrompt: cfg.COPILOT_SYSTEM_PROMPT || '',
                defaultSystemPrompt: DEFAULT_COPILOT_PROMPT,
                provider: cfg.COPILOT_PROVIDER || DEFAULT_COPILOT_PROVIDER,
                model: cfg.COPILOT_MODEL || DEFAULT_COPILOT_MODEL,
                voiceModel: cfg.COPILOT_VOICE_MODEL || 'gpt-4o-realtime-preview-2024-12-17',
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

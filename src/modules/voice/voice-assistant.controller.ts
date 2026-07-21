// Voice assistants — the phone-call-facing analogue of Agent. Same
// spirit as agent.controller (list / get / create / update / delete)
// but the shape is Vapi-style: separate transcriber + LLM + TTS
// components each with their own provider/model id.

import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { getWorkspaceId } from '../../lib/workspace-context';
import { logger } from '../../utils/logger';
import {
    TRANSCRIBERS, LLMS, VOICES, VOICE_MODELS, LANGUAGES, PRESETS,
    estimateCostPerMinute,
    findTranscriber, findLlm, findVoice, findVoiceModel,
} from '../../lib/voice-catalog';
import { loadAllowedModels, loadAllowedVoice, normaliseProvider } from '../../lib/model-access';
import { listConfiguredProviders } from '../../lib/ai-pricing';

// Shared editor payload — every field is optional on PATCH, required
// on create (create dupes editor defaults).
const editorPayload = {
    name: z.string().min(1).max(120),
    isPublished: z.boolean().optional(),

    transcriberProvider: z.string().min(1).max(60).optional(),
    transcriberModel: z.string().min(1).max(120).optional(),
    transcriberLanguage: z.string().max(20).nullable().optional(),
    transcriberSmartEndpointing: z.enum(['off', 'vapi', 'livekit']).optional(),
    transcriberFallbackAuto: z.boolean().optional(),
    transcriberFallbacks: z.array(z.object({
        provider: z.string().max(60),
        model: z.string().max(120),
        language: z.string().max(20).nullable().optional(),
    })).max(10).optional(),

    llmProvider: z.string().min(1).max(60).optional(),
    llmModel: z.string().min(1).max(120).optional(),
    llmTemperature: z.number().min(0).max(2).nullable().optional(),
    llmMaxTokens: z.number().int().min(1).max(4000).nullable().optional(),

    ttsProvider: z.string().min(1).max(60).optional(),
    ttsVoiceId: z.string().min(1).max(120).optional(),
    ttsVoiceModel: z.string().max(120).nullable().optional(),
    ttsSpeed: z.number().min(0.5).max(2).nullable().optional(),
    ttsFallbacks: z.array(z.object({
        provider: z.string().max(60),
        voiceId: z.string().max(120),
        voiceModel: z.string().max(120).nullable().optional(),
    })).max(10).optional(),

    systemPrompt: z.string().max(20000).optional(),
    firstMessage: z.string().max(2000).nullable().optional(),
    firstMessageMode: z.enum(['assistant-speaks-first', 'wait-for-user', 'wait-then-assistant-first']).optional(),
    endCallMessage: z.string().max(1000).nullable().optional(),
    voicemailMessage: z.string().max(1000).nullable().optional(),
    endCallPhrases: z.array(z.string().max(60)).max(20).optional(),

    silenceTimeoutSec: z.number().int().min(5).max(300).optional(),
    maxDurationSec: z.number().int().min(30).max(3600).optional(),
    responseDelayMs: z.number().int().min(0).max(3000).optional(),
    numWordsToInterrupt: z.number().int().min(0).max(20).optional(),

    // Speaking / stop plan
    waitSecondsBeforeStart: z.number().min(0).max(4).optional(),
    onPunctuationSeconds: z.number().min(0).max(3).optional(),
    onNoPunctuationSeconds: z.number().min(0).max(3).optional(),
    onNumberSeconds: z.number().min(0).max(3).optional(),
    stopVoiceSeconds: z.number().min(0).max(0.5).optional(),
    stopBackoffSeconds: z.number().min(0).max(10).optional(),

    voicemailDetectionEnabled: z.boolean().optional(),
    voicemailDetectionProvider: z.enum(['twilio', 'google', 'openai']).optional(),

    recordingEnabled: z.boolean().optional(),
    transcriptLoggingEnabled: z.boolean().optional(),
    loggingEnabled: z.boolean().optional(),
    recordingFormat: z.enum(['wav', 'mp3']).optional(),

    backgroundSound: z.enum(['off', 'office', 'cafe']).optional(),
    backgroundDenoise: z.boolean().optional(),

    linkedAgentId: z.string().uuid().nullable().optional(),
    mcpToolNames: z.array(z.string().max(120)).max(200).optional(),
};

const createSchema = z.object({
    ...editorPayload,
    name: z.string().min(1).max(120),
    systemPrompt: z.string().max(20000).default(''),
});

const patchSchema = z.object(editorPayload).partial();

export class VoiceAssistantController {
    // ─── Catalog (no auth-gated on workspace — anyone can render) ───
    async catalog(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            // Plan-scoped allow-list: same rule as text agents (empty
            // array = anything allowed). Only the LLM list is gated —
            // transcriber and TTS providers are not on the plan
            // pricing catalogue, they're voice-only capabilities the
            // admin already provisions via Platform Keys, and Vapi
            // treats them the same way.
            const allowed = workspaceId ? await loadAllowedModels(workspaceId) : [];
            const voice = workspaceId ? await loadAllowedVoice(workspaceId) : { transcribers: [], llms: [], voices: [] };

            // Only show providers whose platform API key is actually
            // configured — otherwise the bridge would crash on select.
            // Union of every provider referenced in the catalogue.
            const allProviders = Array.from(new Set([
                ...TRANSCRIBERS.map(t => t.provider),
                ...LLMS.map(l => l.provider),
                ...VOICES.map(v => v.provider),
                ...VOICE_MODELS.map(v => v.provider),
            ]));
            const installed = await listConfiguredProviders(allProviders);
            const providerInstalled = (p: string) => installed.has(p);

            // Voice-specific list gates. Each list keeps the "empty
            // array = unrestricted" sentinel so plans admins haven't
            // opened yet keep showing the full catalogue.
            const gateTranscriber = (t: { provider: string; model: string }) => {
                if (!providerInstalled(t.provider)) return false;
                if (voice.transcribers.length === 0) return true;
                return voice.transcribers.includes(`${t.provider}:${t.model}`);
            };
            const gateVoice = (v: { provider: string; voiceId: string }) => {
                if (!providerInstalled(v.provider)) return false;
                if (voice.voices.length === 0) return true;
                return voice.voices.includes(`${v.provider}:${v.voiceId}`);
            };
            const gateLlm = (l: { provider: string; model: string }) => {
                if (!providerInstalled(l.provider)) return false;
                // Two gates stacked: legacy text-model list (uppercase
                // provider) AND the new voice-LLM list (raw provider).
                // Both must accept the model. Whichever is empty is
                // treated as unrestricted for that dimension.
                if (allowed.length > 0) {
                    const p = normaliseProvider(l.provider === 'openai-realtime' ? 'OPENAI' : l.provider);
                    if (!allowed.includes(`${p}:${l.model}`)) return false;
                }
                if (voice.llms.length > 0) {
                    if (!voice.llms.includes(`${l.provider}:${l.model}`)) return false;
                }
                return true;
            };
            const gateVoiceModel = (m: { provider: string; id: string }) => providerInstalled(m.provider);

            const transcribers = TRANSCRIBERS.filter(gateTranscriber);
            const llms = LLMS.filter(gateLlm);
            const voices = VOICES.filter(gateVoice);
            const voiceModels = VOICE_MODELS.filter(gateVoiceModel);

            const presetsWithCost = PRESETS
                .map(p => ({
                    ...p,
                    estimate: estimateCostPerMinute({ transcriber: p.transcriber, llm: p.llm, tts: p.tts }),
                }))
                // Drop presets whose LLM / transcriber / voice the plan
                // doesn't cover — no point letting the user pick a
                // preset that would then fail the create/update gates.
                .filter(p => {
                    const [tProv, tModel] = p.transcriber.split(':');
                    const [lProv, lModel] = p.llm.split(':');
                    const [vProv, vId] = p.tts.split(':');
                    return gateTranscriber({ provider: tProv, model: tModel })
                        && gateLlm({ provider: lProv, model: lModel })
                        && gateVoice({ provider: vProv, voiceId: vId });
                });

            const planRestricted = allowed.length > 0
                || voice.transcribers.length > 0
                || voice.llms.length > 0
                || voice.voices.length > 0;

            return res.json({
                success: true,
                transcribers,
                llms,
                voices,
                voiceModels,
                languages: LANGUAGES,
                presets: presetsWithCost,
                planRestricted,
                installedProviders: Array.from(installed),
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async estimate(req: Request, res: Response) {
        try {
            const { transcriber, llm, tts } = z.object({
                transcriber: z.string(),
                llm: z.string(),
                tts: z.string(),
            }).parse(req.body);
            return res.json({ success: true, estimate: estimateCostPerMinute({ transcriber, llm, tts }) });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async list(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const rows = await prisma.voiceAssistant.findMany({
                where: { workspaceId },
                orderBy: { updatedAt: 'desc' },
                include: {
                    _count: { select: { phoneNumbers: true, calls: true } },
                },
            });
            return res.json({ success: true, assistants: rows });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async get(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const row = await prisma.voiceAssistant.findFirst({
                where: { id, workspaceId },
                include: { phoneNumbers: true },
            });
            if (!row) return res.status(404).json({ success: false, message: 'Assistant not found' });
            // Attach a live cost estimate so the editor's toolbar chip
            // reflects any admin-side pricing tweaks without an extra
            // roundtrip.
            const estimate = estimateCostPerMinute({
                transcriber: `${row.transcriberProvider}:${row.transcriberModel}`,
                llm: `${row.llmProvider}:${row.llmModel}`,
                tts: `${row.ttsProvider}:${row.ttsVoiceId}`,
            });
            return res.json({ success: true, assistant: row, estimate });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async create(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const userId = (req as any).user.id;
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const data = createSchema.parse(req.body);

            // Validate the (provider, model) pair actually exists in
            // the catalogue so we don't accept unknown ids the runtime
            // bridge would blow up on later.
            const tProv = data.transcriberProvider || 'deepgram';
            const tModel = data.transcriberModel || 'nova-3';
            const lProv = data.llmProvider || 'openai';
            const lModel = data.llmModel || 'gpt-5.6-luna';
            const vProv = data.ttsProvider || 'openai';
            const vId = data.ttsVoiceId || 'alloy';
            if (!findTranscriber(tProv, tModel)) return res.status(400).json({ success: false, message: `Unknown transcriber ${tProv}/${tModel}` });
            if (!findLlm(lProv, lModel)) return res.status(400).json({ success: false, message: `Unknown LLM ${lProv}/${lModel}` });
            if (!findVoice(vProv, vId)) return res.status(400).json({ success: false, message: `Unknown voice ${vProv}/${vId}` });

            const row = await prisma.voiceAssistant.create({
                data: {
                    workspaceId,
                    userId,
                    name: data.name,
                    isPublished: !!data.isPublished,
                    transcriberProvider: tProv,
                    transcriberModel: tModel,
                    transcriberLanguage: data.transcriberLanguage || null,
                    transcriberSmartEndpointing: data.transcriberSmartEndpointing || 'off',
                    transcriberFallbackAuto: !!data.transcriberFallbackAuto,
                    transcriberFallbacks: (data.transcriberFallbacks || []) as any,
                    llmProvider: lProv,
                    llmModel: lModel,
                    llmTemperature: data.llmTemperature ?? 0.5,
                    llmMaxTokens: data.llmMaxTokens ?? 250,
                    ttsProvider: vProv,
                    ttsVoiceId: vId,
                    ttsVoiceModel: data.ttsVoiceModel || null,
                    ttsSpeed: data.ttsSpeed ?? 1.0,
                    ttsFallbacks: (data.ttsFallbacks || []) as any,
                    systemPrompt: data.systemPrompt || '',
                    firstMessage: data.firstMessage || null,
                    firstMessageMode: data.firstMessageMode || 'assistant-speaks-first',
                    endCallMessage: data.endCallMessage || null,
                    voicemailMessage: data.voicemailMessage || null,
                    endCallPhrases: data.endCallPhrases || [],
                    silenceTimeoutSec: data.silenceTimeoutSec ?? 30,
                    maxDurationSec: data.maxDurationSec ?? 600,
                    responseDelayMs: data.responseDelayMs ?? 400,
                    numWordsToInterrupt: data.numWordsToInterrupt ?? 2,
                    // Speaking / stop plans — Vapi defaults
                    waitSecondsBeforeStart: data.waitSecondsBeforeStart ?? 0.4,
                    onPunctuationSeconds: data.onPunctuationSeconds ?? 0.1,
                    onNoPunctuationSeconds: data.onNoPunctuationSeconds ?? 1.5,
                    onNumberSeconds: data.onNumberSeconds ?? 0.5,
                    stopVoiceSeconds: data.stopVoiceSeconds ?? 0.2,
                    stopBackoffSeconds: data.stopBackoffSeconds ?? 1.0,
                    voicemailDetectionEnabled: !!data.voicemailDetectionEnabled,
                    voicemailDetectionProvider: data.voicemailDetectionProvider || 'twilio',
                    recordingEnabled: data.recordingEnabled ?? true,
                    transcriptLoggingEnabled: data.transcriptLoggingEnabled ?? true,
                    loggingEnabled: data.loggingEnabled ?? true,
                    recordingFormat: data.recordingFormat || 'wav',
                    backgroundSound: data.backgroundSound || 'off',
                    backgroundDenoise: !!data.backgroundDenoise,
                    linkedAgentId: data.linkedAgentId || null,
                    mcpToolNames: data.mcpToolNames || [],
                },
            });
            return res.status(201).json({ success: true, assistant: row });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async update(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const data = patchSchema.parse(req.body);
            const existing = await prisma.voiceAssistant.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Assistant not found' });

            // Same catalog validation on updates as on create — but only
            // when the caller actually touched that component pair.
            if (data.transcriberProvider || data.transcriberModel) {
                const p = data.transcriberProvider || existing.transcriberProvider;
                const m = data.transcriberModel || existing.transcriberModel;
                if (!findTranscriber(p, m)) return res.status(400).json({ success: false, message: `Unknown transcriber ${p}/${m}` });
            }
            if (data.llmProvider || data.llmModel) {
                const p = data.llmProvider || existing.llmProvider;
                const m = data.llmModel || existing.llmModel;
                if (!findLlm(p, m)) return res.status(400).json({ success: false, message: `Unknown LLM ${p}/${m}` });
            }
            if (data.ttsProvider || data.ttsVoiceId) {
                const p = data.ttsProvider || existing.ttsProvider;
                const v = data.ttsVoiceId || existing.ttsVoiceId;
                if (!findVoice(p, v)) return res.status(400).json({ success: false, message: `Unknown voice ${p}/${v}` });
            }

            const row = await prisma.voiceAssistant.update({
                where: { id },
                data,
            });
            return res.json({ success: true, assistant: row });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async remove(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const existing = await prisma.voiceAssistant.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Assistant not found' });
            await prisma.voiceAssistant.delete({ where: { id } });
            return res.json({ success: true });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Mint an OpenAI Realtime ephemeral client secret shaped by this
    // assistant's system prompt + voice + model, so the browser can
    // open a WebRTC session directly to OpenAI (same pattern as the
    // in-app copilot voice mode). Used by the "Talk" button — lets
    // the operator dry-run an assistant WITHOUT provisioning a phone
    // number. NOT billed against PhoneCall — the runtime is a plain
    // browser call, not a Twilio call; a small `web_test` cause line
    // could be added to CreditLedger in a follow-up if we start
    // charging test sessions.
    async testSession(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const asst = await prisma.voiceAssistant.findFirst({ where: { id, workspaceId } });
            if (!asst) return res.status(404).json({ success: false, message: 'Assistant not found' });

            // Voice + model: enforce our OpenAI-friendly defaults —
            // Realtime only accepts specific voice ids and one of the
            // Realtime model families. We fall back to safe values so
            // the "Talk" button still works even if the assistant's
            // pipeline is set to Deepgram/ElevenLabs/etc.
            const { resolvePlatformKey } = await import('../../lib/ai-pricing');
            const openaiKey = await resolvePlatformKey('OPENAI');
            if (!openaiKey) return res.status(500).json({ success: false, message: 'Platform OpenAI key not configured. Set PLATFORM_OPENAI_KEY under Admin → Platform Keys.' });

            const allowedVoices = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer'];
            const voice = (asst.ttsProvider === 'openai' && allowedVoices.includes(asst.ttsVoiceId))
                ? asst.ttsVoiceId
                : 'alloy';
            const model = /realtime/i.test(asst.llmModel) ? asst.llmModel : 'gpt-realtime-2.1';

            const instructions = (asst.systemPrompt || 'You are a helpful assistant.') +
                (asst.firstMessage ? `\n\nOpen the conversation with: "${asst.firstMessage.replace(/"/g, '\\"')}"` : '');

            const axios = (await import('axios')).default;
            const r = await axios.post('https://api.openai.com/v1/realtime/client_secrets', {
                session: { type: 'realtime', model, instructions, voice },
            }, {
                headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
                timeout: 15_000,
                validateStatus: () => true,
            });

            if (r.status >= 400) {
                logger.error({ status: r.status, body: r.data, model }, '[voice-test] OpenAI mint rejected');
                return res.status(500).json({ success: false, message: `OpenAI ${r.status}: ${r.data?.error?.message || 'mint failed'}` });
            }

            const clientSecret = r.data?.value || r.data?.client_secret?.value;
            if (!clientSecret) {
                logger.error({ body: r.data }, '[voice-test] response missing client_secret');
                return res.status(500).json({ success: false, message: 'OpenAI response missing client_secret' });
            }

            return res.json({
                success: true,
                clientSecret,
                expiresAt: r.data?.expires_at || r.data?.client_secret?.expires_at,
                model,
                voice,
                // Pre-computed session config so the client doesn't
                // reproduce the logic and drift out of sync.
                sessionUpdate: {
                    type: 'session.update',
                    session: {
                        type: 'realtime',
                        audio: {
                            input: { transcription: { model: 'gpt-4o-mini-transcribe' } },
                        },
                        // Tools left empty for MVP — the assistant's
                        // tool config plugs in later once WebRTC test
                        // supports MCP passthrough.
                    },
                },
            });
        } catch (error: any) {
            logger.error({ err: error.message }, '[voice-test] session failed');
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Recent call history for the call log page. Client-side paginates
    // for MVP; a `?limit=` param + cursor can come later once volumes
    // grow past a couple hundred rows.
    async listCalls(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            // Optional per-assistant scope so the Logs tab on the
            // editor page can reuse this endpoint verbatim.
            const assistantId = typeof req.query.assistantId === 'string' ? req.query.assistantId : undefined;
            const rows = await prisma.phoneCall.findMany({
                where: { workspaceId, ...(assistantId ? { voiceAssistantId: assistantId } : {}) },
                orderBy: { startedAt: 'desc' },
                take: 200,
                include: {
                    voiceAssistant: { select: { id: true, name: true } },
                    phoneNumber: { select: { id: true, number: true } },
                },
            });
            return res.json({ success: true, calls: rows });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

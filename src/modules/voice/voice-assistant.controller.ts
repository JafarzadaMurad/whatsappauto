// Voice assistants — the phone-call-facing analogue of Agent. Same
// spirit as agent.controller (list / get / create / update / delete)
// but the shape is Vapi-style: separate transcriber + LLM + TTS
// components each with their own provider/model id.

import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { getWorkspaceId } from '../../lib/workspace-context';
import {
    TRANSCRIBERS, LLMS, VOICES, VOICE_MODELS, LANGUAGES, PRESETS,
    estimateCostPerMinute,
    findTranscriber, findLlm, findVoice, findVoiceModel,
} from '../../lib/voice-catalog';

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
    async catalog(_req: Request, res: Response) {
        try {
            // Include a live cost estimate per preset so the UI can
            // render Vapi-style "~$0.22/min · ~500ms" chips without
            // recomputing on the client.
            const presetsWithCost = PRESETS.map(p => ({
                ...p,
                estimate: estimateCostPerMinute({ transcriber: p.transcriber, llm: p.llm, tts: p.tts }),
            }));
            return res.json({
                success: true,
                transcribers: TRANSCRIBERS,
                llms: LLMS,
                voices: VOICES,
                voiceModels: VOICE_MODELS,
                languages: LANGUAGES,
                presets: presetsWithCost,
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

    // Recent call history for the call log page. Client-side paginates
    // for MVP; a `?limit=` param + cursor can come later once volumes
    // grow past a couple hundred rows.
    async listCalls(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const rows = await prisma.phoneCall.findMany({
                where: { workspaceId },
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

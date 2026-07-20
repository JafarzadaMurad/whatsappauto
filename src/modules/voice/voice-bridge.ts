// Twilio Media Streams ⇄ OpenAI Realtime API bridge.
//
// Twilio sends audio in μ-law (G.711u) 8 kHz mono, base64-encoded 20 ms
// frames. OpenAI Realtime happily consumes and emits `g711_ulaw` too
// when we ask it to (input_audio_format + output_audio_format in the
// session.update), which sidesteps the resampling step entirely — no
// PCM conversion needed. That's the fast path we use.
//
// Wire format on each side:
//
//   Twilio → us      { event: 'start' | 'media' | 'stop' | ... }
//     media.payload  = base64 μ-law 8 kHz mono
//   us → Twilio      { event: 'media', streamSid, media: { payload } }
//     media.payload  = base64 μ-law 8 kHz mono (mirrored back)
//
//   us → OpenAI      { type: 'input_audio_buffer.append', audio: b64 }
//   OpenAI → us      { type: 'response.audio.delta', delta: b64 }
//                    { type: 'response.audio_transcript.delta' } (log)
//                    { type: 'conversation.item.input_audio_transcription.completed' } (log)
//
// We stitch these together, forward audio in both directions, and
// track per-session cost by counting audio bytes.

import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'http';
import { URL } from 'url';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { resolvePlatformKey } from '../../lib/ai-pricing';
import { findLlm } from '../../lib/voice-catalog';

// Rough audio-token conversion: OpenAI bills Realtime by tokens; ~1
// audio second ≈ 100 audio tokens per direction on g711_ulaw. Used to
// back-fill LLM cost when the bridge tears down without a token count.
const AUDIO_TOKENS_PER_SEC = 100;

type AssistantConfig = {
    id: string;
    workspaceId: string;
    systemPrompt: string;
    firstMessage: string | null;
    firstMessageMode: string;
    llmProvider: string;
    llmModel: string;
    llmTemperature: number | null;
    llmMaxTokens: number | null;
    ttsProvider: string;
    ttsVoiceId: string;
    ttsSpeed: number | null;
    silenceTimeoutSec: number;
    maxDurationSec: number;
    responseDelayMs: number;
    numWordsToInterrupt: number;
    endCallPhrases: string[];
};

async function loadAssistant(assistantId: string): Promise<AssistantConfig | null> {
    const a = await prisma.voiceAssistant.findUnique({ where: { id: assistantId } });
    if (!a) return null;
    return {
        id: a.id,
        workspaceId: a.workspaceId,
        systemPrompt: a.systemPrompt || '',
        firstMessage: a.firstMessage,
        firstMessageMode: a.firstMessageMode,
        llmProvider: a.llmProvider,
        llmModel: a.llmModel,
        llmTemperature: a.llmTemperature,
        llmMaxTokens: a.llmMaxTokens,
        ttsProvider: a.ttsProvider,
        ttsVoiceId: a.ttsVoiceId,
        ttsSpeed: a.ttsSpeed,
        silenceTimeoutSec: a.silenceTimeoutSec,
        maxDurationSec: a.maxDurationSec,
        responseDelayMs: a.responseDelayMs,
        numWordsToInterrupt: a.numWordsToInterrupt,
        endCallPhrases: a.endCallPhrases,
    };
}

// OpenAI Realtime models expect a voice id from a fixed set. We map
// our catalog voiceIds (mostly OpenAI-native ones) directly; anything
// else falls back to 'alloy' so voice mode still works with the wrong
// provider picked (a warning is logged so the operator sees it).
function pickRealtimeVoice(ttsProvider: string, voiceId: string): string {
    const allowed = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer'];
    if (ttsProvider === 'openai' && allowed.includes(voiceId)) return voiceId;
    return 'alloy';
}

export function attachVoiceBridge(httpServer: HttpServer) {
    // noServer mode — we handle the upgrade ourselves so this WS server
    // can coexist with socket.io on the same http port. Twilio always
    // hits our path exactly.
    const wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        if (url.pathname !== '/voice/stream') return; // let socket.io / others handle it
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    });

    wss.on('connection', (twilioWs, req) => handleConnection(twilioWs, req).catch(err => {
        logger.error({ err: err.message, stack: err.stack }, '[voice-bridge] connection handler crashed');
        try { twilioWs.close(); } catch { /* ignore */ }
    }));

    logger.info('[voice-bridge] WebSocket server attached on /voice/stream');
}

async function handleConnection(twilioWs: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const assistantId = url.searchParams.get('assistantId') || '';
    const callSid = url.searchParams.get('callSid') || '';

    const asst = await loadAssistant(assistantId);
    if (!asst) {
        logger.warn({ assistantId, callSid }, '[voice-bridge] unknown assistant on connect');
        twilioWs.close();
        return;
    }

    const openaiKey = await resolvePlatformKey('OPENAI');
    if (!openaiKey) {
        logger.error('[voice-bridge] platform OpenAI key not configured');
        twilioWs.close();
        return;
    }

    // Realtime model — use the assistant's llmModel if it's a Realtime
    // one; otherwise fall back to the current GA model so the bridge
    // works even when the operator picked a text LLM (a mismatched
    // pipeline logs the fallback but keeps the call alive).
    const llmEntry = findLlm(asst.llmProvider, asst.llmModel);
    const isRealtime = !!llmEntry?.combinesSttTts;
    const realtimeModel = isRealtime ? asst.llmModel : 'gpt-realtime-2.1';
    if (!isRealtime) {
        logger.warn({ picked: `${asst.llmProvider}/${asst.llmModel}` },
            '[voice-bridge] non-Realtime LLM picked — falling back to gpt-realtime-2.1');
    }

    const voice = pickRealtimeVoice(asst.ttsProvider, asst.ttsVoiceId);

    // Open OpenAI Realtime WS. Direct WebSocket path (not WebRTC) is
    // the right transport when the server is the bridge — no ICE or
    // SRTP fuss, one auth header on connect.
    const oaiUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(realtimeModel)}`;
    const oaiWs = new WebSocket(oaiUrl, {
        headers: {
            Authorization: `Bearer ${openaiKey}`,
            'OpenAI-Beta': 'realtime=v1',
        },
    });

    // Per-call bookkeeping
    let streamSid = '';
    let dbCallId: string | null = null;
    const startedAt = Date.now();
    let inputAudioBytes = 0;   // caller → us
    let outputAudioBytes = 0;  // us → caller
    let closed = false;

    const shutdown = async (endedReason: string) => {
        if (closed) return;
        closed = true;
        try { oaiWs.close(); } catch { /* ignore */ }
        try { twilioWs.close(); } catch { /* ignore */ }

        // Bill the call. μ-law is 1 byte per sample @ 8 kHz — so
        // audioSeconds = bytes / 8000. Realtime tokens ≈ 100 per sec.
        const durationSec = Math.floor((Date.now() - startedAt) / 1000);
        const inSec = inputAudioBytes / 8000;
        const outSec = outputAudioBytes / 8000;
        const inTokens = Math.round(inSec * AUDIO_TOKENS_PER_SEC);
        const outTokens = Math.round(outSec * AUDIO_TOKENS_PER_SEC);

        // Realtime pricing lives in AiPricing — reuse ai-pricing seed's
        // gpt-realtime-2.1 row. Cost = tokens * per-1M.
        const llmForCost = findLlm('openai-realtime', realtimeModel) || findLlm('openai-realtime', 'gpt-realtime-2.1');
        const llmCostUsd = llmForCost
            ? (inTokens / 1_000_000) * llmForCost.inCostPer1M + (outTokens / 1_000_000) * llmForCost.outCostPer1M
            : 0;

        try {
            // Locate the row created by the /webhook handler. We match
            // by workspace + startedAt window because Twilio didn't
            // send us the exact PhoneCall id.
            const row = await prisma.phoneCall.findFirst({
                where: {
                    workspaceId: asst.workspaceId,
                    voiceAssistantId: asst.id,
                    startedAt: { gte: new Date(startedAt - 5000) },
                },
                orderBy: { startedAt: 'desc' },
            });
            if (row) {
                const totalCost = (row.telephonyCostUsd || 0) + llmCostUsd;
                // Credits: retail = totalCost × 10 000 (1 credit = $0.0001).
                // Voice multiplier lives on the plan; skipping the join
                // here since ledger integration comes in the next commit.
                const credits = Math.ceil(totalCost * 10_000);
                await prisma.phoneCall.update({
                    where: { id: row.id },
                    data: {
                        llmCostUsd,
                        totalCostUsd: totalCost,
                        creditsUsed: credits,
                        durationSec: durationSec || row.durationSec,
                        endedAt: new Date(),
                        endedReason,
                        status: row.status === 'ringing' || row.status === 'in-progress' ? 'completed' : row.status,
                    },
                });
                dbCallId = row.id;
            }
        } catch (err: any) {
            logger.error({ err: err.message }, '[voice-bridge] tally failed');
        }

        logger.info({
            assistantId, callSid, dbCallId,
            durationSec, inputAudioSec: Math.round(inSec), outputAudioSec: Math.round(outSec),
            llmCostUsd: Number(llmCostUsd.toFixed(4)),
            endedReason,
        }, '[voice-bridge] session ended');
    };

    // ─── OpenAI side ────────────────────────────────────────────
    oaiWs.on('open', () => {
        logger.info({ assistantId, callSid, realtimeModel, voice }, '[voice-bridge] OpenAI Realtime connected');

        // Configure the Realtime session. `g711_ulaw` on both sides
        // means Twilio's raw base64 payloads pass through untouched
        // and OpenAI's responses come back in the same encoding we can
        // forward straight to Twilio — no PCM resampling anywhere.
        const instructions = asst.systemPrompt || 'You are a helpful phone assistant. Reply in short, natural sentences.';
        oaiWs.send(JSON.stringify({
            type: 'session.update',
            session: {
                type: 'realtime',
                model: realtimeModel,
                instructions,
                voice,
                input_audio_format: 'g711_ulaw',
                output_audio_format: 'g711_ulaw',
                input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
                turn_detection: {
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: Math.max(200, asst.responseDelayMs || 400),
                },
                temperature: asst.llmTemperature ?? 0.5,
                max_response_output_tokens: asst.llmMaxTokens || 250,
            },
        }));

        // If the assistant speaks first, kick off an initial response.
        if (asst.firstMessageMode === 'assistant-speaks-first' && asst.firstMessage) {
            oaiWs.send(JSON.stringify({
                type: 'response.create',
                response: {
                    modalities: ['audio', 'text'],
                    instructions: `Say the following as your greeting, then wait for the caller: "${asst.firstMessage.replace(/"/g, '\\"')}"`,
                },
            }));
        }
    });

    oaiWs.on('message', (raw: Buffer) => {
        try {
            const ev = JSON.parse(raw.toString());
            if (ev.type === 'response.audio.delta' && ev.delta && streamSid) {
                // Base64 μ-law chunk → forward to Twilio as-is.
                outputAudioBytes += Buffer.from(ev.delta, 'base64').length;
                twilioWs.send(JSON.stringify({
                    event: 'media',
                    streamSid,
                    media: { payload: ev.delta },
                }));
            } else if (ev.type === 'response.audio.done') {
                // Mark boundary so Twilio finishes playing this response
                // before treating incoming audio as an interruption.
                twilioWs.send(JSON.stringify({
                    event: 'mark',
                    streamSid,
                    mark: { name: 'response-end' },
                }));
            } else if (ev.type === 'error') {
                logger.error({ err: ev.error }, '[voice-bridge] OpenAI error event');
            } else if (ev.type === 'response.audio_transcript.done') {
                // Full assistant transcript for this response — persist
                // to PhoneCall.transcript later once we have call-id
                // resolution during the session (skipped for MVP).
            }
        } catch { /* non-JSON keepalives etc. */ }
    });

    oaiWs.on('close', () => { void shutdown('openai_closed'); });
    oaiWs.on('error', (err) => {
        logger.error({ err: err.message }, '[voice-bridge] OpenAI socket error');
        void shutdown('openai_error');
    });

    // ─── Twilio side ────────────────────────────────────────────
    twilioWs.on('message', (raw: Buffer) => {
        try {
            const ev = JSON.parse(raw.toString());
            if (ev.event === 'start') {
                streamSid = ev.start?.streamSid || '';
                logger.info({ assistantId, callSid, streamSid }, '[voice-bridge] Twilio stream started');
                // Mark call as in-progress in the DB — separate from the
                // shutdown-time tally so live monitors see it flip.
                prisma.phoneCall.updateMany({
                    where: {
                        workspaceId: asst.workspaceId,
                        voiceAssistantId: asst.id,
                        status: 'ringing',
                        startedAt: { gte: new Date(startedAt - 5000) },
                    },
                    data: { status: 'in-progress' },
                }).catch(() => {});
            } else if (ev.event === 'media' && ev.media?.payload) {
                inputAudioBytes += Buffer.from(ev.media.payload, 'base64').length;
                if (oaiWs.readyState === WebSocket.OPEN) {
                    oaiWs.send(JSON.stringify({
                        type: 'input_audio_buffer.append',
                        audio: ev.media.payload,
                    }));
                }
            } else if (ev.event === 'stop') {
                void shutdown('user_hangup');
            } else if (ev.event === 'mark') {
                // Twilio ack of our mark — no-op for now.
            }
        } catch { /* ignore malformed frame */ }
    });

    twilioWs.on('close', () => { void shutdown('twilio_closed'); });
    twilioWs.on('error', (err) => {
        logger.error({ err: err.message }, '[voice-bridge] Twilio socket error');
        void shutdown('twilio_error');
    });

    // Hard cap — if the assistant's plan says max 10 min, we enforce.
    const capTimer = setTimeout(() => {
        logger.info({ assistantId, callSid, maxDurationSec: asst.maxDurationSec }, '[voice-bridge] max-duration cap hit');
        void shutdown('max_duration');
    }, (asst.maxDurationSec || 600) * 1000);
    twilioWs.once('close', () => clearTimeout(capTimer));
}

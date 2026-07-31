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
        // Accept both /voice/stream and /api/voice/stream, with or
        // without the /<assistantId>/<callSid> suffix. Caddy proxies
        // /api/* to the backend and everything else to Next.js, so the
        // /api-prefixed form is the one Twilio must use; the bare form
        // stays for local development.
        const isStreamPath = /^\/(api\/)?voice\/stream(\/|$)/.test(url.pathname);
        if (!isStreamPath) return;
        // Log the raw URL — the identifiers live in the path now, and
        // when this goes wrong the only useful question is what Twilio
        // actually sent us.
        logger.info(`[voice-bridge] upgrade received — accepting · url="${req.url}"`);
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    });

    wss.on('connection', (twilioWs, req) => {
        logger.info(`[voice-bridge] WSS connection open · url="${req.url}"`);
        handleConnection(twilioWs, req).catch(err => {
            logger.error({ err: err.message, stack: err.stack }, '[voice-bridge] connection handler crashed');
            try { twilioWs.close(); } catch { /* ignore */ }
        });
    });

    logger.info('[voice-bridge] WebSocket server attached on /voice/stream');
}

async function handleConnection(twilioWs: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url || '', `http://${req.headers.host}`);

    // Path form: /api/voice/stream/<assistantId>/<callSid>
    // Query form is still accepted so a call placed before this change
    // (or a local test) keeps working.
    const segments = url.pathname.split('/').filter(Boolean);
    const streamIdx = segments.indexOf('stream');
    const assistantId = (streamIdx >= 0 ? segments[streamIdx + 1] : '')
        || url.searchParams.get('assistantId')
        || '';
    const callSid = decodeURIComponent(
        (streamIdx >= 0 ? segments[streamIdx + 2] : '') || url.searchParams.get('callSid') || ''
    );

    const asst = await loadAssistant(assistantId);
    if (!asst) {
        // Single line, with the raw URL — when this fires the question
        // is always "what did we actually receive", and the structured
        // fields end up on lines a grep drops.
        logger.warn(
            `[voice-bridge] unknown assistant on connect · assistantId="${assistantId}" ` +
            `callSid="${callSid}" url="${req.url}"`
        );
        twilioWs.close();
        return;
    }
    logger.info(`[voice-bridge] session starting · assistant=${assistantId} callSid=${callSid}`);

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
    // Map any legacy `2.1` id from the old seed to the GA name so
    // in-flight assistants keep working after the rename.
    const legacyMap: Record<string, string> = {
        'gpt-realtime-2.1': 'gpt-realtime',
        'gpt-realtime-2.1-mini': 'gpt-realtime-mini',
    };
    const canonicalModel = legacyMap[asst.llmModel] || asst.llmModel;
    const realtimeModel = isRealtime ? canonicalModel : 'gpt-realtime';
    if (!isRealtime) {
        logger.warn({ picked: `${asst.llmProvider}/${asst.llmModel}` },
            '[voice-bridge] non-Realtime LLM picked — falling back to gpt-realtime');
    }

    const voice = pickRealtimeVoice(asst.ttsProvider, asst.ttsVoiceId);

    // Open OpenAI Realtime WS. Direct WebSocket path (not WebRTC) is
    // the right transport when the server is the bridge — no ICE or
    // SRTP fuss, one auth header on connect.
    const oaiUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(realtimeModel)}`;
    const oaiWs = new WebSocket(oaiUrl, {
        headers: {
            Authorization: `Bearer ${openaiKey}`,
        },
    });

    // Per-call bookkeeping
    let streamSid = '';
    let dbCallId: string | null = null;
    const startedAt = Date.now();
    let inputAudioBytes = 0;   // caller → us
    let outputAudioBytes = 0;  // us → caller
    let closed = false;
    // Turn-by-turn transcript accumulator. Each entry is one utterance.
    // { role: 'assistant' | 'user', text, at }
    const transcript: Array<{ role: 'assistant' | 'user'; text: string; at: number }> = [];
    // Diagnostic log — every OpenAI/Twilio error we see gets appended
    // here and written to PhoneCall.errorLog on shutdown so the
    // operator can see WHY the assistant hung up.
    // Set when the assistant decides the call is over — either through
    // the end_call tool or a configured closing phrase. We finish
    // speaking before tearing the socket down.
    let pendingHangup = false;
    let hangupReason = 'assistant_ended';
    const diag: string[] = [];
    const logDiag = (line: string) => {
        const stamped = `[${new Date().toISOString()}] ${line}`;
        diag.push(stamped);
        if (diag.length > 200) diag.shift();
    };

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
        // gpt-realtime row. Cost = tokens * per-1M.
        const llmForCost = findLlm('openai-realtime', realtimeModel) || findLlm('openai-realtime', 'gpt-realtime');
        const llmCostUsd = llmForCost
            ? (inTokens / 1_000_000) * llmForCost.inCostPer1M + (outTokens / 1_000_000) * llmForCost.outCostPer1M
            : 0;

        try {
            // Prefer the reliable CallSid match — outbound rows are
            // created seconds-to-minutes before the bridge starts, so
            // the old "startedAt within 5s" window missed them and no
            // diagnostics were persisted. Fall back to the fuzzy match
            // for rows that predate the twilioCallSid column.
            const row = (callSid && await prisma.phoneCall.findFirst({
                where: { twilioCallSid: callSid },
            })) || await prisma.phoneCall.findFirst({
                where: {
                    workspaceId: asst.workspaceId,
                    voiceAssistantId: asst.id,
                    startedAt: { gte: new Date(startedAt - 5 * 60_000) },
                },
                orderBy: { startedAt: 'desc' },
            });
            if (row) {
                const totalCost = (row.telephonyCostUsd || 0) + llmCostUsd;
                const credits = Math.ceil(totalCost * 10_000);
                // If we never sent a single audio delta AND we saw at
                // least one diagnostic entry, this was a broken bridge
                // (usually OpenAI rejecting our session config). Mark
                // it 'failed' so the operator can spot it in the list
                // without opening every row.
                const sawOutput = outputAudioBytes > 0;
                const nextStatus = (!sawOutput && diag.length > 0)
                    ? 'failed'
                    : (row.status === 'ringing' || row.status === 'in-progress' ? 'completed' : row.status);
                await prisma.phoneCall.update({
                    where: { id: row.id },
                    data: {
                        llmCostUsd,
                        totalCostUsd: totalCost,
                        creditsUsed: credits,
                        durationSec: durationSec || row.durationSec,
                        endedAt: new Date(),
                        endedReason,
                        status: nextStatus,
                        transcript: transcript.length ? (transcript as any) : undefined,
                        errorLog: diag.length ? diag.join('\n') : undefined,
                    },
                });
                dbCallId = row.id;
            } else {
                // No row match at all — log the diagnostics so `pm2 logs`
                // still has a trace even though DB persistence failed.
                if (diag.length > 0) {
                    logger.warn({ assistantId, callSid, diag }, '[voice-bridge] no PhoneCall row matched — orphan diagnostics');
                }
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
        logDiag(`OpenAI Realtime connected · model=${realtimeModel} · voice=${voice}`);

        // GA session.update shape:
        //   audio.input:  format + transcription + noise_reduction + VAD (turn_detection)
        //   audio.output: format + voice + speed
        // The old top-level `voice`/`input_audio_format`/`output_audio_format`/
        // `input_audio_transcription` still work on the *legacy* preview
        // models but are rejected on `gpt-realtime` (GA) with a
        // `unknown_parameter` error — which was crashing the session
        // immediately after connect and making Twilio speak "an
        // application error has occurred".
        const instructions = asst.systemPrompt || 'You are a helpful phone assistant. Reply in short, natural sentences.';
        oaiWs.send(JSON.stringify({
            type: 'session.update',
            session: {
                type: 'realtime',
                model: realtimeModel,
                instructions,
                audio: {
                    input: {
                        // GA takes a format *object*; the old string form
                        // ("g711_ulaw") is rejected outright. `audio/pcmu`
                        // is G.711 μ-law, which is what Twilio Media
                        // Streams carry — matching it on both sides keeps
                        // the audio a straight pass-through with no
                        // resampling in either direction.
                        format: { type: 'audio/pcmu' },
                        transcription: { model: 'gpt-4o-mini-transcribe' },
                        turn_detection: {
                            type: 'server_vad',
                            threshold: 0.5,
                            prefix_padding_ms: 300,
                            silence_duration_ms: Math.max(200, asst.responseDelayMs || 400),
                        },
                    },
                    output: {
                        format: { type: 'audio/pcmu' },
                        voice,
                        speed: asst.ttsSpeed ?? 1.0,
                    },
                },
                // Uncapped by default. A token limit doesn't produce a
                // shorter answer — the model plans a full one and is cut
                // off mid-word when the budget runs out, which is what
                // made replies trail off ("Bu ev dənizin q"). Keeping
                // answers short is the system prompt's job. 250 was the
                // old default nobody chose, so treat it as uncapped too;
                // anything an operator deliberately raised is honoured.
                max_output_tokens: (asst.llmMaxTokens && asst.llmMaxTokens > 250)
                    ? asst.llmMaxTokens
                    : 'inf',
                // Let the assistant hang up. Without this it says goodbye
                // and then both sides sit in silence until the caller
                // gives up or the duration cap fires — the call reads as
                // broken even though the conversation went fine.
                tools: [{
                    type: 'function',
                    name: 'end_call',
                    description:
                        'Hang up the phone. Call this once the conversation has genuinely finished — ' +
                        'after saying goodbye, when the caller says they are done, or when there is ' +
                        'nothing further to help with. Say your closing line first; the call ends ' +
                        'after you finish speaking.',
                    parameters: {
                        type: 'object',
                        properties: {
                            reason: {
                                type: 'string',
                                description: 'Short note on why the call ended, for the call log.',
                            },
                        },
                        required: [],
                    },
                }],
                tool_choice: 'auto',
            },
        }));

        // If the assistant speaks first, kick off an initial response.
        // GA renamed `modalities` → `output_modalities` — passing the
        // old name is silently ignored (no audio comes back), so ensure
        // we send the new one.
        if (asst.firstMessageMode === 'assistant-speaks-first' && asst.firstMessage) {
            oaiWs.send(JSON.stringify({
                type: 'response.create',
                response: {
                    output_modalities: ['audio'],
                    instructions: `Say the following as your greeting, then wait for the caller: "${asst.firstMessage.replace(/"/g, '\\"')}"`,
                },
            }));
        }
    });

    oaiWs.on('message', (raw: Buffer) => {
        try {
            const ev = JSON.parse(raw.toString());
            // GA renamed most `response.audio.*` events to `response.output_audio.*`.
            // Accept both so we work across the API's rolling rename.
            const isAudioDelta = (ev.type === 'response.audio.delta' || ev.type === 'response.output_audio.delta') && ev.delta;
            const isAudioDone = ev.type === 'response.audio.done' || ev.type === 'response.output_audio.done';
            const isTranscriptDone = ev.type === 'response.audio_transcript.done' || ev.type === 'response.output_audio_transcript.done';

            if (isAudioDelta && streamSid) {
                // Base64 μ-law chunk → forward to Twilio as-is.
                outputAudioBytes += Buffer.from(ev.delta, 'base64').length;
                twilioWs.send(JSON.stringify({
                    event: 'media',
                    streamSid,
                    media: { payload: ev.delta },
                }));
            } else if (isAudioDone) {
                twilioWs.send(JSON.stringify({
                    event: 'mark',
                    streamSid,
                    mark: { name: 'response-end' },
                }));
            } else if (ev.type === 'error') {
                const err = ev.error || {};
                const line = `OpenAI error · ${err.type || 'error'} · ${err.code || '-'} · ${err.message || 'no message'}${err.param ? ` · param=${err.param}` : ''}`;
                logger.error({ err }, '[voice-bridge] ' + line);
                logDiag(line);
            } else if (ev.type === 'response.function_call_arguments.done' && ev.name === 'end_call') {
                // The assistant asked to hang up. Acknowledge the call so
                // the model can deliver a closing line, then end once it
                // stops speaking — cutting the audio here would clip the
                // goodbye mid-word.
                let reason = 'assistant_ended';
                try {
                    const args = ev.arguments ? JSON.parse(ev.arguments) : {};
                    if (args?.reason) reason = String(args.reason).slice(0, 120);
                } catch { /* arguments are advisory */ }
                logDiag(`assistant requested end_call · reason=${reason}`);
                hangupReason = reason;
                pendingHangup = true;
                oaiWs.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                        type: 'function_call_output',
                        call_id: ev.call_id,
                        output: JSON.stringify({ ok: true }),
                    },
                }));
                oaiWs.send(JSON.stringify({ type: 'response.create' }));
            } else if (ev.type === 'response.done' && pendingHangup) {
                // Closing line delivered — let the last audio frames reach
                // the caller before tearing the socket down.
                setTimeout(() => void shutdown(hangupReason), 1200).unref?.();
            } else if (isTranscriptDone) {
                const text = String(ev.transcript || '').trim();
                if (text) {
                    transcript.push({ role: 'assistant', text, at: Date.now() });
                    // Fallback for assistants configured with end-call
                    // phrases instead of relying on the tool.
                    if (!pendingHangup && asst.endCallPhrases?.length) {
                        const lower = text.toLowerCase();
                        if (asst.endCallPhrases.some(p => p && lower.includes(p.toLowerCase()))) {
                            logDiag(`end-call phrase matched in assistant reply`);
                            pendingHangup = true;
                            hangupReason = 'end_call_phrase';
                            setTimeout(() => void shutdown(hangupReason), 1500).unref?.();
                        }
                    }
                }
            } else if (ev.type === 'conversation.item.input_audio_transcription.completed') {
                const text = String(ev.transcript || '').trim();
                if (text) transcript.push({ role: 'user', text, at: Date.now() });
            }
        } catch { /* non-JSON keepalives etc. */ }
    });

    oaiWs.on('close', (code, reason) => {
        const line = `OpenAI socket closed · code=${code} · reason=${reason?.toString() || '-'}`;
        logDiag(line);
        void shutdown('openai_closed');
    });
    oaiWs.on('error', (err: any) => {
        const line = `OpenAI socket error · ${err.message || err.code || err}`;
        logger.error({ err: err.message }, '[voice-bridge] ' + line);
        logDiag(line);
        void shutdown('openai_error');
    });
    // 5-second connect timeout — if the WSS handshake never completes,
    // we should shut down cleanly rather than let Twilio play silence.
    const connectTimer = setTimeout(() => {
        if (oaiWs.readyState !== WebSocket.OPEN) {
            logDiag(`OpenAI WS connect timeout after 5 s (readyState=${oaiWs.readyState})`);
            void shutdown('openai_connect_timeout');
        }
    }, 5000);
    oaiWs.once('open', () => clearTimeout(connectTimer));

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

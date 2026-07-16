"use client";

// WebRTC client for OpenAI Realtime API (GA). Flow:
//   1. Ask backend for an ephemeral session token (server holds the master key)
//   2. Open a WebRTC PeerConnection to api.openai.com/v1/realtime/calls
//   3. When the data channel opens, push a session.update carrying:
//        - input_audio_transcription (so we see what the user said)
//        - tools[] (fetched from /copilot/tool-schemas) so the model can
//          actually create agents / send messages / etc. by voice
//   4. Route data-channel events:
//        - conversation.item.input_audio_transcription.completed → user text
//        - response.audio_transcript.done                        → agent text
//        - response.function_call_arguments.done                 → forward to
//          /copilot/tool-call, then send the result back over the DC and
//          fire response.create so the model continues speaking
//   5. On disconnect, sum up audio-seconds and post to /voice/finish for cai billing

import { useRef, useCallback } from "react";
import api from "@/lib/api";
import { useCopilotStore } from "@/store/copilotStore";

type Options = {
    onEnd?: () => void;
    onError?: (message: string) => void;
};

type RealtimeEvent = { type: string; [k: string]: any };

export function useCopilotVoice({ onEnd, onError }: Options) {
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const audioElRef = useRef<HTMLAudioElement | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const dcRef = useRef<RTCDataChannel | null>(null);
    const startedAtRef = useRef<number | null>(null);
    const modelRef = useRef<string | null>(null);
    const toolsRef = useRef<any[]>([]);

    const { setVoiceActive, pushMessage } = useCopilotStore();

    const sendEvent = useCallback((ev: RealtimeEvent) => {
        const dc = dcRef.current;
        if (dc && dc.readyState === 'open') {
            try { dc.send(JSON.stringify(ev)); }
            catch (e) { console.error('[copilot voice] send failed', e); }
        }
    }, []);

    // ─── Data-channel event dispatch ─────────────────────────────────
    const handleDcEvent = useCallback(async (raw: string) => {
        let ev: RealtimeEvent;
        try { ev = JSON.parse(raw); } catch { return; }

        switch (ev.type) {
            // User's speech transcribed after they stopped talking
            case 'conversation.item.input_audio_transcription.completed': {
                const text = String(ev.transcript || '').trim();
                if (text) {
                    pushMessage({ role: 'user', content: text, at: new Date().toISOString() });
                }
                break;
            }
            // Agent's speech transcript — 'done' fires once at the end
            case 'response.audio_transcript.done': {
                const text = String(ev.transcript || '').trim();
                if (text) {
                    pushMessage({ role: 'assistant', content: text, at: new Date().toISOString() });
                }
                break;
            }
            // Function call arguments fully assembled — run it
            case 'response.function_call_arguments.done': {
                const name = ev.name;
                const callId = ev.call_id;
                let args: any = {};
                try { args = ev.arguments ? JSON.parse(ev.arguments) : {}; }
                catch { args = {}; }
                try {
                    const res = await api.post('/copilot/tool-call', { name, args });
                    const output = res.data?.success
                        ? JSON.stringify(res.data.result || {})
                        : JSON.stringify({ error: res.data?.message || 'tool call failed' });
                    // Deliver the tool result back to the model.
                    sendEvent({
                        type: 'conversation.item.create',
                        item: {
                            type: 'function_call_output',
                            call_id: callId,
                            output,
                        },
                    });
                    // Ask the model to continue speaking after digesting the result.
                    sendEvent({ type: 'response.create' });
                } catch (err: any) {
                    const errMsg = err.response?.data?.message || err.message || 'tool call failed';
                    console.error('[copilot voice] tool call error', name, errMsg);
                    sendEvent({
                        type: 'conversation.item.create',
                        item: {
                            type: 'function_call_output',
                            call_id: callId,
                            output: JSON.stringify({ error: errMsg }),
                        },
                    });
                    sendEvent({ type: 'response.create' });
                }
                break;
            }
            // Errors from the Realtime side land here — surface loudly
            case 'error': {
                console.error('[copilot voice] server event error', ev);
                if (onError) {
                    onError(`OpenAI: ${ev.error?.message || ev.message || 'unknown error'}`);
                }
                break;
            }
        }
    }, [pushMessage, sendEvent, onError]);

    const stop = useCallback(async () => {
        try {
            const durationSec = startedAtRef.current ? (Date.now() - startedAtRef.current) / 1000 : 0;
            const inputAudioSeconds = durationSec / 2;
            const outputAudioSeconds = durationSec / 2;

            if (dcRef.current) {
                try { dcRef.current.close(); } catch { /* ignore */ }
                dcRef.current = null;
            }
            if (pcRef.current) {
                pcRef.current.close();
                pcRef.current = null;
            }
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(t => t.stop());
                localStreamRef.current = null;
            }
            if (audioElRef.current) {
                audioElRef.current.srcObject = null;
                audioElRef.current.remove();
                audioElRef.current = null;
            }
            setVoiceActive(false);
            startedAtRef.current = null;

            if (durationSec > 0.5) {
                await api.post('/copilot/voice/finish', {
                    inputAudioSeconds,
                    outputAudioSeconds,
                    model: modelRef.current || undefined,
                }).catch(() => {});
            }
            onEnd?.();
        } catch (err) {
            console.error('[copilot voice] stop error', err);
        }
    }, [setVoiceActive, onEnd]);

    const start = useCallback(async () => {
        try {
            // 1. Fetch tool schemas + mint ephemeral token in parallel
            const [tokenRes, toolsRes] = await Promise.all([
                api.post('/copilot/voice/session'),
                api.get('/copilot/tool-schemas').catch(() => ({ data: { success: false } })),
            ]);
            if (!tokenRes.data.success) throw new Error(tokenRes.data.message || 'Failed to open voice session');
            const clientSecret = tokenRes.data.clientSecret;
            const model = tokenRes.data.model;
            modelRef.current = model;
            toolsRef.current = toolsRes.data?.success ? (toolsRes.data.tools || []) : [];

            // 2. Set up PeerConnection
            const pc = new RTCPeerConnection();
            pcRef.current = pc;

            const audioEl = document.createElement('audio');
            audioEl.autoplay = true;
            document.body.appendChild(audioEl);
            audioElRef.current = audioEl;
            pc.ontrack = (ev) => { audioEl.srcObject = ev.streams[0]; };

            const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            localStreamRef.current = localStream;
            localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

            // 3. Data channel — carries every Realtime API event
            const dc = pc.createDataChannel('oai-events');
            dcRef.current = dc;
            dc.onmessage = (ev) => { void handleDcEvent(String(ev.data)); };
            dc.onopen = () => {
                // The moment the DC is up, extend the session config:
                //   - turn on transcription of the user's mic
                //   - install the workspace's copilot tool schemas so the
                //     model can create agents, send messages, etc. by voice
                // GA schema requires session.type: "realtime" — without it
                // the server rejects with `Missing required parameter: session.type`.
                sendEvent({
                    type: 'session.update',
                    session: {
                        type: 'realtime',
                        input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
                        tools: toolsRef.current,
                        tool_choice: toolsRef.current.length > 0 ? 'auto' : 'none',
                    },
                });
            };

            // 4. SDP offer/answer with OpenAI — GA endpoint
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
                method: 'POST',
                body: offer.sdp,
                headers: {
                    Authorization: `Bearer ${clientSecret}`,
                    'Content-Type': 'application/sdp',
                },
            });
            if (!sdpRes.ok) {
                const errBody = await sdpRes.text().catch(() => '');
                throw new Error(`OpenAI SDP handshake failed (${sdpRes.status}): ${errBody.slice(0, 300) || 'no error body'}`);
            }
            const answer = { type: 'answer' as const, sdp: await sdpRes.text() };
            await pc.setRemoteDescription(answer);

            startedAtRef.current = Date.now();
            setVoiceActive(true);

            pc.oniceconnectionstatechange = () => {
                if (['closed', 'failed', 'disconnected'].includes(pc.iceConnectionState)) {
                    void stop();
                }
            };
        } catch (err: any) {
            const message = err.response?.data?.message
                || err.message
                || 'Failed to start voice session';
            console.error('[copilot voice] start error:', message, err.response?.data);
            if (onError) onError(message);
            else alert(message);
            await stop();
        }
    }, [setVoiceActive, stop, onError, sendEvent, handleDcEvent]);

    return { start, stop };
}

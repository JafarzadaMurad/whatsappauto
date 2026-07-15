"use client";

// WebRTC client for OpenAI Realtime API. Flow:
//   1. Ask our backend for an ephemeral session token (mints via
//      /api/copilot/voice/session — server holds the master key).
//   2. Open a WebRTC PeerConnection to api.openai.com/v1/realtime,
//      exchange SDP, get bidirectional audio.
//   3. On disconnect, sum up audio-second counters we accumulate and
//      POST /api/copilot/voice/finish so cai gets deducted.
//
// The peer connection lives on the client — our backend never sees
// audio, keeps latency low and bandwidth off our server.

import { useRef, useCallback } from "react";
import api from "@/lib/api";
import { useCopilotStore } from "@/store/copilotStore";

type Options = {
    onEnd?: () => void;
    onError?: (message: string) => void;
};

export function useCopilotVoice({ onEnd, onError }: Options) {
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const audioElRef = useRef<HTMLAudioElement | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const startedAtRef = useRef<number | null>(null);
    const modelRef = useRef<string | null>(null);

    const { setVoiceActive } = useCopilotStore();

    const stop = useCallback(async () => {
        try {
            const durationSec = startedAtRef.current ? (Date.now() - startedAtRef.current) / 1000 : 0;
            // Half in / half out is the pragmatic split when we don't
            // have real per-direction counters from the SDK.
            const inputAudioSeconds = durationSec / 2;
            const outputAudioSeconds = durationSec / 2;

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
            // 1. Mint ephemeral token
            const tokenRes = await api.post('/copilot/voice/session');
            if (!tokenRes.data.success) throw new Error(tokenRes.data.message || 'Failed to open voice session');
            const clientSecret = tokenRes.data.clientSecret;
            const model = tokenRes.data.model;
            modelRef.current = model;

            // 2. Set up PeerConnection
            const pc = new RTCPeerConnection();
            pcRef.current = pc;

            // Downstream audio → hidden <audio> element
            const audioEl = document.createElement('audio');
            audioEl.autoplay = true;
            document.body.appendChild(audioEl);
            audioElRef.current = audioEl;
            pc.ontrack = (ev) => { audioEl.srcObject = ev.streams[0]; };

            // Upstream mic
            const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            localStreamRef.current = localStream;
            localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

            // Data channel — future tool calls / events
            const dc = pc.createDataChannel('oai-events');
            dc.onmessage = (_ev) => {
                // Realtime API sends events here (transcripts, tool calls).
                // We don't wire them into the UI yet; the audio is what matters.
            };

            // 3. SDP offer/answer with OpenAI.
            // GA endpoint (Aug 2025) is /v1/realtime/calls — the old
            // /v1/realtime?model=... path was removed and now returns
            // "400 Invalid request" on SDP POSTs. The model already
            // lives inside the ephemeral client_secret we minted, so
            // the query param is no longer needed.
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
                // Surface the actual OpenAI error body — the raw HTTP
                // status alone hides the reason (wrong endpoint, expired
                // token, model not enabled on the org, …).
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
            // Prefer the backend's structured message (`response.data.message`)
            // over the generic axios "Request failed with status code 500" —
            // the server side puts the actual reason there.
            const message = err.response?.data?.message
                || err.message
                || 'Failed to start voice session';
            console.error('[copilot voice] start error:', message, err.response?.data);
            if (onError) onError(message);
            else alert(message);
            await stop();
        }
    }, [setVoiceActive, stop, onError]);

    return { start, stop };
}

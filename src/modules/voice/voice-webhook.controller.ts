// Twilio webhook + call-status handler.
//
// Flow:
//   1. Someone calls the workspace's Twilio number.
//   2. Twilio POSTs /api/voice/webhook with { CallSid, From, To, ... }.
//   3. We look up PhoneNumber → VoiceAssistant.
//   4. Respond with TwiML that opens a Media Stream to our WebSocket
//      endpoint /voice/stream (mounted directly on the http server —
//      see server.ts). The stream URL carries the assistant id so the
//      bridge can build the right OpenAI Realtime session.
//   5. Twilio dials the stream, we bridge audio in both directions
//      until either side hangs up.
//   6. Twilio POSTs /api/voice/status when the call ends → we compute
//      final duration + cost and deduct credits.

import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { config } from '../../config';

function wsBase(): string {
    // Same host as FRONTEND_URL but wss:// scheme. Twilio media streams
    // MUST be secure WebSocket in production — Twilio rejects ws://.
    const base = (config.FRONTEND_URL || 'https://chatbot.tural.ai').replace(/^https?:\/\//, '');
    return `wss://${base.replace(/\/$/, '')}`;
}

export class VoiceWebhookController {
    // Inbound-call webhook. Twilio calls us with form-encoded params.
    // We reply with TwiML in <60 s or Twilio drops the call.
    async webhook(req: Request, res: Response) {
        try {
            const to = String(req.body?.To || '');
            const from = String(req.body?.From || '');
            const callSid = String(req.body?.CallSid || '');

            const numberRow = await prisma.phoneNumber.findFirst({
                where: { number: to, isActive: true },
                include: {
                    voiceAssistant: true,
                    workspace: { select: { id: true } },
                },
            });

            // No assistant → play a short "not available" message and
            // hang up so Twilio doesn't leave the caller hanging.
            if (!numberRow || !numberRow.voiceAssistant) {
                logger.warn({ to, from, callSid }, '[voice] inbound call to unassigned number');
                res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">This number is not currently assigned to an assistant.</Say>
  <Hangup/>
</Response>`);
                return;
            }

            // Log the call as it starts. `startedAt` = now; duration +
            // costs get filled on the /status hook.
            await prisma.phoneCall.create({
                data: {
                    workspaceId: numberRow.workspace.id,
                    voiceAssistantId: numberRow.voiceAssistant.id,
                    phoneNumberId: numberRow.id,
                    direction: 'inbound',
                    fromNumber: from,
                    toNumber: to,
                    status: 'ringing',
                    startedAt: new Date(),
                },
            }).catch(err => logger.error({ err: err.message, callSid }, '[voice] create call row failed'));

            // Store the assistantId in the stream URL as a custom
            // parameter (Twilio forwards it to us on WS connect). Prefer
            // path-based routing so the WS server can dispatch fast
            // without parsing query strings.
            const streamUrl = `${wsBase()}/voice/stream?assistantId=${numberRow.voiceAssistant.id}&callSid=${encodeURIComponent(callSid)}`;

            // <Connect><Stream> pipes bi-directional linear16 μ-law audio
            // over the WebSocket. `track="inbound_track"` alone streams
            // the caller's audio only; unspecified streams both, which
            // is what our bridge expects.
            res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}"/>
  </Connect>
</Response>`);
        } catch (error: any) {
            logger.error({ err: error.message, stack: error.stack }, '[voice] webhook error');
            res.type('text/xml').status(500).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>An internal error occurred. Please try again later.</Say><Hangup/></Response>`);
        }
    }

    // Twilio fires status on every state transition. The one we care
    // about is `completed` — that's when Duration is final.
    async status(req: Request, res: Response) {
        try {
            const callSid = String(req.body?.CallSid || '');
            const callStatus = String(req.body?.CallStatus || '');
            const callDuration = Number(req.body?.CallDuration || 0);

            const call = await prisma.phoneCall.findFirst({
                where: {
                    startedAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 12) },
                    // Match by phoneNumberId + fromNumber to isolate to
                    // the right row (Twilio doesn't send our internal id).
                    fromNumber: String(req.body?.From || ''),
                    toNumber: String(req.body?.To || ''),
                    status: { in: ['ringing', 'in-progress'] },
                },
                orderBy: { startedAt: 'desc' },
            });

            if (!call) {
                logger.info({ callSid, callStatus }, '[voice] status for unknown call');
                res.status(200).end();
                return;
            }

            // Telephony cost — Twilio bills per minute rounded up.
            const durationMin = Math.max(1, Math.ceil(callDuration / 60));
            const telephonyCostUsd = durationMin * 0.009; // rough US inbound rate; overridden by Twilio invoice reality

            await prisma.phoneCall.update({
                where: { id: call.id },
                data: {
                    status: callStatus === 'completed' ? 'completed'
                        : callStatus === 'no-answer' ? 'no-answer'
                        : callStatus === 'busy' ? 'busy'
                        : callStatus === 'canceled' ? 'canceled'
                        : callStatus === 'failed' ? 'failed'
                        : call.status,
                    durationSec: callDuration || call.durationSec,
                    endedAt: callStatus === 'completed' || callStatus === 'no-answer' || callStatus === 'busy' || callStatus === 'canceled' || callStatus === 'failed'
                        ? new Date() : null,
                    telephonyCostUsd,
                    // total + credits filled by the WS bridge on its own
                    // teardown pass; the /status hook only knows the
                    // telephony leg for sure.
                },
            });
            res.status(200).end();
        } catch (error: any) {
            logger.error({ err: error.message }, '[voice] status hook error');
            res.status(500).end();
        }
    }
}

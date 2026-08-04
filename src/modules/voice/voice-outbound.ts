// Placing an outbound call, from anywhere that isn't a person clicking
// "Test call".
//
// The test-call endpoint already knew how to do this, but it knew it
// inside a request handler — so an automation that wanted to ring a
// contact had no way to reuse it. This is that logic with the HTTP
// removed, and one addition: a `brief`, the reason the call is being
// placed, which the bridge hands to the assistant as context for that
// one conversation.

import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

export class OutboundCallError extends Error {
    code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

export type OutboundCallInput = {
    workspaceId: string;
    assistantId: string;
    /** E.164 preferred; digits are accepted and normalised. */
    toNumber: string;
    /** Why this call is happening — given to the assistant as context. */
    brief?: string | null;
};

export type OutboundCallResult = {
    callId: string;
    callSid: string;
    fromNumber: string;
    toNumber: string;
};

// Twilio wants E.164. A number that arrived from a WhatsApp jid is
// bare digits, and dialling those fails with an opaque 21211, so we
// normalise here rather than making every caller remember.
function toE164(raw: string): string {
    const trimmed = String(raw || '').trim();
    if (trimmed.startsWith('+')) return '+' + trimmed.slice(1).replace(/[^0-9]/g, '');
    const digits = trimmed.replace(/[^0-9]/g, '');
    return digits ? `+${digits}` : '';
}

export async function placeOutboundCall(input: OutboundCallInput): Promise<OutboundCallResult> {
    const to = toE164(input.toNumber);
    if (!to || to.length < 8) {
        throw new OutboundCallError('bad_number', `"${input.toNumber}" is not a dialable number.`);
    }

    const asst = await prisma.voiceAssistant.findFirst({
        where: { id: input.assistantId, workspaceId: input.workspaceId },
        select: { id: true, name: true },
    });
    if (!asst) throw new OutboundCallError('no_assistant', 'Assistant not found in this workspace.');

    // The assistant dials from a number assigned to it. Without one
    // there's nothing to call from — and Twilio will not let us borrow
    // an arbitrary number on the account.
    const number = await prisma.phoneNumber.findFirst({
        where: { workspaceId: input.workspaceId, voiceAssistantId: asst.id, isActive: true },
        orderBy: { createdAt: 'asc' },
    });
    if (!number) {
        throw new OutboundCallError(
            'no_phone_number',
            `"${asst.name}" has no phone number assigned. Assign one under Voice → Phone Numbers first.`,
        );
    }

    const { getTwilioForWorkspace, TwilioNotConfiguredError } = await import('../../lib/twilio');
    const { config } = await import('../../config');
    const base = (config.FRONTEND_URL || 'https://chatbot.tural.ai').replace(/\/$/, '');

    let call;
    try {
        const client = await getTwilioForWorkspace(input.workspaceId);
        call = await client.calls.create({
            from: number.number,
            to,
            url: `${base}/api/voice/webhook`,
            statusCallback: `${base}/api/voice/status`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        });
    } catch (err: any) {
        if (err instanceof TwilioNotConfiguredError) {
            throw new OutboundCallError('twilio_not_configured', err.message);
        }
        throw new OutboundCallError('twilio_error', err?.message || 'Twilio rejected the call.');
    }

    const row = await prisma.phoneCall.create({
        data: {
            workspaceId: input.workspaceId,
            voiceAssistantId: asst.id,
            phoneNumberId: number.id,
            direction: 'outbound',
            fromNumber: number.number,
            toNumber: to,
            status: 'ringing',
            startedAt: new Date(),
            twilioCallSid: call.sid,
            brief: input.brief?.trim() || null,
        },
    });

    logger.info({ assistantId: asst.id, to, callSid: call.sid }, '[voice-outbound] call placed');
    return { callId: row.id, callSid: call.sid, fromNumber: number.number, toNumber: to };
}

// Twilio client + credential resolver. Credentials come from
// SystemConfig — one platform account for now (matches how the copilot
// voice keys live under PLATFORM_OPENAI_KEY etc.). A future release
// can promote these to per-workspace BYO credentials.
//
// SystemConfig keys used:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_PHONE_NUMBER_SID (default number used for outbound if a
//                            workspace doesn't own its own yet)

import twilio from 'twilio';
import type { Twilio } from 'twilio';
import { prisma } from './prisma';
import { logger } from '../utils/logger';

let cached: { client: Twilio; sid: string; token: string; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

async function loadCreds() {
    const rows = await prisma.systemConfig.findMany({
        where: { key: { in: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] } },
    });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return { sid: map.TWILIO_ACCOUNT_SID || '', token: map.TWILIO_AUTH_TOKEN || '' };
}

/**
 * Returns a live Twilio SDK client. Throws when SystemConfig has no
 * credentials so callers can 400 out with a "Twilio is not configured"
 * message instead of running into an opaque auth error at the API call.
 */
export async function getTwilio(): Promise<Twilio> {
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.client;
    const { sid, token } = await loadCreds();
    if (!sid || !token) throw new Error('Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Admin → Platform Keys.');
    const client = twilio(sid, token);
    cached = { client, sid, token, at: Date.now() };
    return client;
}

export function invalidateTwilioCache() {
    cached = null;
}

// Twilio Webhook signature validation. Twilio POSTs to our webhook with
// an X-Twilio-Signature header derived from the request URL + params +
// AUTH_TOKEN. Verifying protects our endpoint from spoofed calls.
export async function validateTwilioSignature(url: string, params: Record<string, string>, signature: string): Promise<boolean> {
    const { token } = await loadCreds();
    if (!token) return false;
    try {
        return twilio.validateRequest(token, signature, url, params);
    } catch (err: any) {
        logger.warn({ err: err.message }, '[twilio] signature validation failed');
        return false;
    }
}

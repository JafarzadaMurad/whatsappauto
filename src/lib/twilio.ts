// Per-workspace Twilio client resolver. Each workspace brings its own
// Twilio account (SID + Auth Token), stored on the Workspace row.
// Number provisioning + per-minute call charges then land on the
// customer's Twilio bill, not ours.

import twilio from 'twilio';
import type { Twilio } from 'twilio';
import { prisma } from './prisma';
import { logger } from '../utils/logger';

// Small in-memory cache so back-to-back API calls (list numbers +
// update webhook + status hook in the same second) don't re-hit the
// DB. Keyed by workspaceId so credential rotation is bounded to the
// cache TTL.
const cache = new Map<string, { client: Twilio; sid: string; token: string; at: number }>();
const CACHE_TTL_MS = 60_000;

export class TwilioNotConfiguredError extends Error {
    constructor() {
        super('Twilio credentials are not set for this workspace. Add them on Voice → Phone Numbers.');
        this.name = 'TwilioNotConfiguredError';
    }
}

export async function getTwilioForWorkspace(workspaceId: string): Promise<Twilio> {
    const cached = cache.get(workspaceId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.client;

    const ws = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { twilioAccountSid: true, twilioAuthToken: true },
    });
    const sid = ws?.twilioAccountSid || '';
    const token = ws?.twilioAuthToken || '';
    if (!sid || !token) throw new TwilioNotConfiguredError();

    const client = twilio(sid, token);
    cache.set(workspaceId, { client, sid, token, at: Date.now() });
    return client;
}

// Ad-hoc client used during the first-time Import/Buy where credentials
// arrive in the request body and haven't been persisted yet. Bypasses
// the cache — the caller decides whether to persist after the client
// call succeeds.
export function makeTwilioClient(sid: string, token: string): Twilio {
    return twilio(sid, token);
}

export function invalidateTwilioCache(workspaceId?: string) {
    if (workspaceId) cache.delete(workspaceId);
    else cache.clear();
}

// Given a PhoneNumber row, find its workspace's Twilio client. Used by
// the /voice/status hook and the bridge shutdown path — both know the
// call by CallSid/number rather than workspaceId.
export async function getTwilioForPhoneNumber(number: string): Promise<Twilio | null> {
    try {
        const row = await prisma.phoneNumber.findFirst({
            where: { number },
            select: { workspaceId: true },
        });
        if (!row) return null;
        return await getTwilioForWorkspace(row.workspaceId);
    } catch (err: any) {
        logger.warn({ err: err.message, number }, '[twilio] resolve-by-number failed');
        return null;
    }
}

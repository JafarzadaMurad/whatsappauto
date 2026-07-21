// Phone number management with per-workspace Twilio credentials.
// First-time Import/Buy accepts credentials in the request body — we
// verify them against Twilio (throw-away client), then persist on the
// Workspace row + reuse for every subsequent Twilio call.
//
// Flow:
//   1. Operator opens Voice → Numbers.
//   2. If workspace has no twilioAccountSid → banner says so.
//   3. Buy / Import modal shows Twilio SID + Auth Token inputs when
//      creds are missing; otherwise those inputs are hidden.
//   4. First successful call persists the creds; subsequent Buys /
//      Imports don't ask again.

import { Request, Response } from 'express';
import { z } from 'zod';
import type { Twilio } from 'twilio';
import { prisma } from '../../lib/prisma';
import { getWorkspaceId } from '../../lib/workspace-context';
import {
    getTwilioForWorkspace, makeTwilioClient,
    invalidateTwilioCache, TwilioNotConfiguredError,
} from '../../lib/twilio';
import { config } from '../../config';
import { logger } from '../../utils/logger';

function publicUrl(path: string): string {
    const base = (config.FRONTEND_URL || 'https://chatbot.tural.ai').replace(/\/$/, '');
    return `${base}${path.startsWith('/') ? path : '/' + path}`;
}

// Ingest an optional `credentials` object on the request body — if
// present AND workspace has no creds yet, verify + persist. Returns
// a usable Twilio client either way.
async function resolveClient(workspaceId: string, credsOnBody?: { accountSid?: string; authToken?: string }): Promise<Twilio> {
    try {
        return await getTwilioForWorkspace(workspaceId);
    } catch (err) {
        if (!(err instanceof TwilioNotConfiguredError)) throw err;
        // Missing creds — need them on this request or reject.
        const sid = (credsOnBody?.accountSid || '').trim();
        const token = (credsOnBody?.authToken || '').trim();
        if (!sid || !token) throw new TwilioNotConfiguredError();
        // Verify by hitting a cheap endpoint on Twilio before persisting.
        const client = makeTwilioClient(sid, token);
        try {
            await client.api.v2010.accounts(sid).fetch();
        } catch (verifyErr: any) {
            throw new Error(`Twilio credentials rejected: ${verifyErr.message || 'auth failed'}`);
        }
        await prisma.workspace.update({
            where: { id: workspaceId },
            data: { twilioAccountSid: sid, twilioAuthToken: token },
        });
        invalidateTwilioCache(workspaceId);
        return client;
    }
}

export class PhoneNumberController {
    // Simple flag endpoint the Numbers page hits on load — no secrets
    // sent back, just booleans + the last-4 of the SID for a friendly
    // "connected to Twilio account ending in …XYZ" label.
    async twilioStatus(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const ws = await prisma.workspace.findUnique({
                where: { id: workspaceId },
                select: { twilioAccountSid: true, twilioAuthToken: true },
            });
            const hasCreds = !!(ws?.twilioAccountSid && ws.twilioAuthToken);
            return res.json({
                success: true,
                configured: hasCreds,
                accountSidTail: hasCreds ? (ws!.twilioAccountSid || '').slice(-4) : null,
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Disconnect / rotate — clears the workspace's stored creds so the
    // next Import/Buy prompts for fresh ones.
    async disconnectTwilio(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            await prisma.workspace.update({
                where: { id: workspaceId },
                data: { twilioAccountSid: null, twilioAuthToken: null },
            });
            invalidateTwilioCache(workspaceId);
            return res.json({ success: true });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async list(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const rows = await prisma.phoneNumber.findMany({
                where: { workspaceId },
                orderBy: { createdAt: 'desc' },
                include: {
                    voiceAssistant: { select: { id: true, name: true } },
                    _count: { select: { calls: true } },
                },
            });
            return res.json({ success: true, numbers: rows });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async search(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const q = z.object({
                country: z.string().length(2).default('US'),
                areaCode: z.string().max(6).optional(),
                contains: z.string().max(20).optional(),
                limit: z.number().int().min(1).max(30).default(15),
                credentials: z.object({
                    accountSid: z.string().max(80).optional(),
                    authToken: z.string().max(80).optional(),
                }).optional(),
            }).parse(req.body);

            const client = await resolveClient(workspaceId, q.credentials);
            const available = await client.availablePhoneNumbers(q.country)
                .local.list({
                    areaCode: q.areaCode ? Number(q.areaCode) : undefined,
                    contains: q.contains,
                    voiceEnabled: true,
                    limit: q.limit,
                });

            return res.json({
                success: true,
                numbers: available.map(n => ({
                    number: n.phoneNumber,
                    friendlyName: n.friendlyName,
                    locality: n.locality,
                    region: n.region,
                    postalCode: n.postalCode,
                    capabilities: n.capabilities,
                })),
            });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            if (error instanceof TwilioNotConfiguredError) return res.status(400).json({ success: false, message: error.message, code: 'twilio_not_configured' });
            logger.error({ err: error.message }, '[phone] search failed');
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async buy(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const body = z.object({
                phoneNumber: z.string().min(4).max(20),
                voiceAssistantId: z.string().uuid().optional(),
                credentials: z.object({
                    accountSid: z.string().max(80).optional(),
                    authToken: z.string().max(80).optional(),
                }).optional(),
            }).parse(req.body);

            const client = await resolveClient(workspaceId, body.credentials);
            const bought = await client.incomingPhoneNumbers.create({
                phoneNumber: body.phoneNumber,
                voiceUrl: publicUrl('/api/voice/webhook'),
                voiceMethod: 'POST',
                statusCallback: publicUrl('/api/voice/status'),
                statusCallbackMethod: 'POST',
            });

            const row = await prisma.phoneNumber.create({
                data: {
                    workspaceId,
                    number: bought.phoneNumber,
                    provider: 'twilio',
                    providerSid: bought.sid,
                    voiceAssistantId: body.voiceAssistantId || null,
                    isActive: true,
                },
            });
            return res.status(201).json({ success: true, phoneNumber: row });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            if (error instanceof TwilioNotConfiguredError) return res.status(400).json({ success: false, message: error.message, code: 'twilio_not_configured' });
            logger.error({ err: error.message }, '[phone] buy failed');
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async importNumber(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const body = z.object({
                providerSid: z.string().min(4).max(60),
                voiceAssistantId: z.string().uuid().optional(),
                credentials: z.object({
                    accountSid: z.string().max(80).optional(),
                    authToken: z.string().max(80).optional(),
                }).optional(),
            }).parse(req.body);

            const client = await resolveClient(workspaceId, body.credentials);
            const num = await client.incomingPhoneNumbers(body.providerSid).fetch();

            await client.incomingPhoneNumbers(body.providerSid).update({
                voiceUrl: publicUrl('/api/voice/webhook'),
                voiceMethod: 'POST',
                statusCallback: publicUrl('/api/voice/status'),
                statusCallbackMethod: 'POST',
            });

            const row = await prisma.phoneNumber.upsert({
                where: { number: num.phoneNumber },
                update: {
                    workspaceId,
                    provider: 'twilio',
                    providerSid: num.sid,
                    voiceAssistantId: body.voiceAssistantId || null,
                    isActive: true,
                },
                create: {
                    workspaceId,
                    number: num.phoneNumber,
                    provider: 'twilio',
                    providerSid: num.sid,
                    voiceAssistantId: body.voiceAssistantId || null,
                    isActive: true,
                },
            });
            return res.status(201).json({ success: true, phoneNumber: row });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            if (error instanceof TwilioNotConfiguredError) return res.status(400).json({ success: false, message: error.message, code: 'twilio_not_configured' });
            logger.error({ err: error.message }, '[phone] import failed');
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async update(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const body = z.object({
                voiceAssistantId: z.string().uuid().nullable().optional(),
                greeting: z.string().max(2000).nullable().optional(),
                isActive: z.boolean().optional(),
            }).parse(req.body);
            const existing = await prisma.phoneNumber.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Number not found' });
            const row = await prisma.phoneNumber.update({ where: { id }, data: body });
            return res.json({ success: true, phoneNumber: row });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async release(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const existing = await prisma.phoneNumber.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Number not found' });

            if (existing.provider === 'twilio' && existing.providerSid) {
                try {
                    const client = await getTwilioForWorkspace(workspaceId);
                    await client.incomingPhoneNumbers(existing.providerSid).remove();
                } catch (err: any) {
                    logger.warn({ err: err.message, providerSid: existing.providerSid }, '[phone] twilio release failed — dropping local row anyway');
                }
            }
            await prisma.phoneNumber.delete({ where: { id } });
            return res.json({ success: true });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Outbound trigger — dial an arbitrary number using the workspace's
    // Twilio account, with the same TwiML → Media Stream flow as inbound.
    // The Twilio call is created with `url` pointing at our webhook so
    // the bridge handles the audio identically for both directions.
    async outbound(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const body = z.object({
                toNumber: z.string().min(4).max(20),
            }).parse(req.body);

            const number = await prisma.phoneNumber.findFirst({
                where: { id, workspaceId },
                include: { voiceAssistant: { select: { id: true, name: true } } },
            });
            if (!number) return res.status(404).json({ success: false, message: 'Number not found' });
            if (!number.voiceAssistant) return res.status(400).json({ success: false, message: 'Number has no assistant assigned' });

            const client = await getTwilioForWorkspace(workspaceId);
            const call = await client.calls.create({
                from: number.number,
                to: body.toNumber,
                url: publicUrl('/api/voice/webhook'),
                statusCallback: publicUrl('/api/voice/status'),
                statusCallbackEvent: ['completed', 'no-answer', 'busy', 'failed', 'canceled'],
            });

            // Log the outbound row up front so the operator sees it in
            // the log even while it's still ringing.
            await prisma.phoneCall.create({
                data: {
                    workspaceId,
                    voiceAssistantId: number.voiceAssistant.id,
                    phoneNumberId: number.id,
                    direction: 'outbound',
                    fromNumber: number.number,
                    toNumber: body.toNumber,
                    status: 'ringing',
                    startedAt: new Date(),
                },
            }).catch(() => {});

            return res.status(201).json({ success: true, callSid: call.sid });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            if (error instanceof TwilioNotConfiguredError) return res.status(400).json({ success: false, message: error.message, code: 'twilio_not_configured' });
            logger.error({ err: error.message }, '[phone] outbound failed');
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

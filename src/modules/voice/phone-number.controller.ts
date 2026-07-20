// Phone number management — provision/import/assign numbers backed by
// Twilio. Two paths:
//   1. Search + purchase a fresh number from Twilio's inventory
//   2. Import an existing Twilio number (workspace already owns it)
//
// Every number we register also has its `voiceUrl` pointed at our
// public /api/voice/webhook endpoint so Twilio hits us when a call
// lands.

import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { getWorkspaceId } from '../../lib/workspace-context';
import { getTwilio } from '../../lib/twilio';
import { config } from '../../config';
import { logger } from '../../utils/logger';

function publicUrl(path: string): string {
    // Twilio needs an absolute URL for voiceUrl/statusCallback. Fall
    // back to the config default if the request didn't carry a Host.
    const base = (config.FRONTEND_URL || 'https://chatbot.tural.ai').replace(/\/$/, '');
    return `${base}${path.startsWith('/') ? path : '/' + path}`;
}

export class PhoneNumberController {
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

    // Search Twilio's inventory for numbers matching filters — country
    // code + area code + capabilities. Returns the raw list the user
    // picks one from.
    async search(req: Request, res: Response) {
        try {
            const q = z.object({
                country: z.string().length(2).default('US'),
                areaCode: z.string().max(6).optional(),
                contains: z.string().max(20).optional(),
                limit: z.number().int().min(1).max(30).default(15),
            }).parse(req.body);

            const client = await getTwilio();
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
            logger.error({ err: error.message }, '[phone] search failed');
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Buy a number from Twilio's inventory. Wires voiceUrl → our
    // webhook so incoming calls land back here.
    async buy(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const body = z.object({
                phoneNumber: z.string().min(4).max(20),
                voiceAssistantId: z.string().uuid().optional(),
            }).parse(req.body);

            const client = await getTwilio();
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
            logger.error({ err: error.message }, '[phone] buy failed');
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Import an already-owned Twilio number by SID. Same voiceUrl
    // rewire happens so the runtime can pick up the call.
    async importNumber(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace' });
            const body = z.object({
                providerSid: z.string().min(4).max(60),
                voiceAssistantId: z.string().uuid().optional(),
            }).parse(req.body);

            const client = await getTwilio();
            const num = await client.incomingPhoneNumbers(body.providerSid).fetch();

            // Update the number's voice webhook so Twilio calls us.
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

            // Best-effort release on Twilio side (frees the number so the
            // workspace stops being billed for it). If the release fails
            // we still remove our row so the UI stays consistent.
            if (existing.provider === 'twilio' && existing.providerSid) {
                try {
                    const client = await getTwilio();
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
}

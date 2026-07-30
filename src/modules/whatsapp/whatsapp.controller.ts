import { Request, Response } from 'express';
import { InstanceManager, getLatestQr, sessions } from './instance.manager';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { checkPlanLimit, PlanLimitError } from '../../lib/plan-limits';
import { getWorkspaceId } from '../../lib/workspace-context';
import { logger } from '../../utils/logger';

const createInstanceSchema = z.object({
    name: z.string().min(1),
});

export class WhatsappController {
    async listInstances(req: Request, res: Response) {
        const workspaceId = getWorkspaceId(req);
        const instances = await prisma.instance.findMany({
            where: { workspaceId },
            include: { agent: true },
            orderBy: { createdAt: 'desc' }
        });

        return res.status(200).json({ success: true, instances });
    }

    async createInstance(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const data = createInstanceSchema.parse(req.body);

            // Admin-flagged integration accounts (external CRMs that
            // provision one instance per end-user manager) bypass the
            // retail plan quota.
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { unlimitedInstances: true },
            });
            if (!user?.unlimitedInstances) {
                await checkPlanLimit(userId, 'whatsapp');
            }

            const instance = await prisma.instance.create({
                data: {
                    userId,
                    workspaceId,
                    name: data.name,
                    status: 'DISCONNECTED',
                }
            });

            InstanceManager.startInstance(instance.id);

            return res.status(201).json({ success: true, instance });
        } catch (error: any) {
            if (error instanceof PlanLimitError) return res.status(403).json({ success: false, message: error.message, code: error.code });
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, errors: error.issues });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async deleteInstance(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const force = String(req.query.force || '') === 'true';

            const instance = await prisma.instance.findFirst({ where: { id, workspaceId } });
            if (!instance) {
                return res.status(404).json({ success: false, message: 'Instance not found' });
            }

            // Check campaigns that would lose their instance reference.
            const campaigns = await prisma.campaign.findMany({
                where: { instanceId: id },
                select: { id: true, name: true, status: true },
            });

            if (campaigns.length > 0 && !force) {
                return res.status(409).json({
                    success: false,
                    requiresConfirmation: true,
                    campaigns,
                    message: `${campaigns.length} campaign(s) use this number. They will stay but their number will show as "deleted".`,
                });
            }

            await InstanceManager.stopInstance(id as string);
            await prisma.instance.delete({ where: { id: id as string } });

            return res.status(200).json({
                success: true,
                message: 'Instance deleted',
                orphanedCampaigns: campaigns.length,
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async restartInstance(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const instance = await prisma.instance.findFirst({ where: { id, workspaceId } });
            if (!instance) return res.status(404).json({ success: false, message: 'Instance not found' });

            await InstanceManager.stopInstance(id);
            InstanceManager.startInstance(id);

            return res.json({ success: true, message: 'Instance restarting' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── Single instance ────────────────────────────────────────────
    // Headless integrations (external CRM) need the current status
    // without pulling the whole list.
    async getInstance(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const instance = await prisma.instance.findFirst({
                where: { id, workspaceId },
                include: { agent: { select: { id: true, name: true, isRouter: true } } },
            });
            if (!instance) return res.status(404).json({ success: false, message: 'Instance not found' });
            return res.json({ success: true, instance });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── QR polling endpoint ────────────────────────────────────────
    // External CRM (PHP + shared hosting, no Socket.IO) polls this to
    // show the QR in its own modal. Cheap: instance existence check
    // hits the DB, QR itself is served from an in-memory map. Returns
    // `qr: null` once a fresh QR isn't available (still-CONNECTING) or
    // once the socket is CONNECTED — the caller knows to stop polling.
    async getQr(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const instance = await prisma.instance.findFirst({
                where: { id, workspaceId },
                select: { id: true, status: true },
            });
            if (!instance) return res.status(404).json({ success: false, message: 'Instance not found' });

            if (instance.status === 'CONNECTED') {
                return res.json({ success: true, status: 'CONNECTED', qr: null, qrExpiresAt: null });
            }
            const cached = getLatestQr(id);
            return res.json({
                success: true,
                status: instance.status,
                qr: cached?.qr || null,
                qrExpiresAt: cached?.expiresAt.toISOString() || null,
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── Number diagnostics ─────────────────────────────────────────
    // Answers "why didn't my message reach this number?" without shell
    // access: is it registered on WhatsApp at all, what JID would we
    // address, and does a LID mapping exist for it.
    async checkNumber(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const phone = String(req.query.phone || '').trim();
            if (!phone) return res.status(400).json({ success: false, message: 'phone query param is required' });

            const instance = await prisma.instance.findFirst({
                where: { id, workspaceId },
                select: { id: true, status: true },
            });
            if (!instance) return res.status(404).json({ success: false, message: 'Instance not found' });

            const sock: any = sessions.get(id);
            if (!sock) return res.status(502).json({ success: false, message: 'Instance is not connected' });

            const { inspectWhatsAppNumber } = await import('../messaging/messaging.service');
            const report = await inspectWhatsAppNumber(sock, phone);
            return res.json({ success: true, report });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── Contact session reset ──────────────────────────────────────
    // When a contact's Signal session or cached device list goes stale
    // — they reinstalled WhatsApp, switched to the Business app, or
    // added/removed a linked device — Baileys keeps encrypting for
    // devices that no longer exist. The send succeeds locally and is
    // written to the socket, but nobody can decrypt it, so no ack ever
    // comes back. Exactly the "message shows a tick but never arrives"
    // failure. Dropping the cached keys forces a fresh device fetch and
    // prekey exchange on the next send.
    async resetContact(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const phone = String((req.body?.phone ?? '')).replace(/[^0-9]/g, '');
            if (!phone) return res.status(400).json({ success: false, message: 'phone is required' });

            const instance = await prisma.instance.findFirst({ where: { id, workspaceId }, select: { id: true } });
            if (!instance) return res.status(404).json({ success: false, message: 'Instance not found' });

            const sock: any = sessions.get(id);
            if (!sock) return res.status(502).json({ success: false, message: 'Instance is not connected' });

            const pnJid = `${phone}@s.whatsapp.net`;
            const cleared: string[] = [];

            // Resolve the LID too — sessions are keyed per addressing form
            // and per device, so both need clearing.
            let lidJid: string | null = null;
            try {
                lidJid = await sock?.signalRepository?.lidMapping?.getLIDForPN?.(pnJid) ?? null;
            } catch { /* best-effort */ }

            // Signal sessions are stored per `<user>.<device>` address. We
            // don't know which devices exist, so clear a reasonable range
            // (0-9 covers phone + linked devices comfortably).
            const users = [phone, ...(lidJid ? [lidJid.split('@')[0]] : [])];
            const sessionIds: string[] = [];
            for (const u of users) {
                for (let device = 0; device < 10; device++) {
                    sessionIds.push(`${u}.${device}`);
                }
            }
            try {
                const existing = await sock.authState.keys.get('session', sessionIds);
                const nulls: Record<string, null> = {};
                for (const key of Object.keys(existing || {})) {
                    if (existing[key]) { nulls[key] = null; cleared.push(`session:${key}`); }
                }
                if (Object.keys(nulls).length > 0) {
                    await sock.authState.keys.set({ session: nulls });
                }
            } catch (err: any) {
                logger.warn({ err: err.message, id, phone }, '[reset-contact] session clear failed');
            }

            return res.json({
                success: true,
                phone,
                pnJid,
                lidJid,
                cleared,
                message: cleared.length
                    ? 'Cached sessions dropped. The next message re-negotiates encryption with the contact.'
                    : 'No cached sessions found for this contact — nothing to clear.',
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── Logout ─────────────────────────────────────────────────────
    // Disconnects the phone but keeps the DB row so the CRM can offer
    // a rebind by re-scanning the QR. Differs from DELETE which drops
    // everything (messages, campaigns' backref, etc.).
    async logoutInstance(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const instance = await prisma.instance.findFirst({ where: { id, workspaceId } });
            if (!instance) return res.status(404).json({ success: false, message: 'Instance not found' });

            const sock: any = sessions.get(id);
            if (sock) {
                try { await sock.logout(); } catch { /* baileys logout can throw on already-closed sockets */ }
                try { await sock.end(undefined); } catch { /* soft-close */ }
                sessions.delete(id);
            }
            await prisma.instance.update({ where: { id }, data: { status: 'DISCONNECTED' } });
            return res.json({ success: true, message: 'Logged out' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateInstance(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const schema = z.object({
                agentId: z.string().uuid().nullable().optional(),
                routerAgentId: z.string().uuid().nullable().optional(),
                syncHistory: z.boolean().optional(),
            });
            const data = schema.parse(req.body);

            const instance = await prisma.instance.findFirst({ where: { id, workspaceId } });
            if (!instance) {
                return res.status(404).json({ success: false, message: 'Instance not found' });
            }

            const updated = await prisma.instance.update({
                where: { id },
                data: {
                    ...(data.agentId !== undefined ? { agentId: data.agentId } : {}),
                    ...(data.routerAgentId !== undefined ? { routerAgentId: data.routerAgentId } : {}),
                    ...(data.syncHistory !== undefined ? { syncHistory: data.syncHistory } : {}),
                },
            });

            return res.status(200).json({ success: true, instance: updated });
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, errors: error.issues });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

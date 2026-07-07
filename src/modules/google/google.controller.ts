import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import {
    buildAuthorizeUrl,
    exchangeCodeForTokens,
    listCalendars,
    revokeAndDisconnect,
    GOOGLE_CALENDAR_SCOPES,
} from './google-calendar.service';

// In-memory nonce store for OAuth state. Rows are keyed by a random
// nonce we hand to Google; on callback we look up the workspaceId and
// return-URL that go with it. Rows self-expire after 10 minutes.
const stateStore = new Map<string, { workspaceId: string; userId: string; returnTo: string; createdAt: number }>();
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of stateStore.entries()) {
        if (now - v.createdAt > 10 * 60 * 1000) stateStore.delete(k);
    }
}, 60 * 1000).unref?.();

export class GoogleController {
    // Connection info for the current workspace — the Connectors page
    // uses this to decide whether to show "Connect" or the settings UI.
    async status(req: Request, res: Response) {
        try {
            const workspaceId = req.workspaceId;
            if (!workspaceId) return res.status(400).json({ success: false, message: 'workspace context missing' });
            const conn = await prisma.googleCalendarConnection.findUnique({
                where: { workspaceId },
                select: { email: true, calendarId: true, scopes: true, updatedAt: true },
            });
            return res.json({
                success: true,
                connected: !!conn,
                email: conn?.email || null,
                calendarId: conn?.calendarId || null,
                scopes: conn?.scopes || null,
                updatedAt: conn?.updatedAt || null,
            });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e?.message || 'status failed' });
        }
    }

    // Emits the redirect URL the frontend should navigate the user to.
    // We do NOT redirect server-side here so the frontend can render a
    // "Connecting…" state and keep the JWT-authenticated session.
    async authorize(req: Request, res: Response) {
        try {
            const workspaceId = req.workspaceId;
            const userId = (req as any).user?.id;
            if (!workspaceId || !userId) return res.status(400).json({ success: false, message: 'missing context' });
            const nonce = crypto.randomBytes(24).toString('hex');
            const returnTo = String(req.query.returnTo || '/dashboard/connectors');
            stateStore.set(nonce, { workspaceId, userId, returnTo, createdAt: Date.now() });
            const url = await buildAuthorizeUrl(nonce);
            return res.json({ success: true, url });
        } catch (e: any) {
            logger.warn({ err: e?.message }, '[google] authorize failed');
            return res.status(500).json({ success: false, message: e?.message || 'authorize failed' });
        }
    }

    // Public — Google hits this with ?code=… &state=…. We resolve the
    // state to the workspace, exchange the code for tokens, upsert, then
    // redirect back to the frontend Connectors page with a success flag.
    async callback(req: Request, res: Response) {
        const code = String(req.query.code || '');
        const state = String(req.query.state || '');
        const err = String(req.query.error || '');
        const base = process.env.FRONTEND_URL || 'https://chatbot.tur.al';
        const finish = (params: Record<string, string>) => {
            const ctx = stateStore.get(state);
            const returnTo = ctx?.returnTo || '/dashboard/connectors';
            const url = new URL(returnTo, base);
            for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
            return res.redirect(url.toString());
        };
        try {
            if (err) return finish({ googleConnect: 'error', error: err });
            const ctx = stateStore.get(state);
            if (!ctx) return finish({ googleConnect: 'error', error: 'state_expired' });
            stateStore.delete(state);
            if (!code) return finish({ googleConnect: 'error', error: 'no_code' });

            const { refreshToken, scope, email } = await exchangeCodeForTokens(code);
            await prisma.googleCalendarConnection.upsert({
                where: { workspaceId: ctx.workspaceId },
                update: { email, refreshToken, scopes: scope, connectedById: ctx.userId },
                create: {
                    workspaceId: ctx.workspaceId,
                    connectedById: ctx.userId,
                    email,
                    refreshToken,
                    scopes: scope,
                    calendarId: 'primary',
                },
            });
            logger.info({ workspaceId: ctx.workspaceId, email }, '[google] calendar connected');
            return finish({ googleConnect: 'ok', email });
        } catch (e: any) {
            logger.error({ err: e?.response?.data || e?.message }, '[google] callback failed');
            return finish({ googleConnect: 'error', error: (e?.message || 'exchange_failed').slice(0, 200) });
        }
    }

    async disconnect(req: Request, res: Response) {
        try {
            const workspaceId = req.workspaceId;
            if (!workspaceId) return res.status(400).json({ success: false, message: 'workspace context missing' });
            await revokeAndDisconnect(workspaceId);
            return res.json({ success: true });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e?.message || 'disconnect failed' });
        }
    }

    async listCalendars(req: Request, res: Response) {
        try {
            const workspaceId = req.workspaceId;
            if (!workspaceId) return res.status(400).json({ success: false, message: 'workspace context missing' });
            const items = await listCalendars(workspaceId);
            return res.json({ success: true, calendars: items });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e?.response?.data?.error?.message || e?.message || 'list calendars failed' });
        }
    }

    async setCalendar(req: Request, res: Response) {
        try {
            const workspaceId = req.workspaceId;
            if (!workspaceId) return res.status(400).json({ success: false, message: 'workspace context missing' });
            const calendarId = String(req.body?.calendarId || '').trim() || 'primary';
            await prisma.googleCalendarConnection.update({
                where: { workspaceId },
                data: { calendarId },
            });
            return res.json({ success: true, calendarId });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e?.message || 'set calendar failed' });
        }
    }
}

export const googleController = new GoogleController();

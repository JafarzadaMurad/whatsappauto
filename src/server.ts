import http from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import app from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { prisma } from './lib/prisma';
import { startWebhookWorker } from './modules/webhook/webhook.dispatcher';
import { startCampaignWorker } from './modules/campaign/campaign.queue';

import { InstanceManager } from './modules/whatsapp/instance.manager';
import { ensureWorkspacesForAllUsers } from './lib/workspace-migration';
import { ensureWorkspaceRoles } from './lib/role-migration';
import { startAgentActivityCleanup } from './modules/agent/activity-cleanup';
import { startOperatorTimeoutSweeper } from './modules/operator/operator.service';
import { startOversightScheduler } from './modules/oversight/oversight.service';
import { startReminderScheduler } from './modules/agent/reminder.scheduler';
import { seedAiPricing, backfillPricingKinds } from './lib/ai-pricing.seed';
import { attachVoiceBridge } from './modules/voice/voice-bridge';

// Global safety nets — Baileys / socket handlers occasionally throw
// asynchronously and would otherwise take the whole PM2 process down,
// giving the frontend intermittent 502s. Log + keep running instead.
process.on('unhandledRejection', (reason: any) => {
    logger.error({ err: reason?.message || reason, stack: reason?.stack }, '[fatal] unhandled promise rejection — process survives');
});
process.on('uncaughtException', (err: any) => {
    logger.error({ err: err?.message || err, stack: err?.stack }, '[fatal] uncaught exception — process survives');
});

const server = http.createServer(app);

// Voice bridge — Twilio Media Streams ⇄ OpenAI Realtime WebSocket
// handler. Attached to the same HTTP server as Socket.IO but on a
// dedicated `/voice/stream` path; both coexist because we use the
// low-level `upgrade` event and dispatch by URL.
attachVoiceBridge(server);

// Initialize Webhook Worker
startWebhookWorker();
startCampaignWorker();

// Initialize Socket.IO
export const io = new Server(server, {
    cors: {
        origin: config.FRONTEND_URL,
        credentials: true,
    },
    // CRITICAL: socket.io's engine.io defaults to destroying every
    // WebSocket upgrade whose path isn't its own after ~1 s — that
    // races the voice bridge attached above at /voice/stream and
    // triggers Twilio error 31901 "Stream - WebSocket - Connection
    // Timeout" on outbound test calls. Turning it off lets other
    // upgrade handlers (like ours) own their paths.
    destroyUpgrade: false,
});

// ─── Socket.IO auth + workspace rooms ───────────────────────────────
// Every browser tab hands us its JWT on the handshake. We verify it and
// resolve which workspace the user is currently in, then join the
// `workspace:<id>` room. Every downstream emit uses io.to(room, …) so a
// customer in workspace A can NEVER see workspace B's QR codes or
// incoming messages. Sockets without a valid token stay unjoined
// (still connected — they just receive nothing until they authenticate).
io.use(async (socket, next) => {
    try {
        const token = (socket.handshake.auth as any)?.token
            || (socket.handshake.query as any)?.token
            || null;
        if (!token) return next(); // let the connection through, no rooms
        const decoded = jwt.verify(token, config.JWT_SECRET) as { id: string };
        // Prefer an explicit workspace hint from the client; fall back
        // to the first workspace membership. Same rule the auth
        // middleware uses on REST calls.
        const wsHint = String((socket.handshake.auth as any)?.workspaceId
            || (socket.handshake.query as any)?.workspaceId
            || '').trim();
        let workspaceId: string | null = null;
        if (wsHint) {
            const member = await prisma.workspaceMember.findFirst({
                where: { workspaceId: wsHint, userId: decoded.id },
                select: { workspaceId: true },
            });
            if (member) workspaceId = member.workspaceId;
        }
        if (!workspaceId) {
            const owned = await prisma.workspace.findFirst({
                where: { ownerId: decoded.id },
                select: { id: true },
                orderBy: { createdAt: 'asc' },
            });
            workspaceId = owned?.id || null;
        }
        if (!workspaceId) {
            const first = await prisma.workspaceMember.findFirst({
                where: { userId: decoded.id },
                select: { workspaceId: true },
            });
            workspaceId = first?.workspaceId || null;
        }
        (socket.data as any).userId = decoded.id;
        (socket.data as any).workspaceId = workspaceId;
        if (workspaceId) socket.join(`workspace:${workspaceId}`);
        next();
    } catch (e: any) {
        // Bad token — still let the socket open (so the client can
        // reconnect after refreshing its JWT), just don't join any room.
        logger.warn({ err: e?.message }, '[socket] auth failed — connecting without rooms');
        next();
    }
});

io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id} ws=${(socket.data as any)?.workspaceId || '-'}`);

    socket.on('disconnect', () => {
        logger.info(`Socket disconnected: ${socket.id}`);
    });
});

const PORT = config.PORT;

server.listen(PORT, async () => {
    logger.info(`🚀 Server running on port ${PORT} in ${config.NODE_ENV} mode`);

    // One-time: back-fill workspaces for any pre-existing users. Idempotent.
    try {
        await ensureWorkspacesForAllUsers();
    } catch (e: any) {
        logger.error({ err: e.message }, '[workspace-migration] failed');
    }

    // Seed per-workspace system roles (Admin / Member / Viewer) and remap
    // any legacy `WorkspaceMember.role` string values to a role row.
    // Idempotent — safe to run on every boot.
    try {
        await ensureWorkspaceRoles();
    } catch (e: any) {
        logger.error({ err: e.message }, '[role-migration] failed');
    }

    // Initialize active instances
    await InstanceManager.init();

    // 3-day auto-prune for the Agent Activity tab log
    startAgentActivityCleanup();

    // Periodic check that escalates operator tickets to the next
    // operator when the assigned one doesn't respond within the
    // per-operator timeoutMin window.
    startOperatorTimeoutSweeper();

    // Oversight scheduler: every 5 minutes, scan for due oversight
    // agents and run them. Each run reviews its watched agents'
    // recent activity and persists suggestions for the UI.
    startOversightScheduler();

    // Reminder scheduler: every 15 minutes, find conversations idle
    // for at least agent.reminderHours and ask the model to draft a
    // follow-up. Per-contact lock + max-reminders cap prevent nagging.
    startReminderScheduler();

    // Idempotent: fill in the AiPricing table with default provider
    // rates so the first cai bill goes out with real numbers rather
    // than the fallback estimate. Admin-edited rows are never touched.
    try { await seedAiPricing(); } catch (e: any) {
        logger.error({ err: e.message }, '[ai-pricing] seed failed');
    }
    // Repairs rows an older seed wrote without a billing kind. Only
    // touches the shape, never a rate somebody typed.
    try { await backfillPricingKinds(); } catch (e: any) {
        logger.error({ err: e.message }, '[ai-pricing] kind backfill failed');
    }
});

// Handle unhandled Promise rejections
process.on('unhandledRejection', (err: any) => {
    logger.error(`Unhandled Rejection: ${err.message}`);
    // Close server & exit process
    server.close(() => process.exit(1));
});

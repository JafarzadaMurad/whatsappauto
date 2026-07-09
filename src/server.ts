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

const server = http.createServer(app);

// Initialize Webhook Worker
startWebhookWorker();
startCampaignWorker();

// Initialize Socket.IO
export const io = new Server(server, {
    cors: {
        origin: config.FRONTEND_URL,
        credentials: true,
    },
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
});

// Handle unhandled Promise rejections
process.on('unhandledRejection', (err: any) => {
    logger.error(`Unhandled Rejection: ${err.message}`);
    // Close server & exit process
    server.close(() => process.exit(1));
});

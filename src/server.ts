import http from 'http';
import { Server } from 'socket.io';
import app from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { startWebhookWorker } from './modules/webhook/webhook.dispatcher';
import { startCampaignWorker } from './modules/campaign/campaign.queue';

import { InstanceManager } from './modules/whatsapp/instance.manager';
import { ensureWorkspacesForAllUsers } from './lib/workspace-migration';
import { startAgentActivityCleanup } from './modules/agent/activity-cleanup';
import { startOperatorTimeoutSweeper } from './modules/operator/operator.service';
import { startOversightScheduler } from './modules/oversight/oversight.service';

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

io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id}`);

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
});

// Handle unhandled Promise rejections
process.on('unhandledRejection', (err: any) => {
    logger.error(`Unhandled Rejection: ${err.message}`);
    // Close server & exit process
    server.close(() => process.exit(1));
});

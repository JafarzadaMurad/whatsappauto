import http from 'http';
import { Server } from 'socket.io';
import app from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { startWebhookWorker } from './modules/webhook/webhook.dispatcher';

import { InstanceManager } from './modules/whatsapp/instance.manager';

const server = http.createServer(app);

// Initialize Webhook Worker
startWebhookWorker();

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

    // Initialize active instances
    await InstanceManager.init();
});

// Handle unhandled Promise rejections
process.on('unhandledRejection', (err: any) => {
    logger.error(`Unhandled Rejection: ${err.message}`);
    // Close server & exit process
    server.close(() => process.exit(1));
});

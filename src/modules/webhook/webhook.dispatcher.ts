import { Queue, Worker } from 'bullmq';
import { logger } from '../../utils/logger';
import { prisma } from '../../lib/prisma';
import axios from 'axios';
import { config } from '../../config';
import IORedis from 'ioredis';

const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const webhookQueue = new Queue('webhook-dispatch', { connection });

export const startWebhookWorker = () => {
    const worker = new Worker('webhook-dispatch', async job => {
        const { instanceId, event, payload } = job.data;
        logger.info(`Processing webhook job ${job.id} for event ${event}`);

        const instance = await prisma.instance.findUnique({
            where: { id: instanceId },
            include: { user: { include: { webhooks: { where: { isActive: true } } } } }
        });

        if (!instance) {
            logger.warn(`Instance ${instanceId} not found for webhook job`);
            return;
        }

        if (!instance.user || !instance.user.webhooks.length) {
            logger.warn(`No active webhooks found for user of instance ${instanceId}`);
            return;
        }

        logger.info(`Found ${instance.user.webhooks.length} webhooks for instance ${instanceId}`);

        for (const webhook of instance.user.webhooks) {
            // Check if webhook is subscribed to this event, assuming empty events array means all events
            if (webhook.events.length === 0 || webhook.events.includes(event)) {
                try {
                    await axios.post(webhook.url, {
                        event,
                        instanceId,
                        timestamp: new Date().toISOString(),
                        data: payload
                    }, { timeout: 5000 });
                    logger.info(`Webhook delivered: ${webhook.url} for event ${event}`);
                } catch (error: any) {
                    logger.error(`Webhook delivery failed: ${webhook.url} - ${error.message}`);
                    throw error; // Will trigger BullMQ retry logic
                }
            }
        }
    }, {
        connection
    });

    worker.on('failed', (job, err) => {
        logger.error({ err }, `Job ${job?.id} failed`);
    });

    logger.info('Webhook worker started');
};

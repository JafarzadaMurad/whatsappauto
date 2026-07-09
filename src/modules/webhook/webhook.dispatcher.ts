import { Queue, Worker } from 'bullmq';
import { createHmac, randomBytes } from 'crypto';
import { logger } from '../../utils/logger';
import { prisma } from '../../lib/prisma';
import axios from 'axios';
import { config } from '../../config';
import IORedis from 'ioredis';

const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const webhookQueue = new Queue('webhook-dispatch', { connection });

// Helper for callers that need a fresh HMAC secret when creating a
// WebhookConfig row through the REST layer.
export function generateWebhookSecret(): string {
    return randomBytes(32).toString('hex');
}

function sign(secret: string, rawBody: string): string {
    return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export const startWebhookWorker = () => {
    const worker = new Worker('webhook-dispatch', async job => {
        const { instanceId, event, payload } = job.data as {
            instanceId: string;
            event: string;
            payload: any;
        };
        logger.info(`Processing webhook job ${job.id} for event ${event}`);

        const instance = await prisma.instance.findUnique({
            where: { id: instanceId },
            include: { user: { include: { webhooks: { where: { isActive: true } } } } },
        });

        if (!instance) {
            logger.warn(`Instance ${instanceId} not found for webhook job`);
            return;
        }

        if (!instance.user || !instance.user.webhooks.length) {
            logger.warn(`No active webhooks found for user of instance ${instanceId}`);
            return;
        }

        // Only forward to webhooks that either match this instance
        // explicitly OR don't pin an instance (null = "all instances").
        // Previously we broadcast every event to every webhook — that
        // leaked one number's traffic into unrelated integrations.
        const relevant = instance.user.webhooks.filter(w =>
            w.instanceId === null || w.instanceId === instanceId
        );

        if (relevant.length === 0) {
            logger.info(`No matching webhook subscribers for instance ${instanceId}`);
            return;
        }

        logger.info(`Found ${relevant.length} matching webhook(s) for instance ${instanceId}`);

        for (const webhook of relevant) {
            // Empty events array means "all events"; otherwise filter.
            if (webhook.events.length > 0 && !webhook.events.includes(event)) continue;

            // Build the enveloped payload the receiver actually sees.
            const envelope = {
                event,
                instanceId,
                timestamp: new Date().toISOString(),
                data: payload,
            };
            // Sign the exact JSON string we're about to POST so the
            // receiver can recompute the HMAC over the byte-perfect
            // body it read. Anything less will fail on whitespace.
            const rawBody = JSON.stringify(envelope);
            const ts = Date.now();
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'X-Webhook-Timestamp': String(ts),
            };
            if (webhook.secret) {
                headers['X-Webhook-Signature'] = 'sha256=' + sign(webhook.secret, rawBody);
            }

            try {
                await axios.post(webhook.url, rawBody, {
                    headers,
                    timeout: 5000,
                    // Send the string as-is — axios would otherwise
                    // re-serialize the object and change whitespace,
                    // breaking the signature.
                    transformRequest: [(data) => data],
                });
                logger.info(`Webhook delivered: ${webhook.url} for event ${event}`);
            } catch (error: any) {
                logger.error(`Webhook delivery failed: ${webhook.url} - ${error.message}`);
                throw error; // Will trigger BullMQ retry logic
            }
        }
    }, {
        connection,
    });

    worker.on('failed', (job, err) => {
        logger.error({ err }, `Job ${job?.id} failed`);
    });

    logger.info('Webhook worker started');
};

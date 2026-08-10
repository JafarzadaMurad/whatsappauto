import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

// 15 days. Three was too short to be useful: a customer reports a slow or
// missing reply days later, and by the time anyone looks the evidence has
// already been pruned — which is exactly what happened while diagnosing a
// six-minute delay. Fifteen covers a normal reporting lag.
const RETENTION_MS = 15 * 24 * 60 * 60 * 1000;
const RUN_EVERY_MS = 6 * 60 * 60 * 1000;      // every 6h

async function pruneOnce() {
    try {
        const cutoff = new Date(Date.now() - RETENTION_MS);
        const result = await prisma.agentActivityLog.deleteMany({
            where: { createdAt: { lt: cutoff } },
        });
        if (result.count > 0) {
            logger.info(`[activity-cleanup] pruned ${result.count} AgentActivityLog rows older than ${cutoff.toISOString()}`);
        }
    } catch (err: any) {
        logger.warn({ err: err.message }, '[activity-cleanup] prune failed');
    }
}

export function startAgentActivityCleanup() {
    // Run once shortly after boot so a freshly started server immediately
    // sheds rows that aged out while it was down, then every 6h after.
    setTimeout(pruneOnce, 30_000);
    setInterval(pruneOnce, RUN_EVERY_MS);
}

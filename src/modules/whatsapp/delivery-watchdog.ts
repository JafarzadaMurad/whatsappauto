// Delivery watchdog.
//
// Baileys' `sendMessage()` resolving is NOT proof the message left the
// device — it only means the local socket accepted the frame. WhatsApp
// then acks asynchronously via `messages.update` with a numeric status
// (2 = SENT / server ack, 3 = DELIVERED, 4 = READ). On WhatsApp Business
// App links, and on freshly-paired sessions, that ack sometimes never
// arrives: the message silently dies in the socket while the UI happily
// shows a tick. That is the "gedir kimi görsənir, amma getmir" bug.
//
// This module closes the visibility gap. Every outbound send registers
// its waMsgId here; if WhatsApp hasn't acked within GRACE_MS we flip the
// Message row to `UNDELIVERED` and log loudly. The inbox then renders a
// red "not delivered" marker instead of a fake tick, and pm2 logs carry
// the instance + JID so the operator can act.

import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { emitToWorkspaceSync } from '../../lib/socket-rooms';

// How long WhatsApp gets to ack before we call it undelivered. Server
// acks normally land in <2 s; 20 s is generous enough that a slow
// network never trips a false positive.
const GRACE_MS = 20_000;

export function watchDelivery(opts: {
    instanceId: string;
    waMsgId: string | null | undefined;
    remoteJid: string;
    context: string; // 'inbox' | 'campaign' | 'api' | 'agent' — for the log line
}): void {
    const { instanceId, waMsgId, remoteJid, context } = opts;
    if (!waMsgId) {
        // No id at all means Baileys didn't even produce a message key —
        // treat it as an immediate failure signal in the logs.
        logger.warn({ instanceId, remoteJid, context },
            '[delivery] send produced no waMsgId — message almost certainly never left the socket');
        return;
    }

    setTimeout(async () => {
        try {
            const row = await prisma.message.findFirst({
                where: { instanceId, waMsgId },
                select: { id: true, status: true },
            });
            if (!row) return;                       // row deleted meanwhile
            if (row.status !== 'PENDING') return;   // WhatsApp acked — all good

            await prisma.message.update({
                where: { id: row.id },
                data: { status: 'UNDELIVERED' },
            });
            // Cross-reference: the [wa-send] line logged at dispatch time
            // carries the same waMsgId plus the JID we actually addressed
            // (requestedJid vs sentToJid). Grep for the waMsgId to see
            // whether the LID shim fired for this message.
            // Single line so `grep` shows the whole story — pino-pretty
            // renders structured fields on following lines which grep
            // strips out.
            logger.error(
                `[delivery] NO-ACK ${instanceId} to=${remoteJid} waMsgId=${waMsgId} ctx=${context} ` +
                `— never left the socket. Match waMsgId against the [wa-send] line to see the JID used.`
            );
            emitToWorkspaceSync(instanceId, `message.status-${instanceId}`, {
                waMsgId, status: 'UNDELIVERED', remoteJid,
            });
        } catch (err: any) {
            logger.warn({ err: err.message, instanceId, waMsgId }, '[delivery] watchdog check failed');
        }
    }, GRACE_MS).unref?.();
}

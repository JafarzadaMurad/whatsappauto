import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { AiService } from './ai.service';
import { sessions } from '../whatsapp/instance.manager';
import { io } from '../../server';

// Sweep every 15 minutes. Cheap because we only touch the latest
// message per (instance, remoteJid) and short-circuit as soon as the
// per-contact lock (Client.lastReminderAt) tells us we already sent.
const SWEEP_MS = 15 * 60 * 1000;

// Per-conversation cap. If the customer never replies we'd otherwise
// nag them forever. After this many auto-reminders for the same idle
// state we stop until the customer actually writes back.
const MAX_REMINDERS_PER_IDLE = 3;

async function sweep() {
    try {
        const agents = await prisma.agent.findMany({
            where: { isActive: true, skills: { has: 'reminder' } },
            select: {
                id: true, workspaceId: true, reminderHours: true,
                instances: { select: { id: true, status: true } },
                instagramAccounts: { select: { id: true, isActive: true } },
            },
        });
        for (const agent of agents) {
            const hours = Math.max(1, agent.reminderHours || 24);
            const cutoff = new Date(Date.now() - hours * 3600 * 1000);
            for (const inst of agent.instances) {
                const sock = sessions.get(inst.id);
                if (!sock) continue; // instance not connected — skip silently
                await sweepInstance(inst.id, agent.id, agent.workspaceId || '', hours, cutoff, sock).catch(err => {
                    logger.warn({ err: err?.message, instanceId: inst.id }, '[reminder] instance sweep failed');
                });
            }
            for (const igAcc of agent.instagramAccounts) {
                if (!igAcc.isActive) continue;
                await sweepIgAccount(igAcc.id, agent.id, agent.workspaceId || '', hours, cutoff).catch(err => {
                    logger.warn({ err: err?.message, accountId: igAcc.id }, '[reminder] IG account sweep failed');
                });
            }
        }
    } catch (e: any) {
        logger.error({ err: e?.message }, '[reminder] sweep failed');
    }
}

async function sweepInstance(instanceId: string, agentId: string, workspaceId: string, idleHours: number, cutoff: Date, sock: any) {
    // Only consider contacts this specific agent has actually talked
    // with at least once (a matching AiConversationLog row exists).
    // Without this, attaching the reminder skill would blast every
    // conversation on the instance — including chats from before this
    // agent was linked or chats handled by a different specialised
    // agent via the router.
    const owned = await prisma.aiConversationLog.findMany({
        where: { agentId, instanceId },
        distinct: ['remoteJid'],
        select: { remoteJid: true },
        take: 5000,
    });
    if (owned.length === 0) return;
    const ownedJids = owned.map(o => o.remoteJid);

    const candidates = await prisma.message.findMany({
        where: {
            instanceId,
            remoteJid: { in: ownedJids },
            timestamp: { lt: cutoff },
            isFromMe: false,
        },
        orderBy: { timestamp: 'desc' },
        distinct: ['remoteJid'],
        take: 200,
        select: { remoteJid: true, timestamp: true },
    });

    for (const cand of candidates) {
        try {
            // Confirm this candidate is genuinely the latest message —
            // a newer reply (in either direction) means we already
            // handled it.
            const latest = await prisma.message.findFirst({
                where: { instanceId, remoteJid: cand.remoteJid },
                orderBy: { timestamp: 'desc' },
                select: { isFromMe: true, timestamp: true },
            });
            if (!latest) continue;
            if (latest.isFromMe) continue; // we replied since
            if (latest.timestamp > cutoff) continue; // not idle enough

            const phone = cand.remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '');
            const client = await prisma.client.findFirst({ where: { workspaceId, phone } });
            if (!client) continue;
            if (client.agentPaused) continue;
            // Respect sticky routing: a contact bound to a different
            // agent (via the router's handoffTo) is no longer this
            // agent's responsibility, so reminders shouldn't fire from
            // here either.
            if (client.assignedAgentId && client.assignedAgentId !== agentId) continue;

            // Lock: if we already sent a reminder since the customer's
            // last message, skip. Plus the per-idle-state cap so we
            // don't nag forever.
            if (client.lastReminderAt && client.lastReminderAt > latest.timestamp) {
                // Count outgoing reminders that have piled up against this
                // idle state to enforce MAX_REMINDERS_PER_IDLE.
                const remindersSent = await prisma.aiConversationLog.count({
                    where: {
                        instanceId, remoteJid: cand.remoteJid,
                        createdAt: { gt: latest.timestamp },
                        toolCalls: { array_contains: [{ toolName: 'auto_reminder' }] } as any,
                    },
                }).catch(() => 0);
                if (remindersSent >= MAX_REMINDERS_PER_IDLE) continue;
                // The next nudge needs to wait at least one full
                // reminderHours window from the previous one.
                const nextDue = new Date(client.lastReminderAt.getTime() + idleHours * 3600 * 1000);
                if (nextDue > new Date()) continue;
            }

            logger.info({ instanceId, remoteJid: cand.remoteJid, idleHours }, '[reminder] firing');
            await AiService.triggerReminder({
                instanceId, remoteJid: cand.remoteJid, idleHours,
                sock, io,
            });
        } catch (e: any) {
            logger.warn({ err: e?.message, remoteJid: cand.remoteJid }, '[reminder] per-contact step failed');
        }
    }
}

// Instagram parallel to sweepInstance. Reminder eligibility uses
// aiConversationLog (IG doesn't populate prisma.message) — the last
// row's timestamp per remoteJid is treated as the last customer
// contact. Same per-contact lock, cap and sticky-routing rules as
// the WhatsApp path.
async function sweepIgAccount(accountId: string, agentId: string, workspaceId: string, idleHours: number, cutoff: Date) {
    // All IG conversations this agent has actually talked to.
    const owned = await prisma.aiConversationLog.findMany({
        where: { agentId, instanceId: accountId },
        distinct: ['remoteJid'],
        select: { remoteJid: true },
        take: 5000,
    });
    if (owned.length === 0) return;

    for (const row of owned) {
        try {
            const remoteJid = row.remoteJid;
            // Latest log for this contact. Reminder rows also live
            // here, so we look at the createdAt regardless of who
            // spoke last.
            const latest = await prisma.aiConversationLog.findFirst({
                where: { agentId, instanceId: accountId, remoteJid },
                orderBy: { createdAt: 'desc' },
                select: { userMessage: true, agentReply: true, createdAt: true, toolCalls: true },
            });
            if (!latest) continue;
            // Skip when the newest turn is a reminder itself — that
            // means we already nudged them for this idle state.
            const isReminderRow = Array.isArray(latest.toolCalls)
                && (latest.toolCalls as any[]).some(t => t?.toolName === 'auto_reminder');
            if (isReminderRow) continue;
            // Skip when the log ends with our own reply and it's fresh —
            // customer might just be reading.
            if (latest.createdAt > cutoff) continue;

            const senderId = remoteJid.replace(/^ig:/, '');
            const client = await prisma.client.findFirst({ where: { workspaceId, phone: senderId } });
            if (!client) continue;
            if (client.agentPaused) continue;
            if (client.assignedAgentId && client.assignedAgentId !== agentId) continue;

            if (client.lastReminderAt && client.lastReminderAt > latest.createdAt) {
                const remindersSent = await prisma.aiConversationLog.count({
                    where: {
                        instanceId: accountId, remoteJid,
                        createdAt: { gt: latest.createdAt },
                        toolCalls: { array_contains: [{ toolName: 'auto_reminder' }] } as any,
                    },
                }).catch(() => 0);
                if (remindersSent >= MAX_REMINDERS_PER_IDLE) continue;
                const nextDue = new Date(client.lastReminderAt.getTime() + idleHours * 3600 * 1000);
                if (nextDue > new Date()) continue;
            }

            logger.info({ accountId, senderId, idleHours }, '[reminder] IG firing');
            await AiService.triggerIgReminder({ accountId, senderId, idleHours });
        } catch (e: any) {
            logger.warn({ err: e?.message, remoteJid: row.remoteJid }, '[reminder] IG per-contact step failed');
        }
    }
}

export function startReminderScheduler() {
    logger.info('[reminder] scheduler started (15 min sweep)');
    setInterval(() => { sweep().catch(() => {}); }, SWEEP_MS);
    // First sweep 60s after boot so we don't compete with InstanceManager.init().
    setTimeout(() => { sweep().catch(() => {}); }, 60_000);
}

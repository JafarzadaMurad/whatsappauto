import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { sendIgMessage } from '../../instagram/instagram.ai.service';
import { MessagingService } from '../../messaging/messaging.service';
import { ok, fail, type RegisterToolFn } from '../mcp.server';

const messaging = new MessagingService();

async function ownsAccount(userId: string, channel: string, accountId: string): Promise<boolean> {
    if (channel === 'instagram') {
        const a = await prisma.instagramAccount.findFirst({ where: { id: accountId, userId } });
        return !!a;
    }
    const i = await prisma.instance.findFirst({ where: { id: accountId, userId } });
    return !!i;
}

export function registerInboxTools(reg: RegisterToolFn) {
    reg(
        'list_inbox_conversations',
        'Lists conversations the user has in the unified inbox for a specific channel + account. Returns contact id, last message time, and message count.',
        {
            channel: z.enum(['whatsapp', 'instagram']),
            accountId: z.string(),
            limit: z.number().int().min(1).max(200).optional(),
        },
        async ({ channel, accountId, limit }, ctx) => {
            const owned = await ownsAccount(ctx.userId, channel, accountId);
            if (!owned) return fail(`Account ${accountId} not found`);
            const rows = await prisma.aiConversationLog.groupBy({
                by: ['remoteJid'],
                where: { instanceId: accountId },
                _count: { _all: true },
                _max: { createdAt: true },
                take: Math.min(limit || 50, 200),
                orderBy: { _max: { createdAt: 'desc' } },
            });
            return ok(rows.map(r => ({
                contactId: r.remoteJid,
                messageCount: r._count._all,
                lastAt: r._max.createdAt,
            })));
        },
    );

    reg(
        'list_inbox_messages',
        'Returns the message history for a specific conversation (oldest first). `contactId` is the remoteJid (WhatsApp) or `ig:IGSID` (Instagram).',
        {
            accountId: z.string(),
            contactId: z.string(),
            limit: z.number().int().min(1).max(200).optional(),
        },
        async ({ accountId, contactId, limit }, ctx) => {
            // Confirm the user owns the account this conversation belongs to
            const [inst, ig] = await Promise.all([
                prisma.instance.findFirst({ where: { id: accountId, userId: ctx.userId } }),
                prisma.instagramAccount.findFirst({ where: { id: accountId, userId: ctx.userId } }),
            ]);
            if (!inst && !ig) return fail(`Account ${accountId} not found`);
            const rows = await prisma.aiConversationLog.findMany({
                where: { instanceId: accountId, remoteJid: contactId },
                orderBy: { createdAt: 'asc' },
                take: Math.min(limit || 50, 200),
                select: { id: true, userMessage: true, agentReply: true, createdAt: true },
            });
            return ok(rows);
        },
    );

    reg(
        'reply_in_inbox',
        'Sends a reply in an inbox conversation. Routes through WhatsApp or Instagram depending on `channel`. For WhatsApp, `to` is the phone (without @s.whatsapp.net). For Instagram, `to` is the IGSID.',
        {
            channel: z.enum(['whatsapp', 'instagram']),
            accountId: z.string(),
            to: z.string().min(3),
            text: z.string().min(1),
        },
        async ({ channel, accountId, to, text }, ctx) => {
            if (channel === 'whatsapp') {
                const inst = await prisma.instance.findFirst({ where: { id: accountId, userId: ctx.userId } });
                if (!inst) return fail(`WhatsApp instance ${accountId} not found`);
                const result = await messaging.sendText(accountId, to, text);
                return ok(result);
            }
            const acc = await prisma.instagramAccount.findFirst({ where: { id: accountId, userId: ctx.userId } });
            if (!acc) return fail(`Instagram account ${accountId} not found`);
            await sendIgMessage(acc.igUserId, to, text, acc.accessToken);
            return ok({ sent: true });
        },
    );
}

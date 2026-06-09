import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { sendIgMessage } from '../instagram/instagram.ai.service';
import { getWorkspaceId } from '../../lib/workspace-context';

export class InboxController {
    // List all messaging accounts (WhatsApp instances + Instagram accounts)
    async getAccounts(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const [instances, igAccounts] = await Promise.all([
                prisma.instance.findMany({
                    where: { workspaceId },
                    select: { id: true, name: true, status: true },
                    orderBy: { createdAt: 'asc' }
                }),
                prisma.instagramAccount.findMany({
                    where: { workspaceId },
                    select: { id: true, igUsername: true, igUserId: true, isActive: true },
                    orderBy: { createdAt: 'asc' }
                })
            ]);
            return res.json({
                success: true,
                whatsapp: instances.map(i => ({ id: i.id, name: i.name, status: i.status })),
                instagram: igAccounts.map(a => ({ id: a.id, username: a.igUsername, igUserId: a.igUserId, isActive: a.isActive }))
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Conversations for a given account (WhatsApp instance or Instagram account)
    async getConversations(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const accountId = req.query.accountId as string;
            const channel = req.query.channel as string; // 'whatsapp' | 'instagram'
            if (!accountId) return res.status(400).json({ success: false, message: 'accountId required' });

            // Verify the account belongs to the workspace
            if (channel === 'instagram') {
                const acc = await prisma.instagramAccount.findFirst({ where: { id: accountId, workspaceId } });
                if (!acc) return res.status(404).json({ success: false, message: 'Account not found' });
            } else {
                const inst = await prisma.instance.findFirst({ where: { id: accountId, workspaceId } });
                if (!inst) return res.status(404).json({ success: false, message: 'Account not found' });
            }

            const logs = await prisma.aiConversationLog.findMany({
                where: { instanceId: accountId },
                orderBy: { createdAt: 'desc' }
            });

            const grouped: Record<string, any> = {};
            for (const log of logs) {
                if (!grouped[log.remoteJid]) {
                    grouped[log.remoteJid] = {
                        remoteJid: log.remoteJid,
                        messageCount: 0,
                        lastMessageAt: log.createdAt,
                    };
                }
                grouped[log.remoteJid].messageCount++;
            }

            // For WhatsApp, also fold in raw messages from the Message table
            // (this is where the Baileys history sync and live messages
            // land). Without this, an inbox for a freshly synced instance
            // would look empty even though the data is in the database.
            if (channel !== 'instagram') {
                const rawCounts = await prisma.message.groupBy({
                    by: ['remoteJid'],
                    where: { instanceId: accountId },
                    _count: { _all: true },
                    _max: { timestamp: true },
                });
                for (const r of rawCounts) {
                    if (!r.remoteJid) continue;
                    const slot = grouped[r.remoteJid] || (grouped[r.remoteJid] = {
                        remoteJid: r.remoteJid,
                        messageCount: 0,
                        lastMessageAt: r._max.timestamp || new Date(0),
                    });
                    slot.messageCount = Math.max(slot.messageCount, r._count._all);
                    if (r._max.timestamp && (!slot.lastMessageAt || r._max.timestamp > slot.lastMessageAt)) {
                        slot.lastMessageAt = r._max.timestamp;
                    }
                }
            }

            if (channel === 'instagram') {
                const senderIds = Object.keys(grouped).filter(j => j.startsWith('ig:')).map(j => j.slice(3));
                if (senderIds.length > 0) {
                    const contacts = await prisma.instagramContact.findMany({ where: { senderId: { in: senderIds } } });
                    const bySender: Record<string, any> = {};
                    for (const c of contacts) bySender[c.senderId] = c;
                    for (const jid of Object.keys(grouped)) {
                        const c = bySender[jid.slice(3)];
                        grouped[jid].username = c?.username || null;
                        grouped[jid].name = c?.name || null;
                        grouped[jid].profilePic = c?.profilePic || null;
                    }
                }
            } else {
                // WhatsApp: enrich with Contact pushName
                const contacts = await prisma.contact.findMany({ where: { instanceId: accountId } });
                const byJid: Record<string, any> = {};
                for (const c of contacts) byJid[c.remoteJid] = c;
                for (const jid of Object.keys(grouped)) {
                    const c = byJid[jid];
                    grouped[jid].name = c?.pushName || c?.name || null;
                }
            }

            return res.json({ success: true, conversations: Object.values(grouped) });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getMessages(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const accountId = req.query.accountId as string;
            const remoteJid = req.query.remoteJid as string;
            if (!accountId || !remoteJid) return res.status(400).json({ success: false, message: 'accountId and remoteJid required' });

            // Ownership check via either account type
            const owns = await prisma.instance.findFirst({ where: { id: accountId, workspaceId } })
                || await prisma.instagramAccount.findFirst({ where: { id: accountId, workspaceId } });
            if (!owns) return res.status(404).json({ success: false, message: 'Account not found' });

            const logs = await prisma.aiConversationLog.findMany({
                where: { instanceId: accountId, remoteJid },
                orderBy: { createdAt: 'asc' }
            });

            // Pull raw WhatsApp messages from the Message table (history sync
            // + live capture). For Instagram there is no Message table use.
            const isIg = remoteJid.startsWith('ig:');
            const rawMessages = isIg ? [] : await prisma.message.findMany({
                where: { instanceId: accountId, remoteJid },
                orderBy: { timestamp: 'asc' }
            });

            // Project Message rows into the same shape the UI uses for
            // aiConversationLog rows: incoming as userMessage, outgoing as
            // agentReply. Drop rows whose content already appears in a log
            // entry (cheap dedupe by exact match within the same chat).
            const logTexts = new Set<string>();
            for (const l of logs) {
                if (l.userMessage) logTexts.add(`u:${l.userMessage}`);
                if (l.agentReply) logTexts.add(`a:${l.agentReply}`);
            }
            const projected = rawMessages
                .filter(r => {
                    const key = r.isFromMe ? `a:${r.content}` : `u:${r.content}`;
                    return !logTexts.has(key);
                })
                .map(r => ({
                    id: r.id,
                    userMessage: r.isFromMe ? '' : r.content,
                    agentReply: r.isFromMe ? r.content : '',
                    createdAt: r.timestamp,
                    provider: 'PHONE',
                    model: '',
                    promptTokens: 0,
                    completionTokens: 0,
                    totalTokens: 0,
                    toolCalls: [],
                }));

            const merged = [...logs, ...projected]
                .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

            return res.json({ success: true, messages: merged });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Manual reply — supports WhatsApp and Instagram.
    async reply(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const schema = z.object({
                accountId: z.string().min(1),
                remoteJid: z.string().min(1),
                text: z.string().min(1).max(950)
            });
            const { accountId, remoteJid, text } = schema.parse(req.body);

            // Instagram path
            if (remoteJid.startsWith('ig:')) {
                const account = await prisma.instagramAccount.findFirst({ where: { id: accountId, workspaceId } });
                if (!account) return res.status(404).json({ success: false, message: 'Instagram account not found' });
                const senderId = remoteJid.slice(3);
                try {
                    await sendIgMessage(account.igUserId, senderId, text, account.accessToken);
                } catch (e: any) {
                    const ig = e.response?.data?.error;
                    return res.status(502).json({ success: false, message: ig?.error_user_msg || ig?.message || e.message });
                }
                let agentId = account.agentId;
                if (!agentId) {
                    const anyAgent = await prisma.agent.findFirst({ where: { workspaceId }, select: { id: true } });
                    agentId = anyAgent?.id || null;
                }
                let log = null;
                if (agentId) {
                    log = await prisma.aiConversationLog.create({
                        data: {
                            agentId, instanceId: accountId, remoteJid,
                            userMessage: '', agentReply: text,
                            promptTokens: 0, completionTokens: 0, totalTokens: 0,
                            provider: 'MANUAL', model: 'manual', toolCalls: []
                        }
                    });
                }
                return res.json({ success: true, message: log });
            }

            // WhatsApp path — send via Baileys, save into Message table.
            const instance = await prisma.instance.findFirst({ where: { id: accountId, workspaceId } });
            if (!instance) return res.status(404).json({ success: false, message: 'WhatsApp instance not found' });
            const { sessions } = await import('../whatsapp/instance.manager');
            const sock = sessions.get(accountId);
            if (!sock) return res.status(502).json({ success: false, message: 'Instance is not connected' });
            try {
                await sock.sendMessage(remoteJid, { text });
            } catch (e: any) {
                return res.status(502).json({ success: false, message: e.message || 'Send failed' });
            }
            const saved = await prisma.message.create({
                data: {
                    instanceId: accountId, remoteJid, isFromMe: true,
                    messageType: 'text', content: text, timestamp: new Date(),
                }
            });
            return res.json({ success: true, message: {
                id: saved.id,
                userMessage: '', agentReply: text,
                createdAt: saved.timestamp,
                provider: 'MANUAL', model: 'manual',
                promptTokens: 0, completionTokens: 0, totalTokens: 0, toolCalls: [],
            }});
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

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
    // Unified inbox: every conversation from every connected account in
    // the active workspace, with channel info, contact name (best
    // effort), last message preview, and lastMessageAt. Sorted newest
    // first. The UI uses this to render a single Wazzup-style list.
    async getUnified(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const channelFilter = String(req.query.channel || ''); // '', 'whatsapp', 'instagram'

            const [instances, igAccounts] = await Promise.all([
                prisma.instance.findMany({
                    where: { workspaceId },
                    select: { id: true, name: true },
                }),
                prisma.instagramAccount.findMany({
                    where: { workspaceId },
                    select: { id: true, igUsername: true, igUserId: true },
                }),
            ]);

            const instanceIds = instances.map(i => i.id);
            const igAccountIds = igAccounts.map(a => a.id);

            const wantWa = !channelFilter || channelFilter === 'whatsapp';
            const wantIg = !channelFilter || channelFilter === 'instagram';

            type Convo = {
                accountId: string;
                accountName: string;
                channel: 'whatsapp' | 'instagram';
                remoteJid: string;
                name: string | null;
                phone: string;
                /** True when the JID is an anonymous WhatsApp LID — the
                 * "phone" field is the LID, not a real phone number, so
                 * the UI should hide the +number underneath. */
                isAnonymous: boolean;
                lastMessage: string;
                lastFromMe: boolean;
                lastMessageAt: Date;
                messageCount: number;
                profilePic?: string | null;
            };

            const convos: Convo[] = [];

            // ─── WhatsApp ───
            if (wantWa && instanceIds.length > 0) {
                const grouped = await prisma.message.groupBy({
                    by: ['instanceId', 'remoteJid'],
                    where: { instanceId: { in: instanceIds } },
                    _count: { _all: true },
                    _max: { timestamp: true },
                });

                // Fetch the latest message per (instance, jid) for preview
                const lastMessages = await Promise.all(grouped.map(async g => {
                    if (!g.remoteJid) return null;
                    const last = await prisma.message.findFirst({
                        where: { instanceId: g.instanceId, remoteJid: g.remoteJid },
                        orderBy: { timestamp: 'desc' },
                        select: { content: true, isFromMe: true, timestamp: true },
                    });
                    return { g, last };
                }));

                const contactsByInstance = new Map<string, Map<string, any>>();
                for (const inst of instances) {
                    const contacts = await prisma.contact.findMany({ where: { instanceId: inst.id } });
                    const m = new Map<string, any>();
                    for (const c of contacts) m.set(c.remoteJid, c);
                    contactsByInstance.set(inst.id, m);
                }

                for (const lm of lastMessages) {
                    if (!lm || !lm.last || !lm.g.remoteJid) continue;
                    const inst = instances.find(i => i.id === lm.g.instanceId);
                    if (!inst) continue;
                    const c = contactsByInstance.get(inst.id)?.get(lm.g.remoteJid);
                    const phone = lm.g.remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '');
                    const isAnonymous = lm.g.remoteJid.endsWith('@lid');
                    convos.push({
                        accountId: inst.id,
                        accountName: inst.name,
                        channel: 'whatsapp',
                        remoteJid: lm.g.remoteJid,
                        // Prefer the name the user saved on their phone (Contact.name)
                        // over the contact's own broadcast name (pushName).
                        name: c?.name || c?.pushName || null,
                        phone,
                        isAnonymous,
                        lastMessage: lm.last.content || '',
                        lastFromMe: lm.last.isFromMe,
                        lastMessageAt: lm.last.timestamp || new Date(0),
                        messageCount: lm.g._count._all,
                    });
                }
            }

            // ─── Instagram ───
            if (wantIg && igAccountIds.length > 0) {
                const grouped = await prisma.aiConversationLog.groupBy({
                    by: ['instanceId', 'remoteJid'],
                    where: { instanceId: { in: igAccountIds } },
                    _count: { _all: true },
                    _max: { createdAt: true },
                });

                const igContactsByJid = new Map<string, any>();
                const senderIds = grouped
                    .map(g => g.remoteJid)
                    .filter(j => j.startsWith('ig:'))
                    .map(j => j.slice(3));
                if (senderIds.length > 0) {
                    const contacts = await prisma.instagramContact.findMany({ where: { senderId: { in: senderIds } } });
                    for (const c of contacts) igContactsByJid.set(`ig:${c.senderId}`, c);
                }

                const lastMessages = await Promise.all(grouped.map(async g => {
                    const last = await prisma.aiConversationLog.findFirst({
                        where: { instanceId: g.instanceId, remoteJid: g.remoteJid },
                        orderBy: { createdAt: 'desc' },
                        select: { userMessage: true, agentReply: true, createdAt: true },
                    });
                    return { g, last };
                }));

                for (const lm of lastMessages) {
                    if (!lm || !lm.last) continue;
                    const acc = igAccounts.find(a => a.id === lm.g.instanceId);
                    if (!acc) continue;
                    const c = igContactsByJid.get(lm.g.remoteJid);
                    const isFromMe = !!lm.last.agentReply && !lm.last.userMessage;
                    const previewText = isFromMe ? lm.last.agentReply : lm.last.userMessage;
                    convos.push({
                        accountId: acc.id,
                        accountName: '@' + acc.igUsername,
                        channel: 'instagram',
                        remoteJid: lm.g.remoteJid,
                        name: c?.name || c?.username || null,
                        phone: lm.g.remoteJid.replace(/^ig:/, ''),
                        // IGSIDs are anonymous identifiers, not phone numbers.
                        isAnonymous: true,
                        lastMessage: previewText || '',
                        lastFromMe: isFromMe,
                        lastMessageAt: lm.last.createdAt,
                        messageCount: lm.g._count._all,
                        profilePic: c?.profilePic || null,
                    });
                }
            }

            convos.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
            return res.json({ success: true, conversations: convos });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

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

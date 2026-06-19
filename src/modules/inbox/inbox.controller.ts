import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { sendIgMessage } from '../instagram/instagram.ai.service';
import { getWorkspaceId } from '../../lib/workspace-context';

// Older rows in DB still carry "[Media/Unsupported]" / "[Media]" as the
// literal preview text from before message-content.ts started producing
// friendly labels. Rewrite them on the way out so the inbox UI never
// shows the raw placeholder.
function prettifyContent(s: string | null | undefined): string {
    if (!s) return '';
    if (s === '[Media/Unsupported]' || s === '[Media]') return '📎 Media';
    return s;
}

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
                unreadCount?: number;
                profilePic?: string | null;
                agentPaused?: boolean;
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

                // Unread inbound count per (instance, jid) — used for the
                // green badge on each conversation row. "Unread" means
                // isFromMe=false AND readAt is null.
                const unreadGrouped = await prisma.message.groupBy({
                    by: ['instanceId', 'remoteJid'],
                    where: {
                        instanceId: { in: instanceIds },
                        isFromMe: false,
                        readAt: null,
                    },
                    _count: { _all: true },
                });
                const unreadKey = (iid: string, jid: string) => `${iid}${jid}`;
                const unreadMap = new Map<string, number>();
                for (const u of unreadGrouped) {
                    if (!u.remoteJid) continue;
                    unreadMap.set(unreadKey(u.instanceId, u.remoteJid), u._count._all);
                }

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
                        lastMessage: prettifyContent(lm.last.content),
                        lastFromMe: lm.last.isFromMe,
                        lastMessageAt: lm.last.timestamp || new Date(0),
                        messageCount: lm.g._count._all,
                        unreadCount: unreadMap.get(unreadKey(lm.g.instanceId, lm.g.remoteJid)) || 0,
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
                        lastMessage: prettifyContent(previewText),
                        lastFromMe: isFromMe,
                        lastMessageAt: lm.last.createdAt,
                        messageCount: lm.g._count._all,
                        profilePic: c?.profilePic || null,
                    });
                }
            }

            // Batch-attach the cached profile picture + agent-paused flag
            // for every conversation row. Client is keyed by
            // (workspaceId, phone) and covers both WhatsApp and Instagram
            // — IG conversations already get profilePic from
            // InstagramContact above but still need agentPaused from
            // here.
            const allPhones = convos.map(c => c.phone);
            if (allPhones.length > 0) {
                const rows = await prisma.client.findMany({
                    where: { workspaceId, phone: { in: allPhones } },
                    select: { phone: true, profilePicUrl: true, agentPaused: true },
                });
                const byPhone = new Map(rows.map(r => [r.phone, r]));
                for (const c of convos) {
                    const r = byPhone.get(c.phone);
                    if (!r) continue;
                    if (c.channel === 'whatsapp' && !c.profilePic) c.profilePic = r.profilePicUrl || null;
                    c.agentPaused = !!r.agentPaused;
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

            // Paginate: return the newest `limit` rows older than `before`
            // (ISO timestamp). The chat UI loads more by passing the
            // oldest currently-loaded timestamp as `before`.
            const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
            const beforeRaw = req.query.before as string | undefined;
            const before = beforeRaw ? new Date(beforeRaw) : null;

            // Ownership check via either account type
            const owns = await prisma.instance.findFirst({ where: { id: accountId, workspaceId } })
                || await prisma.instagramAccount.findFirst({ where: { id: accountId, workspaceId } });
            if (!owns) return res.status(404).json({ success: false, message: 'Account not found' });

            // To paginate across two tables (logs + raw messages) without
            // double-counting, we over-fetch `limit` newest rows from
            // each, merge, dedupe, take the newest `limit` from the
            // merged result, then expose `hasMore` if either source still
            // had earlier rows.
            const logs = await prisma.aiConversationLog.findMany({
                where: {
                    instanceId: accountId, remoteJid,
                    ...(before ? { createdAt: { lt: before } } : {}),
                },
                orderBy: { createdAt: 'desc' },
                take: limit + 1, // +1 to detect hasMore from this source
            });

            const isIg = remoteJid.startsWith('ig:');
            const rawMessages = isIg ? [] : await prisma.message.findMany({
                where: {
                    instanceId: accountId, remoteJid,
                    ...(before ? { timestamp: { lt: before } } : {}),
                },
                orderBy: { timestamp: 'desc' },
                take: limit + 1,
            });

            // Project Message rows into the aiConversationLog shape.
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
                    userMessage: r.isFromMe ? '' : prettifyContent(r.content),
                    agentReply: r.isFromMe ? prettifyContent(r.content) : '',
                    createdAt: r.timestamp,
                    provider: 'PHONE',
                    model: '',
                    promptTokens: 0,
                    completionTokens: 0,
                    totalTokens: 0,
                    toolCalls: [],
                    // Surface media so the chat UI can render thumbnails /
                    // play voice notes instead of just showing the
                    // "🖼️ Photo" placeholder label.
                    messageType: r.messageType,
                    mediaUrl: r.mediaUrl,
                    mediaMime: r.mediaMime,
                    mediaName: r.mediaName,
                    waMsgId: r.waMsgId,
                    deliveryStatus: r.status, // SENT | DELIVERED | READ
                }));

            const cleanedLogs = logs.map(l => ({
                ...l,
                userMessage: prettifyContent(l.userMessage),
                agentReply: prettifyContent(l.agentReply),
            }));

            // Combine, sort asc (oldest first — that's what the chat UI expects),
            // then take only the newest `limit` from the combined set so we
            // never return more than asked even when both sources are full.
            const combinedDesc = [...cleanedLogs, ...projected]
                .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            const pageDesc = combinedDesc.slice(0, limit);
            const page = pageDesc.slice().reverse(); // asc for the UI

            // hasMore = either source still has data older than the
            // earliest row we returned. The +1 over-fetch gives us a
            // cheap signal; we also re-check by comparing slice sizes.
            const hasMore = (logs.length > limit) || (rawMessages.length > limit) || (combinedDesc.length > limit);

            return res.json({ success: true, messages: page, hasMore });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Manual reply — supports WhatsApp and Instagram.
    // Mark all inbound messages in a conversation as read. Called by
    // the inbox when the operator opens a chat so the unread badge
    // clears and (for WhatsApp) we can optionally ship a read receipt
    // upstream later.
    async markRead(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const schema = z.object({
                accountId: z.string().min(1),
                remoteJid: z.string().min(1),
            });
            const { accountId, remoteJid } = schema.parse(req.body);

            const owns = await prisma.instance.findFirst({ where: { id: accountId, workspaceId } })
                || await prisma.instagramAccount.findFirst({ where: { id: accountId, workspaceId } });
            if (!owns) return res.status(404).json({ success: false, message: 'Account not found' });

            const result = await prisma.message.updateMany({
                where: { instanceId: accountId, remoteJid, isFromMe: false, readAt: null },
                data: { readAt: new Date() },
            });
            return res.json({ success: true, markedRead: result.count });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

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

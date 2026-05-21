import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { sendIgMessage } from '../instagram/instagram.ai.service';

export class InboxController {
    // List all messaging accounts (WhatsApp instances + Instagram accounts)
    async getAccounts(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const [instances, igAccounts] = await Promise.all([
                prisma.instance.findMany({
                    where: { userId },
                    select: { id: true, name: true, status: true },
                    orderBy: { createdAt: 'asc' }
                }),
                prisma.instagramAccount.findMany({
                    where: { userId },
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
            const userId = (req as any).user.id;
            const accountId = req.query.accountId as string;
            const channel = req.query.channel as string; // 'whatsapp' | 'instagram'
            if (!accountId) return res.status(400).json({ success: false, message: 'accountId required' });

            // Verify the account belongs to the user
            if (channel === 'instagram') {
                const acc = await prisma.instagramAccount.findFirst({ where: { id: accountId, userId } });
                if (!acc) return res.status(404).json({ success: false, message: 'Account not found' });
            } else {
                const inst = await prisma.instance.findFirst({ where: { id: accountId, userId } });
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
            const userId = (req as any).user.id;
            const accountId = req.query.accountId as string;
            const remoteJid = req.query.remoteJid as string;
            if (!accountId || !remoteJid) return res.status(400).json({ success: false, message: 'accountId and remoteJid required' });

            // Ownership check via either account type
            const owns = await prisma.instance.findFirst({ where: { id: accountId, userId } })
                || await prisma.instagramAccount.findFirst({ where: { id: accountId, userId } });
            if (!owns) return res.status(404).json({ success: false, message: 'Account not found' });

            const messages = await prisma.aiConversationLog.findMany({
                where: { instanceId: accountId, remoteJid },
                orderBy: { createdAt: 'asc' }
            });
            return res.json({ success: true, messages });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Manual reply (Instagram only for now)
    async reply(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const schema = z.object({
                accountId: z.string().min(1),
                remoteJid: z.string().min(1),
                text: z.string().min(1).max(950)
            });
            const { accountId, remoteJid, text } = schema.parse(req.body);

            if (!remoteJid.startsWith('ig:')) {
                return res.status(400).json({ success: false, message: 'Manual reply is currently supported for Instagram conversations only' });
            }

            const account = await prisma.instagramAccount.findFirst({ where: { id: accountId, userId } });
            if (!account) return res.status(404).json({ success: false, message: 'Instagram account not found' });

            const senderId = remoteJid.slice(3);
            try {
                await sendIgMessage(account.igUserId, senderId, text, account.accessToken);
            } catch (e: any) {
                const ig = e.response?.data?.error;
                return res.status(502).json({ success: false, message: ig?.error_user_msg || ig?.message || e.message });
            }

            // Record the manual reply. agentId is required on the log — use the
            // account's assigned agent if any, else any agent of the user.
            let agentId = account.agentId;
            if (!agentId) {
                const anyAgent = await prisma.agent.findFirst({ where: { userId }, select: { id: true } });
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
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

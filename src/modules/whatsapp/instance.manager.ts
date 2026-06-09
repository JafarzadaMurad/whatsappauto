import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    WASocket,
    isJidGroup
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { logger } from '../../utils/logger';
import { prisma } from '../../lib/prisma';
import { io } from '../../server';
import qrcode from 'qrcode';
import { webhookQueue } from '../webhook/webhook.dispatcher';
import { AiService } from '../agent/ai.service';
import { upsertCrmContact } from '../client/client.service';
import { extractMessageContent } from './message-content';
// We will replace useMultiFileAuthState with DB-backed later, using this for basic structure first.
// import { usePrismaAuthState } from './auth-state'; 

export const sessions = new Map<string, WASocket>();

export class InstanceManager {
    static async startInstance(instanceId: string) {
        try {
            // Check if instance exists in DB
            const instanceDb = await prisma.instance.findUnique({
                where: { id: instanceId }
            });

            if (!instanceDb) {
                logger.error(`Instance ${instanceId} not found in DB`);
                return;
            }

            logger.info(`Starting WhatsApp instance: ${instanceId}`);

            // Basic file-based auth for now. We will migrate to Prisma DB-based auth later.
            const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${instanceId}`);
            const { version } = await fetchLatestBaileysVersion();

            const sock = makeWASocket({
                version,
                printQRInTerminal: false,
                auth: state,
                logger: logger.child({ module: 'baileys' }) as any,
                browser: ['alChatBot', 'Chrome', '1.0.0'],
                // When the user opted in, request the full chat history from
                // the phone on the initial sync. Otherwise Baileys defaults
                // to a small recent window.
                syncFullHistory: !!instanceDb.syncHistory,
            });

            sessions.set(instanceId, sock);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    try {
                        const qrDataUrl = await qrcode.toDataURL(qr);
                        io.emit(`qr-${instanceId}`, qrDataUrl);
                        await prisma.instance.update({
                            where: { id: instanceId },
                            data: { status: 'CONNECTING' }
                        });
                    } catch (err: any) {
                        logger.error({ err }, 'Error generating QR code');
                    }
                }

                if (connection === 'close') {
                    const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                    logger.warn(`Connection closed for ${instanceId}. Reconnecting: ${shouldReconnect}`);

                    if (shouldReconnect) {
                        await prisma.instance.update({
                            where: { id: instanceId },
                            data: { status: 'DISCONNECTED' }
                        });
                        setTimeout(() => this.startInstance(instanceId), 3000);
                    } else {
                        logger.info(`Connection logged out for ${instanceId}`);
                        sessions.delete(instanceId);
                        await prisma.instance.update({
                            where: { id: instanceId },
                            data: { status: 'DISCONNECTED' }
                        });
                        // Cleanup DB keys if needed
                    }
                } else if (connection === 'open') {
                    logger.info(`Connected instance: ${instanceId}`);
                    await prisma.instance.update({
                        where: { id: instanceId },
                        data: { status: 'CONNECTED' }
                    });

                    io.emit(`status-${instanceId}`, 'CONNECTED');
                }
            });

            sock.ev.on('creds.update', saveCreds);

            // Live contact-list updates (name changes, new contacts pulled
            // from the phone). Baileys also fires this right after the
            // history sync, which is where we pick up the names the user
            // saved on their phone (as opposed to pushName / "notify"
            // which is what each contact broadcasts about themselves).
            sock.ev.on('contacts.upsert', async (contacts: any[]) => {
                for (const c of contacts) {
                    const remoteJid = c.id;
                    if (!remoteJid) continue;
                    const name = c.name || c.verifiedName || null;
                    const pushName = c.notify || c.pushName || null;
                    if (!name && !pushName) continue;
                    await prisma.contact.upsert({
                        where: { instanceId_remoteJid: { instanceId, remoteJid } },
                        update: {
                            ...(name ? { name } : {}),
                            ...(pushName ? { pushName } : {}),
                        },
                        create: { instanceId, remoteJid, name, pushName },
                    }).catch(() => {});
                }
            });

            // History sync: fires after the phone uploads its message
            // history right after pairing. Each chunk contains messages
            // and contact metadata. We persist them so the inbox UI
            // shows existing conversations alongside live ones.
            sock.ev.on('messaging-history.set', async (h: any) => {
                try {
                    // Phone-book contacts come in the history payload too;
                    // these carry the names the user saved on their phone.
                    const contactList: any[] = h.contacts || [];
                    for (const c of contactList) {
                        const remoteJid = c.id;
                        if (!remoteJid) continue;
                        const name = c.name || c.verifiedName || null;
                        const pushName = c.notify || c.pushName || null;
                        if (!name && !pushName) continue;
                        await prisma.contact.upsert({
                            where: { instanceId_remoteJid: { instanceId, remoteJid } },
                            update: {
                                ...(name ? { name } : {}),
                                ...(pushName ? { pushName } : {}),
                            },
                            create: { instanceId, remoteJid, name, pushName },
                        }).catch(() => {});
                    }

                    const msgs: any[] = h.messages || [];
                    if (msgs.length === 0) return;
                    logger.info(`[${instanceId}] History sync: ${msgs.length} messages, ${contactList.length} contacts, progress=${h.progress ?? '?'}, isLatest=${h.isLatest ?? '?'}`);

                    for (const msg of msgs) {
                        const remoteJid = msg.key?.remoteJid;
                        if (!remoteJid || remoteJid === 'status@broadcast' || isJidGroup(remoteJid)) continue;
                        if (!msg.message) continue;

                        const { content, type: msgType } = extractMessageContent(msg);
                        if (!content || msgType === 'protocol') continue;
                        const ts = new Date(((msg.messageTimestamp as number) || 0) * 1000 || Date.now());

                        // Idempotent: skip duplicates by (instanceId, remoteJid, timestamp, content).
                        const existing = await prisma.message.findFirst({
                            where: { instanceId, remoteJid, timestamp: ts, content },
                            select: { id: true },
                        });
                        if (existing) continue;

                        await prisma.message.create({
                            data: {
                                instanceId,
                                remoteJid,
                                isFromMe: !!msg.key?.fromMe,
                                messageType: msgType,
                                content,
                                timestamp: ts,
                            },
                        }).catch(() => {});

                        // Add to CRM (workspace-scoped). Look up the instance
                        // once per chunk; cheap because Prisma caches.
                        if (!msg.key?.fromMe) {
                            prisma.instance.findUnique({
                                where: { id: instanceId },
                                select: { userId: true, name: true, workspaceId: true }
                            }).then(async inst => {
                                if (!inst) return;
                                const wsId = inst.workspaceId
                                    || (await (await import('../../lib/workspace-migration')).getOrCreatePersonalWorkspace(inst.userId));
                                return upsertCrmContact({
                                    userId: inst.userId,
                                    workspaceId: wsId,
                                    phone: remoteJid.replace('@s.whatsapp.net', '').replace('@lid', ''),
                                    name: msg.pushName || null,
                                    channel: 'whatsapp',
                                    sourceLabel: inst.name,
                                });
                            }).catch(() => {});
                        }
                    }
                } catch (e: any) {
                    logger.warn({ err: e.message }, `[${instanceId}] History sync handler failed`);
                }
            });

            sock.ev.on('messages.upsert', async (m) => {
                if (m.type !== 'notify') return;
                for (const msg of m.messages) {
                    const isStatus = msg.key.remoteJid === 'status@broadcast';
                    const remoteJid = msg.key.remoteJid;
                    if (!remoteJid || isStatus || isJidGroup(remoteJid) || !msg.message) continue;

                    const { content, type: msgType } = extractMessageContent(msg);
                    if (!content || msgType === 'protocol') continue;
                    const ts = new Date((msg.messageTimestamp as number) * 1000 || Date.now());

                    // Outgoing messages — save and emit so the inbox shows
                    // them, but skip the AI / webhook / CRM machinery
                    // (those are for incoming only).
                    if (msg.key.fromMe) {
                        await prisma.message.create({
                            data: {
                                instanceId,
                                remoteJid,
                                isFromMe: true,
                                messageType: msgType,
                                content,
                                timestamp: ts,
                            },
                        }).catch(() => {});
                        io.emit(`message.new-${instanceId}`, {
                            id: msg.key.id,
                            isFromMe: true,
                            content,
                            remoteJid,
                            status: 'SENT',
                            timestamp: ts.toISOString(),
                        });
                        continue;
                    }

                    // ─── Incoming message ───
                    logger.info(`[${instanceId}] New message from ${remoteJid}`);

                    if (msg.pushName) {
                        await prisma.contact.upsert({
                            where: { instanceId_remoteJid: { instanceId, remoteJid } },
                            update: { pushName: msg.pushName },
                            create: { instanceId, remoteJid, pushName: msg.pushName },
                        }).catch(() => {});
                    }

                    await prisma.message.create({
                        data: {
                            instanceId,
                            remoteJid,
                            isFromMe: false,
                            messageType: msgType,
                            content,
                            timestamp: ts,
                        },
                    });

                    // Auto-add the sender to CRM with channel info
                    prisma.instance.findUnique({
                        where: { id: instanceId },
                        select: { userId: true, name: true, workspaceId: true },
                    }).then(async inst => {
                        if (!inst) return;
                        const wsId = inst.workspaceId
                            || (await (await import('../../lib/workspace-migration')).getOrCreatePersonalWorkspace(inst.userId));
                        return upsertCrmContact({
                            userId: inst.userId,
                            workspaceId: wsId,
                            phone: remoteJid.replace('@s.whatsapp.net', '').replace('@lid', ''),
                            name: msg.pushName || null,
                            channel: 'whatsapp',
                            sourceLabel: inst.name,
                        });
                    }).catch(() => {});

                    webhookQueue.add('new-message', {
                        instanceId,
                        event: 'message.new',
                        payload: msg,
                    }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });

                    io.emit(`message.new-${instanceId}`, {
                        id: msg.key.id,
                        isFromMe: false,
                        content,
                        remoteJid,
                        status: 'DELIVERED',
                        timestamp: ts.toISOString(),
                    });

                    prisma.campaignRecipient.updateMany({
                        where: { remoteJid, campaign: { instanceId }, status: 'SENT' },
                        data: { status: 'REPLIED', repliedAt: new Date() },
                    }).catch(() => {});

                    AiService.handleIncomingMessage(instanceId, remoteJid, sock, io).catch(err => {
                        logger.error({ err, instanceId }, 'Error triggering AI service');
                    });
                }
            });

            return sock;

        } catch (error: any) {
            logger.error({ err: error }, `Failed to start instance ${instanceId}`);
        }
    }

    static async stopInstance(instanceId: string) {
        const sock = sessions.get(instanceId);
        if (sock) {
            sock.end(undefined);
            sessions.delete(instanceId);
            await prisma.instance.update({
                where: { id: instanceId },
                data: { status: 'DISCONNECTED' }
            });
            logger.info(`Stopped instance: ${instanceId}`);
        }
    }

    static async init() {
        const instances = await prisma.instance.findMany({
            where: { status: 'CONNECTED' }
        });

        logger.info(`Recovering ${instances.length} active instances...`);

        for (const instance of instances) {
            this.startInstance(instance.id);
        }
    }
}

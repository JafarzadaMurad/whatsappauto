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
import { resolveJid } from './lid-resolver';
import { findOperatorByPhone, handleOperatorMessage } from '../operator/operator.service';
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
            // from the phone). Baileys fires `contacts.upsert` when a
            // contact is first seen and `contacts.update` for subsequent
            // changes — both can carry the phone-book name the user has
            // saved, so we treat them the same.
            const persistContactRow = async (c: any) => {
                const remoteJid = c.id;
                if (!remoteJid) return;
                const name = c.name || c.verifiedName || null;
                const pushName = c.notify || c.pushName || null;
                if (!name && !pushName) return;
                await prisma.contact.upsert({
                    where: { instanceId_remoteJid: { instanceId, remoteJid } },
                    update: {
                        ...(name ? { name } : {}),
                        ...(pushName ? { pushName } : {}),
                    },
                    create: { instanceId, remoteJid, name, pushName },
                }).catch(() => {});
            };

            sock.ev.on('contacts.upsert', async (contacts: any[]) => {
                const withName = contacts.filter(c => c.name || c.verifiedName).length;
                logger.info(
                    `[${instanceId}] contacts.upsert: ${contacts.length} total, ${withName} with saved name | sample=${JSON.stringify(contacts.slice(0, 3))}`
                );
                for (const c of contacts) await persistContactRow(c);
            });

            sock.ev.on('contacts.update', async (contacts: any[]) => {
                const withName = contacts.filter(c => c.name || c.verifiedName).length;
                logger.info(
                    `[${instanceId}] contacts.update: ${contacts.length} total, ${withName} with saved name | sample=${JSON.stringify(contacts.slice(0, 3))}`
                );
                for (const c of contacts) await persistContactRow(c);
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
                        const rawJid = msg.key?.remoteJid;
                        if (!rawJid || rawJid === 'status@broadcast' || isJidGroup(rawJid)) continue;
                        if (!msg.message) continue;

                        // Same LID→phone resolution as live messages so the
                        // history sync doesn't seed a duplicate set of LID-
                        // keyed rows that would have to be merged later.
                        const { effectiveJid: remoteJid, phone: resolvedPhone, isAnonymous } =
                            await resolveJid(instanceId, rawJid, msg);

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
                                    phone: resolvedPhone,
                                    name: msg.pushName || null,
                                    channel: 'whatsapp',
                                    sourceLabel: inst.name,
                                    isAnonymous,
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
                    const rawJid = msg.key.remoteJid;
                    if (!rawJid || isStatus || isJidGroup(rawJid) || !msg.message) continue;

                    // Full payload dump for debugging. Flip on with
                    //   WHATSAPP_DEBUG=true (env var) and restart pm2.
                    // Logs every incoming message verbatim so you can
                    // see exactly which fields Baileys delivers (LID
                    // shape, senderPn variants, message content type,
                    // etc.). Off in production by default — it's
                    // noisy and exposes message text.
                    if (process.env.WHATSAPP_DEBUG === 'true') {
                        try {
                            logger.info(`[${instanceId}] MSG_DUMP ${JSON.stringify(msg)}`);
                        } catch { /* not critical */ }
                    }

                    // Translate any @lid jid to its canonical phone form
                    // (when senderPn is in the payload, or a previous
                    // mapping was cached). Everything below uses the
                    // resolved JID so the inbox & CRM don't grow a
                    // duplicate row for the same person.
                    const { effectiveJid: remoteJid, phone: resolvedPhone, isAnonymous } =
                        await resolveJid(instanceId, rawJid, msg);

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
                    logger.info(`[${instanceId}] New message from ${remoteJid}${isAnonymous ? ' (anonymous LID)' : ''}`);

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
                            phone: resolvedPhone,
                            name: msg.pushName || null,
                            channel: 'whatsapp',
                            sourceLabel: inst.name,
                            isAnonymous,
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

                    // Operator routing: if the sender's phone is in
                    // the Operator table for the agent this instance
                    // is wired to, route the message to the operator
                    // service. Scoped to instance.agentId so an
                    // operator registered for agent A doesn't get
                    // intercepted when messaging an unrelated agent B's
                    // WhatsApp instance.
                    const instAgent = await prisma.instance.findUnique({
                        where: { id: instanceId },
                        select: { agentId: true },
                    });
                    if (instAgent?.agentId) {
                        const operator = await findOperatorByPhone(resolvedPhone, instAgent.agentId);
                        if (operator) {
                            const quotedBody =
                                (msg.message as any)?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
                                (msg.message as any)?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text ||
                                null;
                            handleOperatorMessage({
                                instanceId, operator,
                                body: content,
                                quotedBody,
                            }).catch(err => logger.error({ err, instanceId }, 'Operator handler failed'));
                            continue;
                        }
                    }

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

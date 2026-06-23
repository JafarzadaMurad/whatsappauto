import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    WASocket,
    isJidGroup,
    getAggregateVotesInPollMessage,
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
import { downloadAndSaveMedia } from './media-downloader';
import { maybeRefreshProfilePicAsync } from './profile-pic';
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
                // Stay invisible to WhatsApp so the user's phone keeps
                // showing push notifications normally. Without this,
                // Baileys announces presence as "online" on connect and
                // WhatsApp routes notifications to the Web/MD client
                // instead of the phone — the most common "my phone went
                // silent after I connected" complaint.
                markOnlineOnConnect: false,
                // Required by getAggregateVotesInPollMessage so we can
                // decrypt a customer's vote: Baileys asks us for the
                // original poll message proto and we hand back the
                // pollPayload column we stashed when sendPoll fired.
                getMessage: async (key: any) => {
                    try {
                        const waMsgId = key?.id;
                        if (!waMsgId) return undefined;
                        const row = await prisma.message.findFirst({
                            where: { instanceId, waMsgId },
                            select: { pollPayload: true },
                        });
                        return (row?.pollPayload as any) || undefined;
                    } catch { return undefined; }
                },
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

                        // History sync media — download in the background
                        // and patch the row when we have the URL. We don't
                        // block the sync loop on each download.
                        const created = await prisma.message.create({
                            data: {
                                instanceId,
                                remoteJid,
                                isFromMe: !!msg.key?.fromMe,
                                messageType: msgType,
                                content,
                                timestamp: ts,
                                waMsgId: msg.key?.id || null,
                            },
                        }).catch(() => null);
                        if (created && ['image', 'video', 'audio', 'document', 'sticker'].includes(msgType)) {
                            downloadAndSaveMedia(msg, sock).then(saved => {
                                if (saved) {
                                    prisma.message.update({
                                        where: { id: created.id },
                                        data: { mediaUrl: saved.mediaUrl, mediaMime: saved.mediaMime, mediaName: saved.mediaName },
                                    }).catch(() => {});
                                }
                            });
                        }

                        // Add to CRM (workspace-scoped). Look up the instance
                        // once per chunk; cheap because Prisma caches.
                        if (!msg.key?.fromMe) {
                            prisma.instance.findUnique({
                                where: { id: instanceId },
                                select: { userId: true, name: true, workspaceId: true }
                            }).then(async (inst: any) => {
                                if (!inst) return;
                                const wsId = inst.workspaceId
                                    || (await (await import('../../lib/workspace-migration')).getOrCreatePersonalWorkspace(inst.userId));
                                const c = await upsertCrmContact({
                                    userId: inst.userId,
                                    workspaceId: wsId,
                                    phone: resolvedPhone,
                                    name: msg.pushName || null,
                                    channel: 'whatsapp',
                                    sourceLabel: inst.name,
                                    isAnonymous,
                                });
                                if (c) maybeRefreshProfilePicAsync({ instanceId, clientId: c.id, jid: remoteJid, profilePicUpdatedAt: c.profilePicUpdatedAt });
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
                    // Pull media for image / video / audio / document /
                    // sticker so the inbox can render the thumbnail or
                    // play the clip. Awaited (small media is fast; large
                    // media still finishes before we touch the DB so the
                    // record has the URL immediately).
                    const mediaTypes = ['image', 'video', 'audio', 'document', 'sticker'];
                    const isMedia = mediaTypes.includes(msgType);
                    const savedMedia = isMedia ? await downloadAndSaveMedia(msg, sock) : null;

                    // Voice-to-text: if this is an incoming voice note and
                    // the agent has audioEnabled, transcribe via Whisper
                    // and store the transcript as the message content so
                    // the AI sees what was actually said. Falls through
                    // silently when no OpenAI key or transcription fails.
                    let finalContent = content;
                    if (!msg.key.fromMe && msgType === 'audio' && savedMedia) {
                        try {
                            const instMeta = await prisma.instance.findUnique({
                                where: { id: instanceId },
                                select: { workspaceId: true, agent: { select: { audioEnabled: true, whisperLanguage: true, whisperModel: true } } },
                            });
                            if (instMeta?.workspaceId && (instMeta as any)?.agent?.audioEnabled) {
                                const { transcribeAudioUrl } = await import('../agent/whisper.service');
                                const r = await transcribeAudioUrl({
                                    workspaceId: instMeta.workspaceId,
                                    mediaUrl: savedMedia.mediaUrl,
                                    mimetype: savedMedia.mediaMime,
                                    language: (instMeta as any).agent?.whisperLanguage || null,
                                    model: (instMeta as any).agent?.whisperModel || null,
                                });
                                if (r?.text) {
                                    // No prefix — the agent treats this as
                                    // ordinary user text. Whisper transcripts
                                    // are usually rough, but the model
                                    // handles minor typos fine and a visible
                                    // tag like "[Voice transcript]:" tends
                                    // to make some models ignore the line
                                    // as metadata.
                                    finalContent = r.text;
                                }
                            }
                        } catch (e: any) {
                            logger.warn({ err: e?.message }, '[whisper] transcription failed');
                        }
                    }

                    if (msg.key.fromMe) {
                        await prisma.message.create({
                            data: {
                                instanceId,
                                remoteJid,
                                isFromMe: true,
                                messageType: msgType,
                                content,
                                timestamp: ts,
                                waMsgId: msg.key?.id || null,
                                status: 'SENT',
                                ...(savedMedia ? { mediaUrl: savedMedia.mediaUrl, mediaMime: savedMedia.mediaMime, mediaName: savedMedia.mediaName } : {}),
                            },
                        }).catch(() => {});
                        io.emit(`message.new-${instanceId}`, {
                            id: msg.key.id,
                            isFromMe: true,
                            content,
                            remoteJid,
                            status: 'SENT',
                            timestamp: ts.toISOString(),
                            ...(savedMedia ? { mediaUrl: savedMedia.mediaUrl, mediaMime: savedMedia.mediaMime, mediaName: savedMedia.mediaName } : {}),
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
                            content: finalContent,
                            timestamp: ts,
                            waMsgId: msg.key?.id || null,
                            ...(savedMedia ? { mediaUrl: savedMedia.mediaUrl, mediaMime: savedMedia.mediaMime, mediaName: savedMedia.mediaName } : {}),
                        },
                    });

                    // Auto-add the sender to CRM with channel info
                    prisma.instance.findUnique({
                        where: { id: instanceId },
                        select: { userId: true, name: true, workspaceId: true },
                    }).then(async (inst: any) => {
                        if (!inst) return;
                        const wsId = inst.workspaceId
                            || (await (await import('../../lib/workspace-migration')).getOrCreatePersonalWorkspace(inst.userId));
                        const c = await upsertCrmContact({
                            userId: inst.userId,
                            workspaceId: wsId,
                            phone: resolvedPhone,
                            name: msg.pushName || null,
                            channel: 'whatsapp',
                            sourceLabel: inst.name,
                            isAnonymous,
                        });
                        if (c) maybeRefreshProfilePicAsync({ instanceId, clientId: c.id, jid: remoteJid, profilePicUpdatedAt: c.profilePicUpdatedAt });
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
                        ...(savedMedia ? { mediaUrl: savedMedia.mediaUrl, mediaMime: savedMedia.mediaMime, mediaName: savedMedia.mediaName } : {}),
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

            // Delivery / read receipts. Baileys fires messages.update
            // with an `update.status` integer when WhatsApp acks an
            // outgoing message (sent → delivered → read). We persist
            // it on the matching Message row by waMsgId and emit a
            // realtime message.status event so the inbox can swap the
            // tick icon without a refresh.
            sock.ev.on('messages.update', async (updates: any[]) => {
                for (const u of updates) {
                    const waId = u?.key?.id;
                    // Poll vote ingest. Baileys delivers vote updates
                    // here with `pollUpdates`. We look up the original
                    // poll row (pollPayload column) so
                    // getAggregateVotesInPollMessage can decrypt the
                    // customer's choice, then write the picked option
                    // name as a normal inbound Message so the agent
                    // reacts to "Vətəndaşlıq" instead of a generic
                    // "vote received" placeholder.
                    const pollUpdates = u?.pollUpdates;
                    if (pollUpdates && Array.isArray(pollUpdates) && pollUpdates.length > 0) {
                        const jid = u.key?.remoteJid;
                        if (jid) {
                            try {
                                // Find the original poll. waId is the vote's
                                // own ID; the related poll lives in
                                // pollUpdates[0].pollUpdateMessageKey.id.
                                const pollMsgId = pollUpdates[0]?.pollUpdateMessageKey?.id || waId;
                                const original = await prisma.message.findFirst({
                                    where: { instanceId, waMsgId: pollMsgId, messageType: 'poll' },
                                    select: { remoteJid: true, pollPayload: true },
                                });
                                if (!original?.pollPayload) {
                                    logger.warn({ pollMsgId }, '[poll] vote arrived but original poll not stored');
                                    continue;
                                }
                                const votes = getAggregateVotesInPollMessage({
                                    message: original.pollPayload as any,
                                    pollUpdates,
                                } as any);
                                const picked: string[] = (votes || [])
                                    .filter((v: any) => Array.isArray(v.voters) && v.voters.length > 0)
                                    .map((v: any) => String(v.name || '').trim())
                                    .filter(Boolean);
                                if (picked.length === 0) {
                                    logger.info({ pollMsgId }, '[poll] vote could not be decoded, skipping');
                                    continue;
                                }
                                const { effectiveJid: rJid } = await resolveJid(instanceId, original.remoteJid, { key: { remoteJid: original.remoteJid, fromMe: false } } as any);
                                await prisma.message.create({
                                    data: {
                                        instanceId, remoteJid: rJid,
                                        isFromMe: false, messageType: 'poll_vote',
                                        content: picked.join(', '),
                                        timestamp: new Date(),
                                        waMsgId: waId || null,
                                    },
                                }).catch(() => {});
                                logger.info({ instanceId, remoteJid: rJid, picked }, '[poll] vote decoded');
                                AiService.handleIncomingMessage(instanceId, rJid, sock, io).catch(() => {});
                            } catch (e: any) {
                                logger.warn({ err: e?.message }, '[poll] vote ingest failed');
                            }
                        }
                        continue;
                    }
                    const statusCode = u?.update?.status;
                    if (!waId || typeof statusCode !== 'number') continue;
                    // Baileys numeric status: 1 PENDING, 2 SENT (server ack),
                    // 3 DELIVERED, 4 READ, 5 PLAYED.
                    const status = statusCode >= 4 ? 'READ'
                                 : statusCode === 3 ? 'DELIVERED'
                                 : statusCode === 2 ? 'SENT'
                                 : 'PENDING';
                    try {
                        const updated = await prisma.message.updateMany({
                            where: { instanceId, waMsgId: waId },
                            data: { status },
                        });
                        if (updated.count > 0) {
                            io.emit(`message.status-${instanceId}`, {
                                waMsgId: waId, status, remoteJid: u?.key?.remoteJid || null,
                            });
                        }
                    } catch (e: any) {
                        logger.warn({ err: e.message, waId }, '[receipts] update failed');
                    }
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

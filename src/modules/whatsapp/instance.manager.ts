import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    WASocket,
    isJidGroup,
    getAggregateVotesInPollMessage,
    decryptPollVote,
} from '@whiskeysockets/baileys';
import { createHash } from 'crypto';
import { Boom } from '@hapi/boom';
import { logger } from '../../utils/logger';
import { prisma } from '../../lib/prisma';
import { io } from '../../server';
import qrcode from 'qrcode';
import { webhookQueue } from '../webhook/webhook.dispatcher';
import { AiService } from '../agent/ai.service';
import { upsertCrmContact } from '../client/client.service';
import { extractMessageContent } from './message-content';
import { extractAdReferrer } from '../ads/ad-referrer';
import { resolveJid } from './lid-resolver';
import { findOperatorByPhone, handleOperatorMessage } from '../operator/operator.service';
import { downloadAndSaveMedia } from './media-downloader';
import { maybeRefreshProfilePicAsync } from './profile-pic';
// We will replace useMultiFileAuthState with DB-backed later, using this for basic structure first.
// import { usePrismaAuthState } from './auth-state'; 

export const sessions = new Map<string, WASocket>();

import { setInstanceWorkspace, forgetInstanceWorkspace, emitToWorkspaceSync } from '../../lib/socket-rooms';

// Latest QR per instance kept in memory for the REST poll endpoint.
// Baileys refreshes QR ~every 20s; anything older than QR_TTL_MS is
// treated as stale (returned as null so the poller waits for a fresh one).
// Cleared when the socket transitions to `open`.
const QR_TTL_MS = 20_000;
export const qrCodes = new Map<string, { qr: string; at: number }>();

export function getLatestQr(instanceId: string): { qr: string; expiresAt: Date } | null {
    const entry = qrCodes.get(instanceId);
    if (!entry) return null;
    if (Date.now() - entry.at > QR_TTL_MS) {
        qrCodes.delete(instanceId);
        return null;
    }
    return { qr: entry.qr, expiresAt: new Date(entry.at + QR_TTL_MS) };
}

// Fire an `instance.status` webhook so headless integrations (external
// CRMs, dashboards) learn about connection flips without polling.
async function dispatchInstanceStatus(instanceId: string, status: 'CONNECTED' | 'DISCONNECTED') {
    try {
        const inst = await prisma.instance.findUnique({
            where: { id: instanceId },
            select: { name: true },
        });
        const sock = sessions.get(instanceId) as any;
        const rawId = String(sock?.user?.id || '');
        const phone = rawId ? rawId.split(':')[0].split('@')[0] : null;
        webhookQueue.add('instance-status', {
            instanceId,
            event: 'instance.status',
            payload: {
                status,
                phone: phone || null,
                name: inst?.name || null,
            },
        }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
    } catch (e: any) {
        logger.warn({ err: e?.message, instanceId }, '[instance.status] dispatch failed');
    }
}


// JSON.stringify turns a Buffer into { type: 'Buffer', data: [..] }, and
// JSON.parse restores it as that same plain object — not a Buffer. The
// Baileys poll-vote helpers (getAggregateVotesInPollMessage,
// decryptPollVote, …) rely on real Node Buffers for the poll's encKey
// and the messageSecret, so any saved pollPayload has to be walked and
// the placeholder shapes promoted back into Buffers before use.
function reviveBuffers(input: any): any {
    if (input === null || input === undefined) return input;
    if (Buffer.isBuffer(input)) return input;
    // Uint8Array (and any other TypedArray) must be promoted to Buffer
    // BEFORE the generic-object branch — otherwise the recursive copy
    // walks the numeric indices and produces a plain {0:..,1:..} object
    // that fails the createCipheriv iv/key type checks downstream.
    if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    if (typeof input !== 'object') return input;
    if (input.type === 'Buffer' && Array.isArray(input.data)) return Buffer.from(input.data);
    if (Array.isArray(input)) return input.map(reviveBuffers);
    const out: Record<string, any> = {};
    for (const k of Object.keys(input)) out[k] = reviveBuffers(input[k]);
    return out;
}

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

            // Seed the workspace cache so hot broadcast paths (message.new,
            // poll updates, receipts) can pick the right Socket.IO room
            // without hitting the DB.
            setInstanceWorkspace(instanceId, instanceDb.workspaceId || null);

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
                        if (!row?.pollPayload) return undefined;
                        return reviveBuffers(row.pollPayload as any);
                    } catch { return undefined; }
                },
            });

            // ─── LID addressing shim ─────────────────────────────────
            // Baileys encodes the send target purely from the JID you
            // pass (`isLid ? 'lid' : 's.whatsapp.net'` in messages-send)
            // — it never translates a phone JID into a LID. Once a
            // conversation is LID-addressed (standard whenever either
            // side is a WhatsApp Business App account), sending to
            // `<phone>@s.whatsapp.net` builds no Signal session: the
            // call resolves, the UI ticks, and the message silently
            // dies with no server ack.
            //
            // We store conversations under the phone JID on purpose
            // (see lid-resolver) so the CRM has one stable key per
            // contact. Rather than teach a dozen callsites the
            // difference, translate once here — every consumer
            // (inbox, agent replies, automations, campaigns, operator
            // handoff) gets correct addressing for free.
            const rawSendMessage = sock.sendMessage.bind(sock);
            (sock as any).sendMessage = async (jid: string, content: any, options?: any) => {
                let target = jid;
                let how = 'as-given';
                // Groups, broadcasts and explicit LIDs are already right.
                if (typeof jid === 'string' && jid.endsWith('@s.whatsapp.net')) {
                    try {
                        // getLIDForPN checks its in-memory cache, then the
                        // auth key store, then falls back to a USync query
                        // against the server — so this resolves even for
                        // contacts we've never received a message from.
                        const lid = await (sock as any)?.signalRepository?.lidMapping?.getLIDForPN?.(jid);
                        if (lid) {
                            target = lid;
                            how = 'pn→lid';
                        } else {
                            how = 'pn-no-mapping';
                        }
                    } catch (err: any) {
                        how = `pn-lookup-threw(${err.message})`;
                    }
                }
                const result = await rawSendMessage(target, content, options);
                // Everything on ONE line — pino-pretty prints structured
                // fields on following lines, which `grep` filters out, and
                // this is the line operators will be grepping during a
                // "message didn't arrive" investigation.
                logger.info(
                    `[wa-send] ${instanceId} requested=${jid} sentTo=${target} how=${how} waMsgId=${(result as any)?.key?.id || 'NONE'}`
                );
                return result;
            };

            sessions.set(instanceId, sock);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    try {
                        const qrDataUrl = await qrcode.toDataURL(qr);
                        // Cache the QR so the REST /qr endpoint can serve it
                        // to headless integrations (e.g. an external CRM
                        // that can't consume Socket.IO).
                        qrCodes.set(instanceId, { qr: qrDataUrl, at: Date.now() });
                        emitToWorkspaceSync(instanceId, `qr-${instanceId}`, qrDataUrl);
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
                        // instance.status webhook — lets the CRM show a
                        // "phone offline" banner without polling.
                        dispatchInstanceStatus(instanceId, 'DISCONNECTED').catch(() => {});
                        setTimeout(() => this.startInstance(instanceId), 3000);
                    } else {
                        logger.info(`Connection logged out for ${instanceId}`);
                        sessions.delete(instanceId);
                        qrCodes.delete(instanceId);
                        await prisma.instance.update({
                            where: { id: instanceId },
                            data: { status: 'DISCONNECTED' }
                        });
                        dispatchInstanceStatus(instanceId, 'DISCONNECTED').catch(() => {});
                        // Cleanup DB keys if needed
                    }
                } else if (connection === 'open') {
                    logger.info(`Connected instance: ${instanceId}`);
                    // QR is worthless the moment the session opens.
                    qrCodes.delete(instanceId);
                    await prisma.instance.update({
                        where: { id: instanceId },
                        data: { status: 'CONNECTED' }
                    });

                    emitToWorkspaceSync(instanceId, `status-${instanceId}`, 'CONNECTED');
                    dispatchInstanceStatus(instanceId, 'CONNECTED').catch(() => {});
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

                    // Poll-vote fallback path. WhatsApp delivers votes as a
                    // pollUpdateMessage on messages.upsert with encPayload
                    // (encrypted vote) — getAggregateVotesInPollMessage
                    // expects already-decrypted votes, so we manually
                    // decrypt with decryptPollVote first, then compare
                    // each selected option's SHA-256 against the original
                    // poll's options to figure out which name was picked.
                    const pollUpdate = (msg.message as any)?.pollUpdateMessage;
                    if (pollUpdate && !msg.key?.fromMe) {
                        if (process.env.POLL_DEBUG === 'true') {
                            try { logger.info(`[poll-debug] upsert vote ${JSON.stringify(msg)}`); } catch { /* ignore */ }
                        }
                        try {
                            const pollMsgId = pollUpdate?.pollCreationMessageKey?.id;
                            if (!pollMsgId) { logger.warn('[poll] vote upsert missing pollCreationMessageKey'); continue; }
                            const original = await prisma.message.findFirst({
                                where: { instanceId, waMsgId: pollMsgId, messageType: 'poll' },
                                select: { remoteJid: true, pollPayload: true },
                            });
                            if (!original?.pollPayload) {
                                logger.warn({ pollMsgId }, '[poll] upsert vote: original poll not stored');
                                continue;
                            }
                            const revived = reviveBuffers(original.pollPayload);
                            // Protobufjs's default JSON serializer encodes
                            // `bytes` fields as base64 strings, so anything
                            // we stored via JSON.parse(JSON.stringify(...))
                            // comes back as a string — Buffer.from(str)
                            // would treat it as UTF-8 and we'd hand AES-GCM
                            // 44 ASCII bytes instead of the real 32-byte
                            // key. Decode explicitly.
                            const toBuf = (v: any): Buffer | null => {
                                if (!v) return null;
                                if (Buffer.isBuffer(v)) return v;
                                if (v instanceof Uint8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
                                if (typeof v === 'string') return Buffer.from(v, 'base64');
                                if (v.type === 'Buffer' && Array.isArray(v.data)) return Buffer.from(v.data);
                                return null;
                            };
                            const pollEncKey: Buffer | null = toBuf(
                                revived?.pollCreationMessage?.encKey
                                ?? revived?.messageContextInfo?.messageSecret
                                ?? revived?.pollCreationMessageV3?.encKey,
                            );
                            const options: Array<{ optionName: string }> =
                                revived?.pollCreationMessage?.options
                                || revived?.pollCreationMessageV3?.options
                                || [];
                            if (!pollEncKey || pollEncKey.length !== 32 || options.length === 0) {
                                logger.warn({ pollMsgId, encKeyLen: pollEncKey?.length, optionsCount: options.length }, '[poll] upsert: missing or wrong-size encKey / options');
                                continue;
                            }
                            // WhatsApp keys the poll-vote AES-GCM AAD on the
                            // creator and voter JIDs in the same format the
                            // server saw them — for LID-mode chats both ends
                            // are @lid, for legacy PN chats both are
                            // @s.whatsapp.net. We don't know which up front,
                            // so we try the plausible combos until the GCM
                            // auth tag verifies.
                            const stripDevice = (jid: string) => {
                                // "79809809423:5@s.whatsapp.net" -> "79809809423@s.whatsapp.net"
                                // "231610725195937:5@lid"        -> "231610725195937@lid"
                                const m = jid.match(/^([^:@]+)(?::\d+)?@(.+)$/);
                                return m ? `${m[1]}@${m[2]}` : jid;
                            };
                            const ownIdRaw = String((sock as any)?.user?.id || '');
                            const ownLidRaw = String((sock as any)?.user?.lid || '');
                            const ownPhoneNorm = ownIdRaw ? stripDevice(ownIdRaw.includes('@') ? ownIdRaw : `${ownIdRaw}@s.whatsapp.net`) : '';
                            const ownLidNorm = ownLidRaw ? stripDevice(ownLidRaw.includes('@') ? ownLidRaw : `${ownLidRaw}@lid`) : '';
                            const voterPn = (msg.key?.remoteJidAlt || '').includes('@s.whatsapp.net')
                                ? msg.key!.remoteJidAlt!
                                : (msg.key?.remoteJid || '').replace('@lid', '@s.whatsapp.net');
                            const voterLid = (msg.key?.remoteJid || '').includes('@lid')
                                ? msg.key!.remoteJid!
                                : '';
                            const voteRaw = reviveBuffers(pollUpdate.vote);
                            const attempts: Array<{ pollCreatorJid: string; voterJid: string; label: string }> = [];
                            // LID combo first (poll was sent in @lid conversation, so this is the most likely match)
                            if (ownLidNorm && voterLid) attempts.push({ pollCreatorJid: ownLidNorm, voterJid: voterLid, label: 'lid/lid' });
                            // PN combo (legacy)
                            if (ownPhoneNorm && voterPn) attempts.push({ pollCreatorJid: ownPhoneNorm, voterJid: voterPn, label: 'pn/pn' });
                            // Cross combos as last resort
                            if (ownPhoneNorm && voterLid) attempts.push({ pollCreatorJid: ownPhoneNorm, voterJid: voterLid, label: 'pn/lid' });
                            if (ownLidNorm && voterPn) attempts.push({ pollCreatorJid: ownLidNorm, voterJid: voterPn, label: 'lid/pn' });
                            if (process.env.POLL_DEBUG === 'true') {
                                logger.info({
                                    ownPhoneNorm, ownLidNorm, voterPn, voterLid,
                                    encKeyLen: (pollEncKey as Buffer)?.length,
                                    attempts: attempts.map(a => a.label),
                                }, '[poll-debug] decrypt attempt setup');
                            }
                            let decoded: any = null;
                            let usedLabel = '';
                            let lastErr: string = '';
                            for (const a of attempts) {
                                try {
                                    decoded = decryptPollVote(
                                        { encPayload: voteRaw.encPayload, encIv: voteRaw.encIv },
                                        { pollCreatorJid: a.pollCreatorJid, pollMsgId, pollEncKey, voterJid: a.voterJid } as any,
                                    );
                                    if (decoded?.selectedOptions?.length) { usedLabel = a.label; break; }
                                } catch (e: any) {
                                    lastErr = e?.message || String(e);
                                    decoded = null;
                                }
                            }
                            if (!decoded) {
                                logger.warn({ pollMsgId, lastErr }, '[poll] upsert vote: all JID combos failed to decrypt');
                                continue;
                            }
                            if (process.env.POLL_DEBUG === 'true') {
                                logger.info({ pollMsgId, usedLabel }, '[poll-debug] decrypt succeeded');
                            }
                            const selected: Buffer[] = (decoded?.selectedOptions || []).map((b: any) => Buffer.from(b));
                            const optionHashes = options.map(o => ({
                                name: String(o.optionName || ''),
                                hash: createHash('sha256').update(String(o.optionName || '')).digest(),
                            }));
                            const picked: string[] = [];
                            for (const sel of selected) {
                                const m2 = optionHashes.find(o => Buffer.compare(sel, o.hash) === 0);
                                if (m2) picked.push(m2.name);
                            }
                            if (picked.length === 0) {
                                logger.info({ pollMsgId, decodedCount: selected.length }, '[poll] upsert vote decrypted but no option hash matched');
                                continue;
                            }
                            const { effectiveJid: rJid } = await resolveJid(instanceId, original.remoteJid, { key: { remoteJid: original.remoteJid, fromMe: false } } as any);
                            await prisma.message.create({
                                data: {
                                    instanceId, remoteJid: rJid,
                                    isFromMe: false, messageType: 'poll_vote',
                                    content: picked.join(', '),
                                    timestamp: new Date(),
                                    waMsgId: msg.key?.id || null,
                                    // Link to the original poll so the
                                    // inbox can render the vote as a
                                    // tally underneath instead of as a
                                    // standalone bubble.
                                    inReplyToWaMsgId: pollMsgId,
                                },
                            }).catch(() => {});
                            logger.info({ instanceId, remoteJid: rJid, picked }, '[poll] upsert vote decoded');

                            // Recompute aggregated tallies and push them
                            // to the open chat so the poll card animates
                            // without a refresh.
                            try {
                                const allVotes = await prisma.message.findMany({
                                    where: { instanceId, messageType: 'poll_vote', inReplyToWaMsgId: pollMsgId },
                                    select: { content: true },
                                });
                                const tally = new Map<string, number>();
                                for (const v of allVotes) {
                                    for (const name of String(v.content || '').split(',').map(s => s.trim()).filter(Boolean)) {
                                        tally.set(name, (tally.get(name) || 0) + 1);
                                    }
                                }
                                const optionNames = options.map(o => String(o.optionName || ''));
                                const pollOptions = optionNames.map(name => ({ name, votes: tally.get(name) || 0 }));
                                emitToWorkspaceSync(instanceId, `poll.update-${instanceId}`, {
                                    remoteJid: rJid,
                                    pollWaMsgId: pollMsgId,
                                    pollOptions,
                                });
                            } catch (err: any) {
                                logger.warn({ err: err?.message }, '[poll] tally emit failed');
                            }

                            AiService.handleIncomingMessage(instanceId, rJid, sock, io).catch(() => {});
                        } catch (e: any) {
                            logger.warn({ err: e?.message }, '[poll] upsert vote ingest failed');
                        }
                        continue;
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
                        emitToWorkspaceSync(instanceId, `message.new-${instanceId}`, {
                            id: msg.key.id,
                            isFromMe: true,
                            content,
                            remoteJid,
                            status: 'SENT',
                            timestamp: ts.toISOString(),
                            ...(savedMedia ? { mediaUrl: savedMedia.mediaUrl, mediaMime: savedMedia.mediaMime, mediaName: savedMedia.mediaName } : {}),
                        });
                        // Outbound messages also go over the webhook so
                        // external CRMs stay in sync when their operators
                        // reply from the bot's own inbox.
                        const outFromMeUrl = savedMedia?.mediaUrl
                            ? (savedMedia.mediaUrl.startsWith('http')
                                ? savedMedia.mediaUrl
                                : `${(process.env.FRONTEND_URL || 'https://chatbot.tural.ai').replace(/\/$/, '')}${savedMedia.mediaUrl.startsWith('/') ? '' : '/'}${savedMedia.mediaUrl}`)
                            : null;
                        webhookQueue.add('new-message', {
                            instanceId,
                            event: 'message.new',
                            payload: {
                                waMsgId: msg.key?.id || null,
                                remoteJid,
                                phone: (remoteJid.split(':')[0].split('@')[0] || '').replace(/\D/g, '') || null,
                                pushName: null,
                                isFromMe: true,
                                type: msgType,
                                text: content || null,
                                mediaUrl: outFromMeUrl,
                                mediaMime: savedMedia?.mediaMime || null,
                                mediaName: savedMedia?.mediaName || null,
                                timestamp: ts.toISOString(),
                                raw: msg,
                            },
                        }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
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

                    // Click-to-WhatsApp ad metadata, if any. Saved on
                    // the Message row so the ads page can show every
                    // arrival per ad, and forwarded into the CRM upsert
                    // so the Client gets its first-touch attribution +
                    // the AdRoute rules a chance to claim the contact
                    // before the AI is even called.
                    const adRef = extractAdReferrer(msg);

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
                            ...(adRef ? { adReferrer: adRef as any } : {}),
                        },
                    });

                    // Auto-add the sender to CRM with channel info. Ad
                    // routing runs SYNCHRONOUSLY here (awaited) so that
                    // if a rule matches, Client.assignedAgentId is set
                    // before handleIncomingMessage reads the client row
                    // a few lines down — otherwise the AI dispatch
                    // would race the route lookup and the rule's first
                    // hit wouldn't take effect.
                    try {
                        const inst = await prisma.instance.findUnique({
                            where: { id: instanceId },
                            select: { userId: true, name: true, workspaceId: true },
                        });
                        if (inst) {
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
                                adReferrer: adRef,
                            });
                            if (c) maybeRefreshProfilePicAsync({ instanceId, clientId: c.id, jid: remoteJid, profilePicUpdatedAt: c.profilePicUpdatedAt });
                        }
                    } catch { /* never block message handling on CRM upsert */ }

                    // Normalised webhook payload. External integrations
                    // (PHP CRM, no-code tools) get a flat, easy-to-parse
                    // shape; the original Baileys `msg` is preserved in
                    // `raw` for anyone who needs the deep tree.
                    const normalisedMediaUrl = savedMedia?.mediaUrl
                        ? (savedMedia.mediaUrl.startsWith('http')
                            ? savedMedia.mediaUrl
                            : `${(process.env.FRONTEND_URL || 'https://chatbot.tural.ai').replace(/\/$/, '')}${savedMedia.mediaUrl.startsWith('/') ? '' : '/'}${savedMedia.mediaUrl}`)
                        : null;
                    webhookQueue.add('new-message', {
                        instanceId,
                        event: 'message.new',
                        payload: {
                            waMsgId: msg.key?.id || null,
                            remoteJid,
                            phone: resolvedPhone,
                            pushName: msg.pushName || null,
                            isFromMe: false,
                            type: msgType,
                            text: finalContent || content || null,
                            mediaUrl: normalisedMediaUrl,
                            mediaMime: savedMedia?.mediaMime || null,
                            mediaName: savedMedia?.mediaName || null,
                            timestamp: ts.toISOString(),
                            raw: msg,
                        },
                    }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });

                    emitToWorkspaceSync(instanceId, `message.new-${instanceId}`, {
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
                    // Diagnostic: dump every messages.update we see so
                    // we can confirm vote events land here at all. Set
                    // POLL_DEBUG=true in env to enable.
                    if (process.env.POLL_DEBUG === 'true') {
                        try {
                            logger.info({ instanceId, u: JSON.parse(JSON.stringify(u)) }, '[poll-debug] update');
                        } catch { /* ignore */ }
                    }

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
                                const revived = reviveBuffers(original.pollPayload);
                                const revivedUpdates = reviveBuffers(pollUpdates);
                                const votes = getAggregateVotesInPollMessage({
                                    message: revived,
                                    pollUpdates: revivedUpdates,
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
                            emitToWorkspaceSync(instanceId, `message.status-${instanceId}`, {
                                waMsgId: waId, status, remoteJid: u?.key?.remoteJid || null,
                            });
                            // message.status webhook for headless
                            // integrations that render delivery ticks
                            // outside the bot's own inbox.
                            webhookQueue.add('message-status', {
                                instanceId,
                                event: 'message.status',
                                payload: {
                                    waMsgId: waId,
                                    status,
                                    remoteJid: u?.key?.remoteJid || null,
                                },
                            }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
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
            qrCodes.delete(instanceId);
            forgetInstanceWorkspace(instanceId);
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

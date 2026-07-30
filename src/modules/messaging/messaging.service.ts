import { sessions } from '../whatsapp/instance.manager';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

// Resolve the outbound recipient's JID.
//
// Baileys does NOT translate a phone JID into a LID on send — see
// Socket/messages-send.js, which encodes the target with
// `isLid ? 'lid' : 's.whatsapp.net'` based purely on the JID you hand
// it. When the conversation is LID-addressed (the norm once either side
// is a WhatsApp Business App account), addressing the classic
// `<phone>@s.whatsapp.net` form builds no Signal session: sendMessage()
// still resolves, the UI shows a tick, and the message never leaves the
// socket. No ack ever arrives. That is the "gedir kimi görsənir, amma
// getmir" bug.
//
// Order of preference:
//   1. Group JIDs and already-LID JIDs pass through untouched.
//   2. Baileys' own LID mapping store (populated from every inbound
//      message and every usync device fetch) — authoritative.
//   3. onWhatsApp() — also confirms the number exists at all.
//   4. Synthetic phone JID — last resort, previous behaviour.
export async function resolveWhatsAppJid(sock: any, to: string): Promise<string> {
    // Groups and explicit LIDs are already correct.
    if (to.endsWith('@g.us') || to.endsWith('@lid')) return to;

    const digits = String(to).replace(/[^0-9]/g, '');
    if (!digits) throw new Error(`Invalid phone number: "${to}"`);
    const pnJid = `${digits}@s.whatsapp.net`;

    // 1. Ask Baileys whether this contact is LID-addressed. The store is
    //    filled in as messages and device lists flow through, so for any
    //    contact we've ever talked to this hits immediately.
    try {
        const lid = await sock?.signalRepository?.lidMapping?.getLIDForPN?.(pnJid);
        if (lid) {
            logger.debug({ to: pnJid, lid }, '[messaging] addressing via LID');
            return lid;
        }
    } catch (err: any) {
        logger.warn({ err: err.message, to: pnJid }, '[messaging] LID lookup failed');
    }

    // 2. onWhatsApp both validates the number and returns whichever JID
    //    form the server considers canonical for it.
    try {
        const results = await sock.onWhatsApp(digits);
        const hit = Array.isArray(results) ? results.find((r: any) => r?.exists) : null;
        if (hit?.lid) return hit.lid;
        if (hit?.jid) return hit.jid;
        if (Array.isArray(results) && results.length > 0 && !hit) {
            throw new Error(`${digits} is not registered on WhatsApp`);
        }
    } catch (err: any) {
        // A genuine "not registered" verdict should surface to the caller.
        if (/not registered on WhatsApp/.test(err.message)) throw err;
        logger.warn({ err: err.message, to }, '[messaging] onWhatsApp lookup failed — falling back to phone JID');
    }

    return pnJid;
}

export class MessagingService {
    async sendText(instanceId: string, to: string, text: string) {
        const sock = sessions.get(instanceId);
        if (!sock) {
            throw new Error(`Instance ${instanceId} is not connected`);
        }

        const jid = await resolveWhatsAppJid(sock, to);

        try {
            const message = await sock.sendMessage(jid, { text });
            if (!message) throw new Error('WhatsApp accepted the request but returned no message id — likely a Business-account restriction. Try opening the chat on the phone once, then retry.');

            // Log to DB. PENDING + waMsgId so the ack handler and the
            // delivery watchdog can prove whether it actually landed.
            if (message) {
                await prisma.message.create({
                    data: {
                        instanceId,
                        remoteJid: jid,
                        isFromMe: true,
                        messageType: 'text',
                        content: text,
                        waMsgId: message?.key?.id || null,
                        status: 'PENDING',
                        timestamp: new Date()
                    }
                });
                const { watchDelivery } = await import('../whatsapp/delivery-watchdog');
                watchDelivery({ instanceId, waMsgId: message?.key?.id, remoteJid: jid, context: 'api' });
            }

            return message;
        } catch (error: any) {
            logger.error({ err: error }, `Failed to send message from ${instanceId} to ${to}`);
            throw new Error(`Failed to send message: ${error.message}`);
        }
    }

    async sendMedia(instanceId: string, to: string, mediaType: 'image' | 'video' | 'document' | 'audio', url: string, caption?: string, fileName?: string, mimetype?: string) {
        const sock = sessions.get(instanceId);
        if (!sock) {
            throw new Error(`Instance ${instanceId} is not connected`);
        }

        const jid = await resolveWhatsAppJid(sock, to);

        try {
            let mediaMessage: any = {};
            if (mediaType === 'image') {
                mediaMessage = { image: { url }, caption };
            } else if (mediaType === 'video') {
                mediaMessage = { video: { url }, caption };
            } else if (mediaType === 'document') {
                mediaMessage = { document: { url }, fileName: fileName || 'file', mimetype: mimetype || 'application/octet-stream', caption };
            } else if (mediaType === 'audio') {
                mediaMessage = { audio: { url }, mimetype: mimetype || 'audio/mp4', ptt: false }; // ptt: true for voice notes
            }

            const message = await sock.sendMessage(jid, mediaMessage);

            // Log to DB — same PENDING + watchdog treatment as text.
            if (message) {
                await prisma.message.create({
                    data: {
                        instanceId,
                        remoteJid: jid,
                        isFromMe: true,
                        messageType: mediaType,
                        content: url + (caption ? `\nCaption: ${caption}` : ''),
                        waMsgId: message?.key?.id || null,
                        status: 'PENDING',
                        timestamp: new Date()
                    }
                });
                const { watchDelivery } = await import('../whatsapp/delivery-watchdog');
                watchDelivery({ instanceId, waMsgId: message?.key?.id, remoteJid: jid, context: 'api-media' });
            }

            return message;
        } catch (error: any) {
            logger.error({ err: error }, `Failed to send media from ${instanceId} to ${to}`);
            throw new Error(`Failed to send media: ${error.message}`);
        }
    }
}

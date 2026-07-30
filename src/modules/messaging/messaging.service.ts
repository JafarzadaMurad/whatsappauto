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

    // 1. Existence check FIRST. A stale or bogus LID mapping will happily
    //    resolve and we'll address a device that isn't there — the send
    //    then dies with no ack and no error. onWhatsApp is authoritative
    //    and cheap, so ask before trusting any cached mapping.
    try {
        const results = await sock.onWhatsApp(digits);
        if (Array.isArray(results) && results.length > 0) {
            const hit = results.find((r: any) => r?.exists);
            if (!hit) {
                throw new Error(
                    `${digits} is not registered on WhatsApp. Check the number — ` +
                    `it must include the country code and no leading zero.`
                );
            }
        }
    } catch (err: any) {
        if (/not registered on WhatsApp/.test(err.message)) throw err;
        logger.warn({ err: err.message, to }, '[messaging] onWhatsApp check failed — continuing');
    }

    // 2. Prefer the LID when the conversation is LID-addressed. The store
    //    checks its cache, then the auth key store, then queries the
    //    server via USync — so it resolves for contacts we've never
    //    exchanged messages with too.
    try {
        const lid = await sock?.signalRepository?.lidMapping?.getLIDForPN?.(pnJid);
        if (lid) return lid;
    } catch (err: any) {
        logger.warn({ err: err.message, to: pnJid }, '[messaging] LID lookup failed');
    }

    return pnJid;
}

// Diagnostic for "why didn't my message arrive?". Reports whether the
// number is on WhatsApp at all, which JID form we'd address, and what
// the LID mapping store knows. Exposed via
// GET /instances/:id/check-number?phone=… so support can answer the
// question without shell access.
export async function inspectWhatsAppNumber(sock: any, phone: string) {
    const digits = String(phone).replace(/[^0-9]/g, '');
    const pnJid = `${digits}@s.whatsapp.net`;
    const out: Record<string, any> = { input: phone, digits, pnJid };

    try {
        const results = await sock.onWhatsApp(digits);
        out.onWhatsApp = results ?? null;
        out.registered = Array.isArray(results) && results.some((r: any) => r?.exists);
    } catch (err: any) {
        out.onWhatsAppError = err.message;
        out.registered = null;
    }

    try {
        out.lid = await sock?.signalRepository?.lidMapping?.getLIDForPN?.(pnJid) ?? null;
    } catch (err: any) {
        out.lidError = err.message;
    }

    out.wouldSendTo = out.lid || pnJid;
    return out;
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

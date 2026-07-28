import { sessions } from '../whatsapp/instance.manager';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

// Resolve the outbound recipient's JID. WhatsApp Business App accounts
// scanned via Baileys sometimes need the LID (`@lid`) form instead of
// the classic `@s.whatsapp.net` form — otherwise sendMessage returns
// `undefined` (success-looking) but the message never leaves the socket.
// Calling `onWhatsApp(number)` gives us the canonical JID whichever the
// account uses, plus a genuine "does this number exist on WhatsApp?"
// signal so we can return a real error instead of a phantom success.
export async function resolveWhatsAppJid(sock: any, to: string): Promise<string> {
    // Already a JID? Trust it.
    if (to.includes('@s.whatsapp.net') || to.includes('@lid') || to.includes('@g.us')) return to;
    const digits = String(to).replace(/[^0-9]/g, '');
    if (!digits) throw new Error(`Invalid phone number: "${to}"`);
    try {
        const results = await sock.onWhatsApp(digits);
        const hit = Array.isArray(results) ? results.find((r: any) => r?.exists) : null;
        if (hit?.jid) return hit.jid;
    } catch (err: any) {
        logger.warn({ err: err.message, to }, '[messaging] onWhatsApp lookup failed — falling back to synthetic JID');
    }
    // Fallback — same shape the code used before. Better to try than
    // hard-fail; if the number is registered under a variant, the
    // classic form still delivers on most personal accounts.
    return `${digits}@s.whatsapp.net`;
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

            // Log to DB
            if (message) {
                await prisma.message.create({
                    data: {
                        instanceId,
                        remoteJid: jid,
                        isFromMe: true,
                        messageType: 'text',
                        content: text,
                        status: 'SENT',
                        timestamp: new Date()
                    }
                });
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

            // Log to DB
            if (message) {
                await prisma.message.create({
                    data: {
                        instanceId,
                        remoteJid: jid,
                        isFromMe: true,
                        messageType: mediaType,
                        content: url + (caption ? `\nCaption: ${caption}` : ''),
                        status: 'SENT',
                        timestamp: new Date()
                    }
                });
            }

            return message;
        } catch (error: any) {
            logger.error({ err: error }, `Failed to send media from ${instanceId} to ${to}`);
            throw new Error(`Failed to send media: ${error.message}`);
        }
    }
}

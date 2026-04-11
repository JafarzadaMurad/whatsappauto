import { sessions } from '../whatsapp/instance.manager';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

export class MessagingService {
    async sendText(instanceId: string, to: string, text: string) {
        const sock = sessions.get(instanceId);
        if (!sock) {
            throw new Error(`Instance ${instanceId} is not connected`);
        }

        const jid = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;

        try {
            const message = await sock.sendMessage(jid, { text });

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

        const jid = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;

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

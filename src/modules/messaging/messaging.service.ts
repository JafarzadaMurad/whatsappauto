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
}

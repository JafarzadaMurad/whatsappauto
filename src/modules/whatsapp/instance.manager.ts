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

            sock.ev.on('messages.upsert', async (m) => {
                if (m.type === 'notify') {
                    for (const msg of m.messages) {
                        const isStatus = msg.key.remoteJid === 'status@broadcast';
                        const remoteJid = msg.key.remoteJid;

                        if (!msg.key.fromMe && msg.message && !isStatus && remoteJid && !isJidGroup(remoteJid)) {
                            logger.info(`[${instanceId}] New message from ${remoteJid}`);
                            logger.debug({ event: 'message.new' }, `[${instanceId}] Adding message to webhook queue`);

                            const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '[Media/Unsupported]';

                            // Save incoming message to DB
                            await prisma.message.create({
                                data: {
                                    instanceId,
                                    remoteJid: remoteJid,
                                    isFromMe: false,
                                    messageType: msg.message?.conversation || msg.message?.extendedTextMessage ? 'text' : 'media',
                                    content: content,
                                    timestamp: new Date((msg.messageTimestamp as number) * 1000 || Date.now())
                                }
                            });

                            // Send to webhook queue
                            webhookQueue.add('new-message', {
                                instanceId,
                                event: 'message.new',
                                payload: msg
                            }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });

                            // Real-time chat interface emit
                            io.emit(`message.new-${instanceId}`, {
                                id: msg.key.id,
                                isFromMe: msg.key.fromMe,
                                content: content,
                                status: 'DELIVERED',
                                timestamp: new Date().toISOString()
                            });

                            // Trigger AI Agent Response (fire & forget)
                            AiService.handleIncomingMessage(instanceId, remoteJid, sock, io).catch(err => {
                                logger.error({ err, instanceId }, 'Error triggering AI service');
                            });
                        }
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

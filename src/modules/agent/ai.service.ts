import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, type ModelMessage } from 'ai';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { sessions } from '../whatsapp/instance.manager';
import { io } from '../../server';

export class AiService {
    static async handleIncomingMessage(instanceId: string, remoteJid: string) {
        try {
            // 1. Fetch Instance with Agent and API Keys
            const instance = await prisma.instance.findUnique({
                where: { id: instanceId },
                include: {
                    agent: {
                        include: {
                            provider: true
                        }
                    }
                }
            });

            if (!instance || !instance.agent || !instance.agent.provider) {
                return; // No AI agent configured for this instance
            }

            const agent = instance.agent;
            const providerInfo = agent.provider;

            // 2. Configure Vercel AI SDK Provider
            let aiModel: any;
            if (providerInfo.provider === 'OPENAI') {
                const openai = createOpenAI({ apiKey: providerInfo.apiKey });
                aiModel = openai(agent.model);
            } else if (providerInfo.provider === 'CLAUDE') {
                const anthropic = createAnthropic({ apiKey: providerInfo.apiKey });
                aiModel = anthropic(agent.model);
            } else if (providerInfo.provider === 'GEMINI') {
                const google = createGoogleGenerativeAI({ apiKey: providerInfo.apiKey });
                aiModel = google(agent.model);
            } else {
                logger.error(`Unknown AI Provider: ${providerInfo.provider}`);
                return;
            }

            // 3. Fetch Chat History (Last 15 messages)
            const history = await prisma.message.findMany({
                where: { instanceId, remoteJid },
                orderBy: { timestamp: 'desc' },
                take: 15
            });

            // Reverse to chronological order
            history.reverse();

            const coreMessages: ModelMessage[] = history.map(msg => ({
                role: msg.isFromMe ? 'assistant' : 'user',
                content: msg.content || '[Unsupported Media]'
            }));

            if (coreMessages.length === 0) return; // Nothing to reply to

            // 4. Generate AI Response
            const { text } = await generateText({
                model: aiModel,
                system: agent.systemPrompt || 'You are a helpful WhatsApp assistant.',
                messages: coreMessages,
            });

            if (!text) return;

            // 5. Send WhatsApp message and Save to DB
            const sock = sessions.get(instanceId);
            if (sock) {
                const sentMsg = await sock.sendMessage(remoteJid, { text });

                // Save AI reply to DB
                const saved = await prisma.message.create({
                    data: {
                        instanceId,
                        remoteJid,
                        isFromMe: true,
                        messageType: 'text',
                        content: text,
                        timestamp: new Date()
                    }
                });

                // Emit to frontend so chat UI updates in real-time
                io.emit(`message.new-${instanceId}`, {
                    id: sentMsg?.key?.id || saved.id,
                    isFromMe: true,
                    content: text,
                    status: 'DELIVERED',
                    timestamp: new Date().toISOString()
                });

                logger.info(`[${instanceId}] AI replied to ${remoteJid}`);
            }

        } catch (error) {
            logger.error({ err: error, instanceId, remoteJid }, 'Failed to generate AI response');
        }
    }
}

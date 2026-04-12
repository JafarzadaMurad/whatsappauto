import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import type { WASocket } from '@whiskeysockets/baileys';
import type { Server } from 'socket.io';

export class AiService {
    static async handleIncomingMessage(
        instanceId: string,
        remoteJid: string,
        sock: WASocket,
        io: Server
    ) {
        try {
            const instance = await prisma.instance.findUnique({
                where: { id: instanceId },
                include: {
                    agent: {
                        include: { provider: true }
                    }
                }
            });

            if (!instance?.agent?.provider) return;

            const agent = instance.agent;
            const providerInfo = agent.provider;

            // Configure AI model
            let aiModel: any;
            if (providerInfo.provider === 'OPENAI') {
                aiModel = createOpenAI({ apiKey: providerInfo.apiKey } as any).chat(agent.model);
            } else if (providerInfo.provider === 'CLAUDE') {
                aiModel = createAnthropic({ apiKey: providerInfo.apiKey })(agent.model);
            } else if (providerInfo.provider === 'GEMINI') {
                aiModel = createGoogleGenerativeAI({ apiKey: providerInfo.apiKey })(agent.model);
            } else {
                logger.error(`Unknown AI Provider: ${providerInfo.provider}`);
                return;
            }

            // Fetch data tables context if agent has access
            let dataContext = '';
            if (agent.allowedTableIds && agent.allowedTableIds.length > 0) {
                const tables = await prisma.customTable.findMany({
                    where: { id: { in: agent.allowedTableIds } },
                    include: { rows: { take: 50 } }
                });

                if (tables.length > 0) {
                    const tableTexts = tables.map(table => {
                        const columns = (table.columns as any[]).map((c: any) => c.name);
                        const header = columns.join(' | ');
                        const rowLines = table.rows.map(row => {
                            const data = row.data as Record<string, any>;
                            return columns.map(col => data[col] ?? '').join(' | ');
                        });
                        return `## ${table.name}\n${header}\n${rowLines.join('\n')}`;
                    });
                    dataContext = `\n\n---\nDATA TABLES:\n\n${tableTexts.join('\n\n')}`;
                }
            }

            // Fetch chat history
            const history = await prisma.message.findMany({
                where: { instanceId, remoteJid },
                orderBy: { timestamp: 'desc' },
                take: 15
            });
            history.reverse();

            const messages = history.map(msg => ({
                role: (msg.isFromMe ? 'assistant' : 'user') as 'assistant' | 'user',
                content: msg.content || '[Unsupported Media]'
            }));

            if (messages.length === 0) return;

            // Generate AI response
            const systemPrompt = (agent.systemPrompt || 'You are a helpful WhatsApp assistant.') + dataContext;

            const result = await generateText({
                model: aiModel,
                system: systemPrompt,
                messages,
            } as any);

            const text = result.text;
            if (!text) return;

            // Send and save
            const sentMsg = await sock.sendMessage(remoteJid, { text });

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

            io.emit(`message.new-${instanceId}`, {
                id: sentMsg?.key?.id || saved.id,
                isFromMe: true,
                content: text,
                status: 'DELIVERED',
                timestamp: new Date().toISOString()
            });

            logger.info(`[${instanceId}] AI replied to ${remoteJid}`);

        } catch (error) {
            logger.error({ err: error, instanceId, remoteJid }, 'Failed to generate AI response');
        }
    }
}

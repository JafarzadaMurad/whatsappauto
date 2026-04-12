import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, zodSchema, stepCountIs } from 'ai';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import type { WASocket } from '@whiskeysockets/baileys';
import type { Server } from 'socket.io';

function makeTool(description: string, schema: z.ZodObject<any>, execute: (params: any) => Promise<any>) {
    const wrapped = zodSchema(schema);
    return { description, parameters: wrapped, inputSchema: wrapped, execute };
}

function buildTableTools(allowedTableIds: string[]) {
    return {
        listTables: makeTool(
            'List all available data tables with their column structure. Call this first to understand what data you have access to.',
            z.object({ reason: z.string().describe('Brief reason for listing tables') }),
            async () => {
                const tables = await prisma.customTable.findMany({
                    where: { id: { in: allowedTableIds } },
                    select: { id: true, name: true, description: true, columns: true }
                });
                return tables.map((t: any) => ({
                    id: t.id,
                    name: t.name,
                    description: t.description,
                    columns: (t.columns as any[]).map((c: any) => ({ name: c.name, type: c.type }))
                }));
            }
        ),

        searchTable: makeTool(
            'Search for rows in a table where a column contains a specific value (case-insensitive partial match). Returns matching rows.',
            z.object({
                tableId: z.string().describe('The table ID from listTables'),
                column: z.string().describe('The column name to search in'),
                query: z.string().describe('The search term')
            }),
            async ({ tableId, column, query }) => {
                if (!allowedTableIds.includes(tableId)) {
                    return { error: 'Access denied to this table' };
                }
                const allRows = await prisma.customRow.findMany({
                    where: { tableId },
                    take: 50
                });
                const q = query.toLowerCase();
                const matched = allRows.filter(row => {
                    const data = row.data as Record<string, any>;
                    const val = data[column];
                    return val != null && String(val).toLowerCase().includes(q);
                });
                return { results: matched.map(r => r.data), count: matched.length };
            }
        ),

        getTableRows: makeTool(
            'Get rows from a table with pagination (max 10 per call). Use offset to paginate.',
            z.object({
                tableId: z.string().describe('The table ID from listTables'),
                limit: z.number().max(10).optional().default(10).describe('Max rows to return (max 10)'),
                offset: z.number().optional().default(0).describe('Number of rows to skip')
            }),
            async ({ tableId, limit = 10, offset = 0 }) => {
                if (!allowedTableIds.includes(tableId)) {
                    return { error: 'Access denied to this table' };
                }
                const safeLimit = Math.min(limit || 10, 10);
                const [rows, total] = await Promise.all([
                    prisma.customRow.findMany({
                        where: { tableId },
                        take: safeLimit,
                        skip: offset || 0,
                        orderBy: { createdAt: 'asc' }
                    }),
                    prisma.customRow.count({ where: { tableId } })
                ]);
                return {
                    rows: rows.map(r => r.data),
                    total,
                    hasMore: (offset || 0) + safeLimit < total
                };
            }
        )
    };
}

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

            // Build system prompt and tools
            const hasTableAccess = agent.allowedTableIds && agent.allowedTableIds.length > 0;

            let systemPrompt = agent.systemPrompt || 'You are a helpful WhatsApp assistant.';
            if (hasTableAccess) {
                systemPrompt += '\n\nYou have access to data tables via tools. Use listTables first to see available tables and their columns, then searchTable or getTableRows to look up data. Always use tools to find data — never guess.';
            }

            const tools = hasTableAccess ? buildTableTools(agent.allowedTableIds) : undefined;

            // Generate AI response with tool calling (up to 5 steps)
            const result = await generateText({
                model: aiModel,
                system: systemPrompt,
                messages,
                ...(tools ? { tools, stopWhen: stepCountIs(5) } : {}),
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

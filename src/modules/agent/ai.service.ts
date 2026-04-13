import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, zodSchema, stepCountIs } from 'ai';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import type { WASocket } from '@whiskeysockets/baileys';
import type { Server } from 'socket.io';

// ─── Tool Helper ───
function makeTool(description: string, schema: z.ZodObject<any>, execute: (params: any) => Promise<any>) {
    const wrapped = zodSchema(schema);
    return { description, parameters: wrapped, inputSchema: wrapped, execute };
}

// ─── SKILL: Data Tables ───
function buildTableTools(allowedTableIds: string[]) {
    return {
        listTables: makeTool(
            'List all available data tables with their column structure.',
            z.object({ reason: z.string().describe('Brief reason for listing tables') }),
            async () => {
                const tables = await prisma.customTable.findMany({
                    where: { id: { in: allowedTableIds } },
                    select: { id: true, name: true, description: true, columns: true }
                });
                return tables.map((t: any) => ({
                    id: t.id, name: t.name, description: t.description,
                    columns: (t.columns as any[]).map((c: any) => ({ name: c.name, type: c.type }))
                }));
            }
        ),
        searchTable: makeTool(
            'Search rows in a table by column value (case-insensitive partial match).',
            z.object({
                tableId: z.string().describe('Table ID from listTables'),
                column: z.string().describe('Column name to search'),
                query: z.string().describe('Search term')
            }),
            async ({ tableId, column, query }) => {
                if (!allowedTableIds.includes(tableId)) return { error: 'Access denied' };
                const rows = await prisma.customRow.findMany({ where: { tableId }, take: 50 });
                const q = query.toLowerCase();
                const matched = rows.filter(row => {
                    const val = (row.data as any)[column];
                    return val != null && String(val).toLowerCase().includes(q);
                });
                return { results: matched.map(r => r.data), count: matched.length };
            }
        ),
        getTableRows: makeTool(
            'Get rows from a table with pagination (max 10 per call).',
            z.object({
                tableId: z.string().describe('Table ID from listTables'),
                limit: z.number().max(10).optional().default(10).describe('Max rows (max 10)'),
                offset: z.number().optional().default(0).describe('Rows to skip')
            }),
            async ({ tableId, limit = 10, offset = 0 }) => {
                if (!allowedTableIds.includes(tableId)) return { error: 'Access denied' };
                const safeLimit = Math.min(limit || 10, 10);
                const [rows, total] = await Promise.all([
                    prisma.customRow.findMany({ where: { tableId }, take: safeLimit, skip: offset || 0, orderBy: { createdAt: 'asc' } }),
                    prisma.customRow.count({ where: { tableId } })
                ]);
                return { rows: rows.map(r => r.data), total, hasMore: (offset || 0) + safeLimit < total };
            }
        )
    };
}

// ─── SKILL: CRM ───
function buildCrmTools(userId: string) {
    return {
        upsertClient: makeTool(
            'Create or update a client in the CRM. Use this to save contact info, update status, add tags, or write a summary about the conversation.',
            z.object({
                phone: z.string().describe('Phone number of the client (digits only, e.g. 994551234567)'),
                name: z.string().optional().describe('Client name if known'),
                status: z.string().optional().describe('CRM status: NEW, LEAD, INTERESTED, PURCHASED, SPAM, etc.'),
                tags: z.array(z.string()).optional().describe('Tags like ["VIP", "wholesale", "returning"]'),
                summary: z.string().optional().describe('Brief summary of the conversation/client needs'),
                customFields: z.record(z.string(), z.any()).optional().describe('Any additional key-value data about the client')
            }),
            async ({ phone, name, status, tags, summary, customFields }) => {
                const cleanPhone = phone.replace(/[^0-9]/g, '');
                const client = await prisma.client.upsert({
                    where: { userId_phone: { userId, phone: cleanPhone } },
                    update: {
                        ...(name !== undefined ? { name } : {}),
                        ...(status !== undefined ? { status } : {}),
                        ...(tags !== undefined ? { tags } : {}),
                        ...(summary !== undefined ? { summary } : {}),
                        ...(customFields !== undefined ? { customFields } : {}),
                    },
                    create: {
                        userId,
                        phone: cleanPhone,
                        name: name || null,
                        status: status || 'NEW',
                        tags: tags || [],
                        summary: summary || null,
                        customFields: customFields || null,
                    }
                });
                return { success: true, clientId: client.id, phone: client.phone, status: client.status };
            }
        ),
        getClient: makeTool(
            'Get a client from CRM by phone number.',
            z.object({
                phone: z.string().describe('Phone number to look up')
            }),
            async ({ phone }) => {
                const cleanPhone = phone.replace(/[^0-9]/g, '');
                const client = await prisma.client.findUnique({
                    where: { userId_phone: { userId, phone: cleanPhone } }
                });
                if (!client) return { found: false };
                return { found: true, name: client.name, status: client.status, tags: client.tags, summary: client.summary, customFields: client.customFields };
            }
        ),
        searchClients: makeTool(
            'Search clients in CRM by name, status, or tags.',
            z.object({
                query: z.string().optional().describe('Search by name (partial match)'),
                status: z.string().optional().describe('Filter by status'),
                tag: z.string().optional().describe('Filter by tag')
            }),
            async ({ query, status, tag }) => {
                const clients = await prisma.client.findMany({
                    where: {
                        userId,
                        ...(query ? { name: { contains: query, mode: 'insensitive' as any } } : {}),
                        ...(status ? { status } : {}),
                        ...(tag ? { tags: { has: tag } } : {}),
                    },
                    take: 20,
                    orderBy: { updatedAt: 'desc' }
                });
                return { results: clients.map(c => ({ phone: c.phone, name: c.name, status: c.status, tags: c.tags, summary: c.summary })), count: clients.length };
            }
        )
    };
}

// ─── Skill Registry ───
const SKILL_DESCRIPTIONS: Record<string, string> = {
    tables: 'You have access to data tables. Use listTables first, then searchTable or getTableRows.',
    crm: 'You can manage clients in the CRM. Use upsertClient to save/update contacts, getClient to look up, searchClients to find existing clients.',
};

function buildToolsForSkills(skills: string[], allowedTableIds: string[], userId: string) {
    let tools: Record<string, any> = {};
    let prompts: string[] = [];

    if (skills.includes('tables') && allowedTableIds.length > 0) {
        tools = { ...tools, ...buildTableTools(allowedTableIds) };
        prompts.push(SKILL_DESCRIPTIONS.tables);
    }

    if (skills.includes('crm')) {
        tools = { ...tools, ...buildCrmTools(userId) };
        prompts.push(SKILL_DESCRIPTIONS.crm);
    }

    return { tools: Object.keys(tools).length > 0 ? tools : undefined, skillPrompt: prompts.length > 0 ? '\n\n' + prompts.join('\n') : '' };
}

// ─── Main AI Service ───
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
                include: { agent: { include: { provider: true } } }
            });

            if (!instance?.agent?.provider) return;
            if (!(instance.agent as any).isActive) return;

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

            // Get contact info
            const phone = remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '');
            const contact = await prisma.contact.findFirst({
                where: { instanceId, remoteJid }
            });
            const client = await prisma.client.findUnique({
                where: { userId_phone: { userId: agent.userId, phone } }
            }).catch(() => null);

            const contactName = client?.name || contact?.pushName || contact?.name || null;
            const contactContext = `\n\nCurrent contact info:\n- Phone: ${phone}${contactName ? `\n- Name: ${contactName}` : ''}${client?.status ? `\n- CRM Status: ${client.status}` : ''}${client?.tags?.length ? `\n- Tags: ${client.tags.join(', ')}` : ''}${client?.summary ? `\n- Summary: ${client.summary}` : ''}\nYou already have this info — do NOT ask the customer for their phone number or name.`;

            // Build tools based on agent skills
            const skills = (agent as any).skills || [];
            const { tools, skillPrompt } = buildToolsForSkills(skills, agent.allowedTableIds, agent.userId);

            const systemPrompt = (agent.systemPrompt || 'You are a helpful WhatsApp assistant.') + contactContext + skillPrompt;

            // Generate AI response
            const result = await generateText({
                model: aiModel,
                system: systemPrompt,
                messages,
                ...(tools ? { tools, stopWhen: stepCountIs(5) } : {}),
            } as any);

            const text = result.text;
            if (!text) return;

            // Extract tool calls
            const extractedToolCalls = (result.steps || []).flatMap((step: any) =>
                (step.toolCalls || []).map((tc: any) => ({
                    toolName: tc.toolName,
                    args: tc.args,
                }))
            );

            if (extractedToolCalls.length > 0) {
                logger.info({ tools: extractedToolCalls.map((tc: any) => tc.toolName) },
                    `[${instanceId}] AI used tools`);
            }

            // Send WhatsApp message
            const sentMsg = await sock.sendMessage(remoteJid, { text });

            // Save message to DB
            const saved = await prisma.message.create({
                data: { instanceId, remoteJid, isFromMe: true, messageType: 'text', content: text, timestamp: new Date() }
            });

            // Save conversation log
            const lastUserMsg = messages[messages.length - 1]?.content || '';
            await prisma.aiConversationLog.create({
                data: {
                    agentId: agent.id, instanceId, remoteJid,
                    userMessage: typeof lastUserMsg === 'string' ? lastUserMsg : JSON.stringify(lastUserMsg),
                    agentReply: text,
                    promptTokens: (result as any).usage?.inputTokens || 0,
                    completionTokens: (result as any).usage?.outputTokens || 0,
                    totalTokens: ((result as any).usage?.inputTokens || 0) + ((result as any).usage?.outputTokens || 0),
                    provider: providerInfo.provider, model: agent.model,
                    toolCalls: extractedToolCalls,
                }
            });

            // Real-time emit
            io.emit(`message.new-${instanceId}`, {
                id: sentMsg?.key?.id || saved.id, isFromMe: true, content: text,
                status: 'DELIVERED', timestamp: new Date().toISOString()
            });

            logger.info(`[${instanceId}] AI replied to ${remoteJid}`);

        } catch (error) {
            logger.error({ err: error, instanceId, remoteJid }, 'Failed to generate AI response');
        }
    }
}

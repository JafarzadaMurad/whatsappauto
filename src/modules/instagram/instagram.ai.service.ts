import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, zodSchema, stepCountIs } from 'ai';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import axios from 'axios';

// Reuse the same makeTool + skill builders from WhatsApp AI service
function makeTool(description: string, schema: z.ZodObject<any>, execute: (params: any) => Promise<any>) {
    const wrapped = zodSchema(schema);
    return { description, parameters: wrapped, inputSchema: wrapped, execute };
}

function buildCrmTools(userId: string) {
    return {
        upsertClient: makeTool(
            'Create or update a client in CRM.',
            z.object({
                phone: z.string().describe('Client identifier (Instagram user ID or username)'),
                name: z.string().optional().describe('Client name'),
                status: z.string().optional().describe('CRM status'),
                tags: z.array(z.string()).optional().describe('Tags'),
                summary: z.string().optional().describe('Summary'),
                customFields: z.record(z.string(), z.any()).optional().describe('Additional data')
            }),
            async ({ phone, name, status, tags, summary, customFields }) => {
                const client = await prisma.client.upsert({
                    where: { userId_phone: { userId, phone } },
                    update: {
                        ...(name !== undefined ? { name } : {}),
                        ...(status !== undefined ? { status } : {}),
                        ...(tags !== undefined ? { tags } : {}),
                        ...(summary !== undefined ? { summary } : {}),
                        ...(customFields !== undefined ? { customFields } : {}),
                    },
                    create: { userId, phone, name: name || null, status: status || 'NEW', tags: tags || [], summary: summary || null, customFields: customFields || null }
                });
                return { success: true, clientId: client.id, status: client.status };
            }
        ),
    };
}

function buildTableTools(allowedTableIds: string[]) {
    return {
        listTables: makeTool(
            'List available data tables.',
            z.object({ reason: z.string().describe('Why') }),
            async () => {
                const tables = await prisma.customTable.findMany({
                    where: { id: { in: allowedTableIds } },
                    select: { id: true, name: true, description: true, columns: true }
                });
                return tables.map((t: any) => ({ id: t.id, name: t.name, description: t.description, columns: (t.columns as any[]).map((c: any) => ({ name: c.name, type: c.type })) }));
            }
        ),
        searchTable: makeTool(
            'Search rows in a table by column value.',
            z.object({ tableId: z.string(), column: z.string(), query: z.string() }),
            async ({ tableId, column, query }) => {
                if (!allowedTableIds.includes(tableId)) return { error: 'Access denied' };
                const rows = await prisma.customRow.findMany({ where: { tableId }, take: 50 });
                const q = query.toLowerCase();
                const matched = rows.filter(r => { const v = (r.data as any)[column]; return v != null && String(v).toLowerCase().includes(q); });
                return { results: matched.map(r => r.data), count: matched.length };
            }
        ),
        getTableRows: makeTool(
            'Get rows from a table (max 10).',
            z.object({ tableId: z.string(), limit: z.number().max(10).optional().default(10), offset: z.number().optional().default(0) }),
            async ({ tableId, limit = 10, offset = 0 }) => {
                if (!allowedTableIds.includes(tableId)) return { error: 'Access denied' };
                const [rows, total] = await Promise.all([
                    prisma.customRow.findMany({ where: { tableId }, take: Math.min(limit, 10), skip: offset, orderBy: { createdAt: 'asc' } }),
                    prisma.customRow.count({ where: { tableId } })
                ]);
                return { rows: rows.map(r => r.data), total, hasMore: offset + limit < total };
            }
        )
    };
}

// ─── Send Instagram DM ───
async function sendIgMessage(igUserId: string, recipientId: string, text: string, accessToken: string) {
    await axios.post(`https://graph.instagram.com/v21.0/${igUserId}/messages`, {
        recipient: { id: recipientId },
        message: { text }
    }, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    });
}

// ─── Reply to Instagram Comment ───
async function replyToComment(commentId: string, text: string, accessToken: string) {
    await axios.post(`https://graph.instagram.com/v21.0/${commentId}/replies`, {
        message: text
    }, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    });
}

export class InstagramAiService {
    // ─── Handle DM ───
    static async handleDm(igUserId: string, senderId: string, messageText: string) {
        const account = await prisma.instagramAccount.findUnique({
            where: { igUserId },
            include: { agent: { include: { provider: true } } }
        });

        if (!account?.agent?.provider || !account.isActive || !(account.agent as any).isActive) return;

        const agent = account.agent;
        const text = await this.generateResponse(agent, account.userId, senderId, messageText, 'dm');
        if (!text) return;

        await sendIgMessage(igUserId, senderId, text, account.accessToken);

        // Log conversation
        await prisma.aiConversationLog.create({
            data: {
                agentId: agent.id,
                instanceId: account.id, // reuse field for IG account
                remoteJid: `ig:${senderId}`,
                userMessage: messageText,
                agentReply: text,
                promptTokens: 0, completionTokens: 0, totalTokens: 0,
                provider: agent.provider.provider,
                model: agent.model,
                toolCalls: [],
            }
        });

        logger.info(`[IG] Agent replied to DM from ${senderId}`);
    }

    // ─── Handle Comment ───
    static async handleComment(igUserId: string, commentId: string, commentText: string, from: any, mediaId: string) {
        const account = await prisma.instagramAccount.findUnique({
            where: { igUserId },
            include: { agent: { include: { provider: true } } }
        });

        if (!account?.agent?.provider || !account.isActive || !(account.agent as any).isActive) return;

        const agent = account.agent;
        const context = `[Comment on post by @${from.username}]: ${commentText}`;
        const text = await this.generateResponse(agent, account.userId, from.id, context, 'comment');
        if (!text) return;

        await replyToComment(commentId, text, account.accessToken);

        await prisma.aiConversationLog.create({
            data: {
                agentId: agent.id,
                instanceId: account.id,
                remoteJid: `ig:${from.id}`,
                userMessage: context,
                agentReply: text,
                promptTokens: 0, completionTokens: 0, totalTokens: 0,
                provider: agent.provider.provider,
                model: agent.model,
                toolCalls: [],
            }
        });

        logger.info(`[IG] Agent replied to comment ${commentId} from @${from.username}`);
    }

    // ─── Shared AI generation ───
    private static async generateResponse(agent: any, userId: string, contactId: string, messageText: string, type: 'dm' | 'comment'): Promise<string | null> {
        const providerInfo = agent.provider;
        let aiModel: any;
        if (providerInfo.provider === 'OPENAI') {
            aiModel = createOpenAI({ apiKey: providerInfo.apiKey } as any).chat(agent.model);
        } else if (providerInfo.provider === 'CLAUDE') {
            aiModel = createAnthropic({ apiKey: providerInfo.apiKey })(agent.model);
        } else if (providerInfo.provider === 'GEMINI') {
            aiModel = createGoogleGenerativeAI({ apiKey: providerInfo.apiKey })(agent.model);
        } else {
            return null;
        }

        // Build tools based on skills
        const skills = agent.skills || [];
        let tools: Record<string, any> = {};
        let skillPrompts: string[] = [];

        if (skills.includes('crm')) {
            tools = { ...tools, ...buildCrmTools(userId) };
            skillPrompts.push('You can manage clients in the CRM via upsertClient tool.');
        }
        if (skills.includes('tables') && agent.allowedTableIds?.length > 0) {
            tools = { ...tools, ...buildTableTools(agent.allowedTableIds) };
            skillPrompts.push('You have access to data tables via listTables, searchTable, getTableRows.');
        }

        const platformNote = type === 'dm'
            ? 'You are responding to an Instagram Direct Message.'
            : 'You are responding to an Instagram comment on a post. Keep your reply concise and relevant to the comment.';

        const systemPrompt = (agent.systemPrompt || 'You are a helpful assistant.') +
            `\n\n${platformNote}\nContact ID: ${contactId}` +
            (skillPrompts.length > 0 ? '\n\n' + skillPrompts.join('\n') : '');

        const hasTools = Object.keys(tools).length > 0;

        const result = await generateText({
            model: aiModel,
            system: systemPrompt,
            messages: [{ role: 'user' as const, content: messageText }],
            ...(hasTools ? { tools, stopWhen: stepCountIs(5) } : {}),
        } as any);

        return result.text || null;
    }
}

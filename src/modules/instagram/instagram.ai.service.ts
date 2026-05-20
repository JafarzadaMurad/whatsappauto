import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, zodSchema, stepCountIs } from 'ai';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import axios from 'axios';
import { buildHttpTools as buildHttpToolsShared, buildMemoryTools, sanitizeName, DEFAULT_SKILL_PROMPTS, applyAnthropicCacheControl, extractCacheUsage, type HttpToolTemplate } from '../agent/ai.service';
import { AutomationEngine } from '../automation/automation.engine';
import { upsertCrmContact } from '../client/client.service';

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

// HTTP tool building is shared with WhatsApp agent — see ../agent/ai.service.ts

// Fetch and cache an Instagram contact's profile (username, name, picture).
// Refetches only if missing or older than 24h to conserve API quota.
export async function cacheIgContact(igUserId: string, senderId: string, accessToken: string) {
    try {
        const existing = await prisma.instagramContact.findUnique({
            where: { igUserId_senderId: { igUserId, senderId } }
        });
        const stale = !existing || (Date.now() - new Date(existing.updatedAt).getTime() > 24 * 60 * 60 * 1000);
        if (!stale) {
            await prisma.instagramContact.update({
                where: { igUserId_senderId: { igUserId, senderId } },
                data: { lastMessageAt: new Date() }
            });
            return;
        }
        let profile: any = {};
        try {
            const res = await axios.get(`https://graph.instagram.com/v21.0/${senderId}`, {
                params: { fields: 'name,username,profile_pic', access_token: accessToken }
            });
            profile = res.data || {};
        } catch (e: any) {
            logger.warn({ senderId, err: e.response?.data?.error?.message || e.message }, '[IG] profile fetch failed');
        }
        await prisma.instagramContact.upsert({
            where: { igUserId_senderId: { igUserId, senderId } },
            update: {
                ...(profile.username ? { username: profile.username } : {}),
                ...(profile.name ? { name: profile.name } : {}),
                ...(profile.profile_pic ? { profilePic: profile.profile_pic } : {}),
                lastMessageAt: new Date()
            },
            create: {
                igUserId, senderId,
                username: profile.username || null,
                name: profile.name || null,
                profilePic: profile.profile_pic || null,
                lastMessageAt: new Date()
            }
        });
    } catch (e: any) {
        logger.warn({ err: e.message }, '[IG] cacheIgContact failed');
    }
}

// Instagram DM hard limit is 1000 chars. Keep a small safety margin.
const IG_MAX_MESSAGE = 950;

function truncateForIg(text: string): string {
    if (!text || text.length <= IG_MAX_MESSAGE) return text;
    return text.slice(0, IG_MAX_MESSAGE - 1) + '…';
}

// ─── Send Instagram DM ───
export async function sendIgMessage(igUserId: string, recipientId: string, text: string, accessToken: string) {
    const safe = truncateForIg(text);
    try {
        await axios.post(`https://graph.instagram.com/v21.0/${igUserId}/messages`, {
            recipient: { id: recipientId },
            message: { text: safe }
        }, {
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
    } catch (err: any) {
        const ig = err.response?.data?.error;
        logger.error({
            status: err.response?.status,
            ig_message: ig?.message,
            ig_code: ig?.code,
            ig_subcode: ig?.error_subcode,
            ig_user_msg: ig?.error_user_msg,
            text_length: safe.length
        }, '[IG] sendIgMessage failed');
        throw err;
    }
}

// ─── Reply to Instagram Comment ───
async function replyToComment(commentId: string, text: string, accessToken: string) {
    const safe = truncateForIg(text);
    try {
        await axios.post(`https://graph.instagram.com/v21.0/${commentId}/replies`, {
            message: safe
        }, {
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
    } catch (err: any) {
        const ig = err.response?.data?.error;
        logger.error({
            status: err.response?.status,
            ig_message: ig?.message,
            ig_code: ig?.code,
            ig_subcode: ig?.error_subcode,
            ig_user_msg: ig?.error_user_msg,
            text_length: safe.length
        }, '[IG] replyToComment failed');
        throw err;
    }
}

export class InstagramAiService {
    // ─── Handle DM ───
    static async handleDm(igUserId: string, senderId: string, messageText: string) {
        const account = await prisma.instagramAccount.findUnique({
            where: { igUserId },
            include: { agent: { include: { provider: true } } }
        });

        if (!account) return;

        // Cache the sender's profile regardless of whether an agent replies
        await cacheIgContact(igUserId, senderId, account.accessToken);

        // Run automations first — if one matches, skip the default agent reply
        const priorCount = await prisma.aiConversationLog.count({ where: { remoteJid: `ig:${senderId}` } });
        const contact = await prisma.instagramContact.findUnique({
            where: { igUserId_senderId: { igUserId, senderId } }
        }).catch(() => null);

        // Auto-add the sender to CRM with channel info
        await upsertCrmContact({
            userId: account.userId,
            phone: senderId,
            name: contact?.name || contact?.username || null,
            channel: 'instagram',
            sourceLabel: account.igUsername ? '@' + account.igUsername : null
        });
        const { matched } = await AutomationEngine.handleMessage({
            userId: account.userId,
            channel: 'instagram',
            text: messageText,
            contactId: senderId,
            contactName: contact?.name || contact?.username || undefined,
            isNewContact: priorCount === 0,
            source: 'dm',
            sendMessage: (t) => sendIgMessage(igUserId, senderId, t, account.accessToken),
            runAgent: async (agentId) => {
                const ag = await prisma.agent.findFirst({ where: { id: agentId }, include: { provider: true } });
                if (!ag?.provider) return;
                const r = await this.generateResponse(ag, account.userId, senderId, messageText, 'dm');
                if (r.text) await sendIgMessage(igUserId, senderId, r.text, account.accessToken);
            },
            addTag: async (tag) => {
                const existing = await prisma.client.findUnique({
                    where: { userId_phone: { userId: account.userId, phone: senderId } }
                }).catch(() => null);
                const tags = Array.from(new Set([...(existing?.tags || []), tag]));
                await prisma.client.upsert({
                    where: { userId_phone: { userId: account.userId, phone: senderId } },
                    update: { tags },
                    create: { userId: account.userId, phone: senderId, tags, status: 'NEW' }
                });
            }
        });
        if (matched) {
            logger.info(`[IG] DM from ${senderId} handled by automation`);
            return;
        }

        if (!account.agent?.provider || !account.isActive || !(account.agent as any).isActive) return;

        const agent = account.agent;
        const { text, usage } = await this.generateResponse(agent, account.userId, senderId, messageText, 'dm');
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
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                totalTokens: usage.totalTokens,
                cachedTokens: usage.cachedTokens,
                cacheCreationTokens: usage.cacheCreationTokens,
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

        if (!account) return;

        // Run automations first — a matching comment trigger skips the default agent
        const { matched } = await AutomationEngine.handleMessage({
            userId: account.userId,
            channel: 'instagram',
            text: commentText,
            contactId: from.id,
            contactName: from.username || undefined,
            source: 'comment',
            sendMessage: (t) => replyToComment(commentId, t, account.accessToken),
        });
        if (matched) {
            logger.info(`[IG] Comment ${commentId} handled by automation`);
            return;
        }

        if (!account.agent?.provider || !account.isActive || !(account.agent as any).isActive) return;

        const agent = account.agent;
        const context = `[Comment on post by @${from.username}]: ${commentText}`;
        const { text, usage } = await this.generateResponse(agent, account.userId, from.id, context, 'comment');
        if (!text) return;

        await replyToComment(commentId, text, account.accessToken);

        await prisma.aiConversationLog.create({
            data: {
                agentId: agent.id,
                instanceId: account.id,
                remoteJid: `ig:${from.id}`,
                userMessage: context,
                agentReply: text,
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                totalTokens: usage.totalTokens,
                cachedTokens: usage.cachedTokens,
                cacheCreationTokens: usage.cacheCreationTokens,
                provider: agent.provider.provider,
                model: agent.model,
                toolCalls: [],
            }
        });

        logger.info(`[IG] Agent replied to comment ${commentId} from @${from.username}`);
    }

    // ─── Shared AI generation ───
    private static async generateResponse(
        agent: any,
        userId: string,
        contactId: string,
        messageText: string,
        type: 'dm' | 'comment'
    ): Promise<{ text: string | null; usage: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number; cacheCreationTokens: number } }> {
        const providerInfo = agent.provider;
        let aiModel: any;
        if (providerInfo.provider === 'OPENAI') {
            aiModel = createOpenAI({ apiKey: providerInfo.apiKey } as any).chat(agent.model);
        } else if (providerInfo.provider === 'CLAUDE') {
            aiModel = createAnthropic({ apiKey: providerInfo.apiKey })(agent.model);
        } else if (providerInfo.provider === 'GEMINI') {
            aiModel = createGoogleGenerativeAI({ apiKey: providerInfo.apiKey })(agent.model);
        } else {
            return { text: null, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0, cacheCreationTokens: 0 } };
        }

        const skills = agent.skills || [];
        const remoteJid = `ig:${contactId}`;
        const overrides = (agent.skillPrompts || {}) as Record<string, string>;
        const resolvePrompt = (id: string) =>
            (overrides[id] && overrides[id].trim().length > 0) ? overrides[id] : (DEFAULT_SKILL_PROMPTS[id] || '');

        let tools: Record<string, any> = {};
        let skillPromptParts: string[] = [];

        if (skills.includes('crm')) {
            tools = { ...tools, ...buildCrmTools(userId) };
            skillPromptParts.push(resolvePrompt('crm'));
        }
        if (skills.includes('tables') && agent.allowedTableIds?.length > 0) {
            tools = { ...tools, ...buildTableTools(agent.allowedTableIds) };
            skillPromptParts.push(resolvePrompt('tables'));
        }
        if (skills.includes('memory')) {
            tools = { ...tools, ...buildMemoryTools(agent.id, remoteJid) };
            skillPromptParts.push(resolvePrompt('memory'));
        }
        if (skills.includes('http')) {
            const httpTools = ((agent.httpTools as any) || []) as HttpToolTemplate[];
            if (httpTools.length > 0) {
                tools = { ...tools, ...buildHttpToolsShared(httpTools) };
                const list = httpTools.map((t, i) => `- ${sanitizeName(t.name, `httpTool${i + 1}`)}: ${t.description || ''}`).join('\n');
                skillPromptParts.push(resolvePrompt('http') + '\n' + list);
            }
        }

        const platformNote = type === 'dm'
            ? 'You are responding to an Instagram Direct Message. Your reply MUST be under 900 characters. If tool output is large, summarize the key items briefly instead of pasting raw JSON.'
            : 'You are responding to an Instagram comment on a post. Your reply MUST be under 900 characters and concise.';

        const systemPrompt = (agent.systemPrompt || 'You are a helpful assistant.') +
            `\n\n${platformNote}\nContact ID: ${contactId}` +
            (skillPromptParts.length > 0 ? '\n\n' + skillPromptParts.join('\n\n') : '');

        const hasTools = Object.keys(tools).length > 0;

        // Build conversation history (short window — agent uses memory tools for older context)
        const historyDepth = skills.includes('memory') ? 3 : 10;
        const priorLogs = await prisma.aiConversationLog.findMany({
            where: { agentId: agent.id, remoteJid },
            orderBy: { createdAt: 'desc' },
            take: historyDepth,
            select: { userMessage: true, agentReply: true }
        });
        priorLogs.reverse();

        const messages: { role: 'user' | 'assistant'; content: string }[] = [];
        for (const log of priorLogs) {
            if (log.userMessage) messages.push({ role: 'user', content: log.userMessage });
            if (log.agentReply) messages.push({ role: 'assistant', content: log.agentReply });
        }
        messages.push({ role: 'user', content: messageText });

        const result = await generateText({
            model: aiModel,
            system: systemPrompt,
            messages: applyAnthropicCacheControl(providerInfo.provider, messages),
            ...(hasTools ? { tools, stopWhen: stepCountIs(5) } : {}),
        } as any);

        const cache = extractCacheUsage(providerInfo.provider, result);
        const usage = (result as any).usage || {};
        return {
            text: result.text || null,
            usage: {
                promptTokens: usage.inputTokens || 0,
                completionTokens: usage.outputTokens || 0,
                totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
                cachedTokens: cache.cachedTokens,
                cacheCreationTokens: cache.cacheCreationTokens
            }
        };
    }
}

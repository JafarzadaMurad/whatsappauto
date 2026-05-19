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

// ─── SKILL: HTTP API Requests ───
import axios from 'axios';

function urlAllowed(url: string, patterns: string[]): boolean {
    if (!patterns || patterns.length === 0) return true; // no restriction
    return patterns.some(p => {
        const regex = new RegExp('^' + p.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
        return regex.test(url);
    });
}

// Structured HTTP tool template types (n8n-style)
export type ValueSpec =
    | { mode: 'fixed'; value: string }
    | { mode: 'ai'; description: string };

export type HttpToolTemplate = {
    id?: string;
    name: string;          // tool name shown to AI (e.g. "getWeather")
    description: string;   // what this tool does

    // 'form' (default): structured fields below. 'raw': use rawRequest string.
    inputMode?: 'form' | 'raw';
    // Raw HTTP request text. Format:
    //   METHOD https://url
    //   Header-Name: value
    //   Header-Name: value
    //
    //   body (optional, any text/JSON)
    // Anywhere in the text, {{description}} marks an AI-filled placeholder.
    rawRequest?: string;

    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: ValueSpec;
    auth?:
        | { type: 'none' }
        | { type: 'bearer'; token: string }
        | { type: 'basic'; username: string; password: string };
    queryParams?: Array<{ name: string; value: ValueSpec }>;
    headers?: Array<{ name: string; value: ValueSpec }>;
    bodyType?: 'none' | 'json' | 'raw';
    bodyParams?: Array<{ name: string; value: ValueSpec }>; // for json
    rawBody?: ValueSpec; // for raw
};

// Extract {{description}} placeholders from raw request text.
// Returns parsed placeholders and a template string with markers.
export function parseRawPlaceholders(text: string): { template: string; placeholders: { key: string; description: string }[] } {
    const placeholders: { key: string; description: string }[] = [];
    const seen = new Map<string, string>(); // description → key (dedupe)
    let idx = 0;
    const template = text.replace(/\{\{([^}]+)\}\}/g, (_m, desc) => {
        const trimmed = String(desc).trim();
        let key = seen.get(trimmed);
        if (!key) {
            key = `ai_${idx++}`;
            seen.set(trimmed, key);
            placeholders.push({ key, description: trimmed });
        }
        return `[[__AI_PARAM_${key}__]]`;
    });
    return { template, placeholders };
}

// Parse a raw HTTP request text. Returns components with placeholder markers
// preserved inline so they can be substituted later.
export function parseRawRequest(text: string): { method: string; url: string; headers: Record<string, string>; body: string } {
    const lines = text.split(/\r?\n/);
    let i = 0;
    while (i < lines.length && !lines[i].trim()) i++;
    const firstLine = (lines[i] || '').trim();
    const m = firstLine.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S.*)$/i);
    let method = 'GET';
    let url = '';
    if (m) {
        method = m[1].toUpperCase();
        url = m[2].trim();
    } else {
        url = firstLine; // fall back: treat whole first line as URL
    }
    i++;
    const headers: Record<string, string> = {};
    for (; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) { i++; break; }
        const hm = line.match(/^([^:]+):\s*(.*)$/);
        if (hm) headers[hm[1].trim()] = hm[2];
    }
    const body = lines.slice(i).join('\n').replace(/^\s+|\s+$/g, '');
    return { method, url, headers, body };
}

// Replace placeholder markers [[__AI_PARAM_<key>__]] with AI-provided values.
function applyPlaceholders(s: string, values: Record<string, string>): string {
    return s.replace(/\[\[__AI_PARAM_([^\]]+)__\]\]/g, (_m, key) => values[key] ?? '');
}

// Transliterate non-ASCII (esp. Azerbaijani/Turkish) chars to ASCII so tool names
// remain readable rather than becoming a string of underscores.
const TRANSLIT: Record<string, string> = {
    'ə': 'a', 'Ə': 'A', 'ı': 'i', 'İ': 'I', 'ş': 's', 'Ş': 'S',
    'ç': 'c', 'Ç': 'C', 'ğ': 'g', 'Ğ': 'G', 'ö': 'o', 'Ö': 'O',
    'ü': 'u', 'Ü': 'U', 'â': 'a', 'î': 'i', 'û': 'u'
};

// sanitize a name to valid OpenAI/Anthropic tool name: ^[a-zA-Z0-9_-]+$
export function sanitizeName(s: string, fallback: string): string {
    const transliterated = (s || '').split('').map(c => TRANSLIT[c] ?? c).join('');
    const cleaned = transliterated.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^[0-9]/, '_$&');
    // Collapse runs of underscores for readability
    const compact = cleaned.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return compact || fallback;
}

// build a Zod schema dynamically containing only AI-mode fields the model must fill
function buildTemplateSchema(tpl: HttpToolTemplate) {
    const shape: Record<string, any> = {};

    if (tpl.inputMode === 'raw') {
        // Raw mode: extract {{description}} placeholders from rawRequest text
        const { placeholders } = parseRawPlaceholders(tpl.rawRequest || '');
        placeholders.forEach(ph => {
            shape[ph.key] = z.string().describe(ph.description);
        });
    } else {
        if (tpl.url?.mode === 'ai') {
            shape['url'] = z.string().describe(tpl.url.description || 'Full URL to call');
        }
        (tpl.queryParams || []).forEach((p, i) => {
            if (p.value?.mode === 'ai') {
                const key = `query_${sanitizeName(p.name, `p${i}`)}`;
                shape[key] = z.string().describe(p.value.description || `Value for query param "${p.name}"`);
            }
        });
        (tpl.headers || []).forEach((h, i) => {
            if (h.value?.mode === 'ai') {
                const key = `header_${sanitizeName(h.name, `h${i}`)}`;
                shape[key] = z.string().describe(h.value.description || `Value for header "${h.name}"`);
            }
        });
        if (tpl.bodyType === 'json') {
            (tpl.bodyParams || []).forEach((b, i) => {
                if (b.value?.mode === 'ai') {
                    const key = `body_${sanitizeName(b.name, `b${i}`)}`;
                    shape[key] = z.string().describe(b.value.description || `Value for body field "${b.name}"`);
                }
            });
        } else if (tpl.bodyType === 'raw' && tpl.rawBody?.mode === 'ai') {
            shape['body'] = z.string().describe(tpl.rawBody.description || 'Raw request body');
        }
    }

    // Always include an optional reason for logging clarity (and to ensure non-empty schema)
    if (Object.keys(shape).length === 0) {
        shape['_call'] = z.string().optional().describe('Brief reason for calling this tool');
    }

    return z.object(shape);
}

function resolveValue(spec: ValueSpec, aiVal: string | undefined): string {
    if (spec.mode === 'fixed') return spec.value ?? '';
    return aiVal ?? '';
}

export function buildTemplateExecutor(tpl: HttpToolTemplate) {
    return async (args: Record<string, any>) => {
        try {
            // RAW MODE: parse rawRequest text, substitute placeholders, send
            if (tpl.inputMode === 'raw') {
                const { template, placeholders } = parseRawPlaceholders(tpl.rawRequest || '');
                const values: Record<string, string> = {};
                placeholders.forEach(ph => { values[ph.key] = args[ph.key] ?? ''; });
                const filled = applyPlaceholders(template, values);
                const parsed = parseRawRequest(filled);
                if (!parsed.url) return { error: 'No URL in raw request' };

                let data: any = undefined;
                if (parsed.body) {
                    const ct = Object.entries(parsed.headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] || '';
                    if (ct.toLowerCase().includes('application/json')) {
                        try { data = JSON.parse(parsed.body); } catch { data = parsed.body; }
                    } else {
                        data = parsed.body;
                    }
                }
                const res = await axios.request({
                    url: parsed.url,
                    method: parsed.method as any,
                    headers: parsed.headers,
                    data,
                    timeout: 30000,
                    maxContentLength: 1024 * 1024,
                    validateStatus: () => true,
                });
                let responseData: any = res.data;
                if (typeof responseData === 'string' && responseData.length > 5000) {
                    responseData = responseData.slice(0, 5000) + '...[truncated]';
                }
                return { status: res.status, data: responseData };
            }

            // URL
            const url = tpl.url.mode === 'fixed' ? tpl.url.value : (args.url || '');
            if (!url) return { error: 'No URL provided' };

            // Query params
            const params: Record<string, string> = {};
            (tpl.queryParams || []).forEach((p, i) => {
                if (!p.name) return;
                const aiKey = `query_${sanitizeName(p.name, `p${i}`)}`;
                params[p.name] = resolveValue(p.value, args[aiKey]);
            });

            // Headers
            const headers: Record<string, string> = {};
            (tpl.headers || []).forEach((h, i) => {
                if (!h.name) return;
                const aiKey = `header_${sanitizeName(h.name, `h${i}`)}`;
                headers[h.name] = resolveValue(h.value, args[aiKey]);
            });

            // Auth
            if (tpl.auth?.type === 'bearer' && tpl.auth.token) {
                headers['Authorization'] = `Bearer ${tpl.auth.token}`;
            } else if (tpl.auth?.type === 'basic' && tpl.auth.username) {
                const basic = Buffer.from(`${tpl.auth.username}:${tpl.auth.password || ''}`).toString('base64');
                headers['Authorization'] = `Basic ${basic}`;
            }

            // Body
            let data: any = undefined;
            if (tpl.bodyType === 'json') {
                const obj: Record<string, any> = {};
                (tpl.bodyParams || []).forEach((b, i) => {
                    if (!b.name) return;
                    const aiKey = `body_${sanitizeName(b.name, `b${i}`)}`;
                    obj[b.name] = resolveValue(b.value, args[aiKey]);
                });
                data = obj;
                if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
            } else if (tpl.bodyType === 'raw' && tpl.rawBody) {
                data = tpl.rawBody.mode === 'fixed' ? tpl.rawBody.value : (args.body || '');
            }

            const res = await axios.request({
                url,
                method: tpl.method,
                headers,
                params: Object.keys(params).length ? params : undefined,
                data,
                timeout: 30000,
                maxContentLength: 1024 * 1024,
                validateStatus: () => true,
            });
            let responseData: any = res.data;
            if (typeof responseData === 'string' && responseData.length > 5000) {
                responseData = responseData.slice(0, 5000) + '...[truncated]';
            }
            return { status: res.status, data: responseData };
        } catch (err: any) {
            return { error: err.message, code: err.code };
        }
    };
}

export function buildHttpTools(allowedUrls: string[], httpTools: HttpToolTemplate[] = []) {
    const tools: Record<string, any> = {};

    // Generic ad-hoc tool (always available when http skill is on)
    tools.httpRequest = makeTool(
        'Make an HTTP API request to an external endpoint. Use this when no dedicated tool exists for the API you need.',
        z.object({
            url: z.string().describe('Full URL to call (e.g. https://api.example.com/data)'),
            method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).describe('HTTP method'),
            headers: z.record(z.string(), z.string()).optional().describe('Optional request headers as key-value pairs'),
            body: z.any().optional().describe('Optional request body (object for JSON, string for raw text)'),
            queryParams: z.record(z.string(), z.string()).optional().describe('Optional query string parameters as key-value pairs')
        }),
        async ({ url, method, headers, body, queryParams }) => {
            if (!urlAllowed(url, allowedUrls)) {
                return { error: 'URL not in allowed list', allowedPatterns: allowedUrls };
            }
            try {
                const res = await axios.request({
                    url, method, headers: headers || {}, data: body, params: queryParams,
                    timeout: 30000, maxContentLength: 1024 * 1024, validateStatus: () => true,
                });
                let data: any = res.data;
                if (typeof data === 'string' && data.length > 5000) data = data.slice(0, 5000) + '...[truncated]';
                return { status: res.status, data };
            } catch (err: any) {
                return { error: err.message, code: err.code };
            }
        }
    );

    // Add user-defined templated HTTP tools as named tools
    const usedNames = new Set<string>(['httpRequest']);
    (httpTools || []).forEach((tpl, idx) => {
        if (!tpl || !tpl.method || !tpl.url) return;
        let toolName = sanitizeName(tpl.name, `httpTool${idx + 1}`);
        let suffix = 1;
        while (usedNames.has(toolName)) { toolName = `${toolName}_${suffix++}`; }
        usedNames.add(toolName);

        tools[toolName] = makeTool(
            tpl.description || `Call ${toolName}`,
            buildTemplateSchema(tpl),
            buildTemplateExecutor(tpl)
        );
    });

    return tools;
}

// ─── Skill Registry ───
const SKILL_DESCRIPTIONS: Record<string, string> = {
    tables: 'You have access to data tables. Use listTables first, then searchTable or getTableRows.',
    crm: 'You can manage clients in the CRM. Use upsertClient to save/update contacts, getClient to look up, searchClients to find existing clients.',
    http: 'You can call external HTTP APIs via httpRequest. Specify URL, method (GET/POST/PUT/PATCH/DELETE), optional headers, body, and queryParams.',
};

function buildToolsForSkills(
    skills: string[],
    allowedTableIds: string[],
    userId: string,
    allowedUrls: string[] = [],
    httpTools: HttpToolTemplate[] = []
) {
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

    if (skills.includes('http')) {
        tools = { ...tools, ...buildHttpTools(allowedUrls, httpTools) };
        prompts.push(SKILL_DESCRIPTIONS.http);
        if (httpTools && httpTools.length > 0) {
            const list = httpTools
                .map((t, i) => `- ${sanitizeName(t.name, `httpTool${i + 1}`)}: ${t.description || ''}`)
                .join('\n');
            prompts.push(`You also have these dedicated HTTP tools available — prefer them over the generic httpRequest when applicable:\n${list}`);
        }
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
            const httpTools = (((agent as any).httpTools) || []) as HttpToolTemplate[];
            const { tools, skillPrompt } = buildToolsForSkills(skills, agent.allowedTableIds, agent.userId, (agent as any).allowedUrls || [], httpTools);

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

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, zodSchema, stepCountIs } from 'ai';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import type { WASocket } from '@whiskeysockets/baileys';
import type { Server } from 'socket.io';
import { AutomationEngine } from '../automation/automation.engine';

// ─── Tool Helper ───
function makeTool(description: string, schema: z.ZodObject<any>, execute: (params: any) => Promise<any>) {
    const wrapped = zodSchema(schema);
    return { description, parameters: wrapped, inputSchema: wrapped, execute };
}

// ─── Activity-log helpers ───────────────────────────────────────
// Strip credentials out of recorded args/headers before persisting to
// the Activity tab. The display is meant for humans inspecting agent
// behavior, not for retaining secrets.
const SENSITIVE_KEY_RE = /authorization|password|secret|bearer|apikey|api[_-]?key|token/i;

function redactSensitive(value: any, depth = 0): any {
    if (depth > 5 || value == null) return value;
    if (typeof value === 'string') {
        return /^Bearer\s+/i.test(value) ? 'Bearer ***' : value;
    }
    if (Array.isArray(value)) return value.map(v => redactSensitive(v, depth + 1));
    if (typeof value === 'object') {
        const out: any = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = SENSITIVE_KEY_RE.test(k) ? '***' : redactSensitive(v, depth + 1);
        }
        return out;
    }
    return value;
}

function truncateForLog(value: any, max = 5000): any {
    if (typeof value === 'string') return value.length > max ? value.slice(0, max) + '...[truncated]' : value;
    if (Array.isArray(value)) return value.map(v => truncateForLog(v, max));
    if (value && typeof value === 'object') {
        const out: any = {};
        for (const [k, v] of Object.entries(value)) out[k] = truncateForLog(v, max);
        return out;
    }
    return value;
}

// Tool names that mutate workspace data. In agent "Test as contact"
// mode they're swapped with stubs so the real CRM / contact record
// isn't dirtied by exploratory testing. HTTP tools intentionally still
// fire — verifying external integrations (Bitrix, etc.) is the whole
// point of a test session.
const TEST_DRY_RUN_TOOLS = new Set(['upsertClient', 'setUserField']);

export function wrapToolsForDryRun(tools: Record<string, any> | undefined): Record<string, any> | undefined {
    if (!tools) return tools;
    const out: Record<string, any> = {};
    for (const [name, def] of Object.entries(tools)) {
        if (TEST_DRY_RUN_TOOLS.has(name)) {
            out[name] = {
                ...def,
                execute: async (args: any) => ({
                    dryRun: true,
                    skippedReason: 'Test mode — write skipped. The real contact record was not modified.',
                    wouldHaveCalled: name,
                    wouldHaveArgs: args,
                }),
            };
        } else {
            out[name] = def;
        }
    }
    return out;
}

// Pair every tool call with its result from the AI SDK steps. Returns
// the rich shape persisted to AgentActivityLog.toolCalls.
export function extractRichToolCalls(steps: any[]): Array<{
    toolName: string; args: any; result: any; ok: boolean; error?: string;
}> {
    return (steps || []).flatMap((step: any) => {
        const calls = step.toolCalls || [];
        const results = step.toolResults || [];
        const resultById = new Map<string, any>(results.map((r: any) => [r.toolCallId, r]));
        return calls.map((tc: any) => {
            const r = resultById.get(tc.toolCallId);
            // The SDK wraps results in { result } or { output } depending on version
            const rawResult = r ? (r.result ?? r.output ?? null) : null;
            const hasErrorField = rawResult && typeof rawResult === 'object' && (rawResult as any).error !== undefined;
            return {
                toolName: tc.toolName,
                args: truncateForLog(redactSensitive(tc.args)),
                result: truncateForLog(rawResult),
                ok: !hasErrorField,
                ...(hasErrorField ? { error: String((rawResult as any).error).slice(0, 500) } : {}),
            };
        });
    });
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
function buildCrmTools(workspaceId: string, userId: string) {
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
                const existing = await prisma.client.findFirst({ where: { workspaceId, phone: cleanPhone } });
                const client = existing
                    ? await prisma.client.update({
                        where: { id: existing.id },
                        data: {
                            ...(name !== undefined ? { name } : {}),
                            ...(status !== undefined ? { status } : {}),
                            ...(tags !== undefined ? { tags } : {}),
                            ...(summary !== undefined ? { summary } : {}),
                            ...(customFields !== undefined ? { customFields } : {}),
                        },
                    })
                    : await prisma.client.create({
                        data: {
                            userId, workspaceId,
                            phone: cleanPhone,
                            name: name || null,
                            status: status || 'NEW',
                            tags: tags || [],
                            summary: summary || null,
                            customFields: customFields || null,
                        },
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
                const client = await prisma.client.findFirst({ where: { workspaceId, phone: cleanPhone } });
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
                        workspaceId,
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

// ─── SKILL: User Fields ───
// Lets the agent read and write user-defined custom fields on the contact
// currently being chatted with. The contact phone is bound at runtime
// inside the chat handler (the agent doesn't have to discover it).
function buildUserFieldTools(workspaceId: string, userId: string, contactPhone: string) {
    return {
        listUserFields: makeTool(
            'List all custom fields defined for this account. Returns each field\'s key, label, type, and (for select fields) the allowed options. Call this once before writing values so you use the correct field keys.',
            z.object({}),
            async () => {
                const fields = await prisma.userField.findMany({
                    where: { workspaceId },
                    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                });
                return { fields: fields.map(f => ({ key: f.key, label: f.label, type: f.type, options: f.options })) };
            }
        ),
        getUserField: makeTool(
            'Read the value of a custom field on the current contact.',
            z.object({
                key: z.string().describe('The field key (slug). Use listUserFields if unsure.'),
            }),
            async ({ key }) => {
                const cleanPhone = contactPhone.replace(/[^0-9]/g, '') || contactPhone;
                const client = await prisma.client.findFirst({
                    where: { workspaceId, phone: cleanPhone },
                    select: { customFields: true },
                });
                const v = (client?.customFields as Record<string, any> | null)?.[key];
                return { value: v ?? null };
            }
        ),
        setUserField: makeTool(
            'Write a value to a custom field on the current contact. Creates the contact if it does not exist yet. Use for things like saving age, city, purpose, budget, etc.',
            z.object({
                key: z.string().describe('The field key (slug) you got from listUserFields'),
                value: z.union([z.string(), z.number(), z.boolean(), z.null()]).describe('The value to store. Match the field\'s type.'),
            }),
            async ({ key, value }) => {
                const cleanPhone = contactPhone.replace(/[^0-9]/g, '') || contactPhone;
                const existing = await prisma.client.findFirst({
                    where: { workspaceId, phone: cleanPhone },
                    select: { id: true, customFields: true },
                });
                const merged: Record<string, any> = { ...((existing?.customFields as any) || {}), [key]: value };
                const client = existing
                    ? await prisma.client.update({ where: { id: existing.id }, data: { customFields: merged } })
                    : await prisma.client.create({ data: { userId, workspaceId, phone: cleanPhone, status: 'NEW', tags: [], customFields: merged } });
                return { success: true, key, value, clientId: client.id };
            }
        ),
        searchContactsByField: makeTool(
            'Find contacts whose custom field equals a given value. Useful when the user asks something like "show me everyone who lives in Baku".',
            z.object({
                key: z.string().describe('The field key (slug)'),
                value: z.union([z.string(), z.number(), z.boolean()]).describe('The value to match exactly'),
            }),
            async ({ key, value }) => {
                const all = await prisma.client.findMany({
                    where: { workspaceId },
                    select: { id: true, phone: true, name: true, customFields: true },
                });
                const matches = all.filter(c => (c.customFields as any)?.[key] === value).slice(0, 20);
                return {
                    count: matches.length,
                    results: matches.map(c => ({ phone: c.phone, name: c.name })),
                };
            }
        ),
    };
}

// ─── SKILL: HTTP API Requests ───
import axios from 'axios';

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

// ─── CRM placeholders for HTTP tool templates ─────────────────────
// HTTP tool fields can reference data from the current contact via
//   {{contact:name|phone|status|summary|tags}}
//   {{field:<userFieldKey>}}
// resolved from Client + Client.customFields. Unknown / missing values
// resolve to an empty string. Regular {{description}} AI placeholders
// are unaffected — they only match raw-mode parser braces that don't
// carry a `kind:` prefix.
export type HttpCtx = { workspaceId?: string; contactPhone?: string };

const CRM_PLACEHOLDER_RE = /\{\{\s*(contact|field)\s*:\s*([a-zA-Z0-9_]+)\s*\}\}/g;

async function loadCrmPlaceholderValues(ctx: HttpCtx | undefined): Promise<{ contact: Record<string, string>; field: Record<string, string> }> {
    const contact: Record<string, string> = {};
    const field: Record<string, string> = {};
    if (!ctx?.workspaceId || !ctx?.contactPhone) return { contact, field };
    const cleanPhone = ctx.contactPhone.replace(/[^0-9]/g, '') || ctx.contactPhone;
    contact.phone = cleanPhone;
    try {
        const client = await prisma.client.findFirst({
            where: { workspaceId: ctx.workspaceId, phone: cleanPhone },
            select: { name: true, status: true, tags: true, summary: true, customFields: true },
        });
        if (client) {
            if (client.name) contact.name = client.name;
            if (client.status) contact.status = client.status;
            if (client.summary) contact.summary = client.summary;
            if (Array.isArray(client.tags)) contact.tags = client.tags.join(',');
            const cf = (client.customFields as Record<string, any> | null) || {};
            for (const [k, v] of Object.entries(cf)) {
                if (v == null) continue;
                field[k] = typeof v === 'string' ? v : (typeof v === 'object' ? JSON.stringify(v) : String(v));
            }
        }
    } catch { /* placeholders just resolve to empty */ }
    return { contact, field };
}

function substituteCrmPlaceholders(text: string, values: { contact: Record<string, string>; field: Record<string, string> }): string {
    if (!text || typeof text !== 'string') return text;
    return text.replace(CRM_PLACEHOLDER_RE, (_, kind: string, key: string) => {
        const map = kind === 'contact' ? values.contact : values.field;
        return map[key] ?? '';
    });
}

// ─── Cross-tool result chaining ───────────────────────────────────
// In a single agent turn the LLM may call several HTTP tools in
// sequence. {{prev:<tool>.<json.path>}} lets a later tool reference
// any earlier tool's response without going through the model.
// Example: {{prev:bitrix_create_contact.data.result}} → 14847.
// Paths support dotted access and numeric segments for array indices.
const PREV_PLACEHOLDER_RE = /\{\{\s*prev\s*:\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function resolvePrevPath(stepResults: Record<string, any>, path: string): string {
    const segments = path.split('.');
    const toolName = segments.shift();
    if (!toolName) return '';
    let cur: any = stepResults[toolName];
    for (const seg of segments) {
        if (cur == null) return '';
        if (Array.isArray(cur) && /^\d+$/.test(seg)) {
            cur = cur[parseInt(seg, 10)];
        } else if (typeof cur === 'object') {
            cur = cur[seg];
        } else {
            return '';
        }
    }
    if (cur == null) return '';
    return typeof cur === 'string' ? cur : (typeof cur === 'object' ? JSON.stringify(cur) : String(cur));
}

function substitutePrevPlaceholders(text: string, stepResults: Record<string, any>): string {
    if (!text || typeof text !== 'string') return text;
    return text.replace(PREV_PLACEHOLDER_RE, (_, path: string) => resolvePrevPath(stepResults, path));
}

function applyAllPlaceholders(text: string, crm: { contact: Record<string, string>; field: Record<string, string> }, stepResults: Record<string, any>): string {
    return substitutePrevPlaceholders(substituteCrmPlaceholders(text, crm), stepResults);
}

// Strip Authorization / Bearer / token-bearing headers when surfacing
// the resolved request to the Activity log / Test tab. The user still
// sees the URL and body that actually went out, just not the secret
// that authorised the call.
function redactHeadersForDisplay(headers: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
        if (/authorization|api[_-]?key|token|secret|password/i.test(k)) {
            out[k] = '***';
        } else if (typeof v === 'string' && /^Bearer\s+/i.test(v)) {
            out[k] = 'Bearer ***';
        } else {
            out[k] = v;
        }
    }
    return out;
}

export function buildTemplateExecutor(tpl: HttpToolTemplate, ctx?: HttpCtx, stepResults: Record<string, any> = {}) {
    return async (args: Record<string, any>) => {
        // CRM placeholders ({{contact:*}} / {{field:*}}) get filled in
        // here from the current contact before AI placeholder parsing,
        // so the LLM never has to repeat data we already know.
        // Cross-tool placeholders ({{prev:<tool>.<path>}}) pull from
        // earlier HTTP tool results within the same agent turn.
        const crmValues = await loadCrmPlaceholderValues(ctx);
        try {
            // RAW MODE: parse rawRequest text, substitute placeholders, send
            if (tpl.inputMode === 'raw') {
                const rawWithCrm = applyAllPlaceholders(tpl.rawRequest || '', crmValues, stepResults);
                const { template, placeholders } = parseRawPlaceholders(rawWithCrm);
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
                const t0 = Date.now();
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
                return {
                    request: {
                        mode: 'raw',
                        method: parsed.method,
                        url: parsed.url,
                        headers: redactHeadersForDisplay(parsed.headers),
                        body: data ?? null,
                    },
                    status: res.status,
                    data: responseData,
                    durationMs: Date.now() - t0,
                };
            }

            // URL
            const rawUrl = tpl.url.mode === 'fixed' ? tpl.url.value : (args.url || '');
            const url = applyAllPlaceholders(rawUrl, crmValues, stepResults);
            if (!url) return { error: 'No URL provided' };

            // Query params
            const params: Record<string, string> = {};
            (tpl.queryParams || []).forEach((p, i) => {
                if (!p.name) return;
                const aiKey = `query_${sanitizeName(p.name, `p${i}`)}`;
                params[p.name] = applyAllPlaceholders(resolveValue(p.value, args[aiKey]), crmValues, stepResults);
            });

            // Headers
            const headers: Record<string, string> = {};
            (tpl.headers || []).forEach((h, i) => {
                if (!h.name) return;
                const aiKey = `header_${sanitizeName(h.name, `h${i}`)}`;
                headers[h.name] = applyAllPlaceholders(resolveValue(h.value, args[aiKey]), crmValues, stepResults);
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
                    obj[b.name] = applyAllPlaceholders(resolveValue(b.value, args[aiKey]), crmValues, stepResults);
                });
                data = obj;
                if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
            } else if (tpl.bodyType === 'raw' && tpl.rawBody) {
                const rawBodyResolved = tpl.rawBody.mode === 'fixed' ? tpl.rawBody.value : (args.body || '');
                data = applyAllPlaceholders(rawBodyResolved, crmValues, stepResults);
            }

            const finalUrl = Object.keys(params).length
                ? `${url}${url.includes('?') ? '&' : '?'}${new URLSearchParams(params).toString()}`
                : url;
            const t0 = Date.now();
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
            return {
                request: {
                    mode: 'form',
                    method: tpl.method,
                    url: finalUrl,
                    headers: redactHeadersForDisplay(headers),
                    body: data ?? null,
                },
                status: res.status,
                data: responseData,
                durationMs: Date.now() - t0,
            };
        } catch (err: any) {
            return { error: err.message, code: err.code };
        }
    };
}

export function buildHttpTools(httpTools: HttpToolTemplate[] = [], ctx?: HttpCtx) {
    const tools: Record<string, any> = {};
    const usedNames = new Set<string>();
    // Shared across this batch of HTTP tools — every executor reads
    // it for {{prev:...}} substitution and writes its own result back
    // under the (sanitized) tool name. Lives for one agent turn since
    // buildHttpTools is called fresh per handleIncomingMessage.
    const stepResults: Record<string, any> = {};

    (httpTools || []).forEach((tpl, idx) => {
        if (!tpl || !tpl.method || !tpl.url) return;
        let toolName = sanitizeName(tpl.name, `httpTool${idx + 1}`);
        let suffix = 1;
        while (usedNames.has(toolName)) { toolName = `${toolName}_${suffix++}`; }
        usedNames.add(toolName);

        const baseExecutor = buildTemplateExecutor(tpl, ctx, stepResults);
        const recordingExecutor = async (args: Record<string, any>) => {
            const result = await baseExecutor(args);
            stepResults[toolName] = result;
            return result;
        };

        tools[toolName] = makeTool(
            tpl.description || `Call ${toolName}`,
            buildTemplateSchema(tpl),
            recordingExecutor
        );
    });

    return tools;
}

// ─── Provider-aware caching helper ───
// Anthropic needs explicit cache_control markers; OpenAI auto-caches matching
// prefixes ≥1024 tokens with no code change; Gemini has no support here yet.
export function applyAnthropicCacheControl(provider: string, messages: any[]): any[] {
    if (provider !== 'CLAUDE' || messages.length === 0) return messages;
    // Mark the last message as a cache breakpoint. Everything before it
    // (system prompt + tool defs + earlier history) becomes the cached prefix.
    const last = messages[messages.length - 1];
    return [
        ...messages.slice(0, -1),
        {
            ...last,
            providerOptions: {
                ...(last.providerOptions || {}),
                anthropic: {
                    ...((last.providerOptions || {}).anthropic || {}),
                    cacheControl: { type: 'ephemeral' }
                }
            }
        }
    ];
}

export type CacheUsage = { cachedTokens: number; cacheCreationTokens: number };
export function extractCacheUsage(provider: string, result: any): CacheUsage {
    const usage = (result?.usage || {}) as any;
    if (provider === 'CLAUDE') {
        const pm = (result?.providerMetadata?.anthropic || {}) as any;
        return {
            cachedTokens: Number(pm.cacheReadInputTokens || usage.cacheReadInputTokens || 0),
            cacheCreationTokens: Number(pm.cacheCreationInputTokens || usage.cacheCreationInputTokens || 0)
        };
    }
    if (provider === 'OPENAI') {
        const pm = (result?.providerMetadata?.openai || {}) as any;
        return {
            cachedTokens: Number(pm.cachedPromptTokens || usage.cachedInputTokens || 0),
            cacheCreationTokens: 0
        };
    }
    return { cachedTokens: 0, cacheCreationTokens: 0 };
}

// ─── SKILL: Conversation Memory ───
// Lets the agent look back through prior messages on demand rather than
// re-feeding all history every turn.
export function buildMemoryTools(agentId: string, remoteJid: string) {
    return {
        conversationStats: makeTool(
            'Get statistics about prior messages in this conversation (total turns, date range). Call when the user references earlier topics or you need to decide how far back to look.',
            z.object({ reason: z.string().optional().describe('Brief reason for checking') }),
            async () => {
                const count = await prisma.aiConversationLog.count({ where: { agentId, remoteJid } });
                if (count === 0) return { totalTurns: 0, totalMessages: 0 };
                const [first, last] = await Promise.all([
                    prisma.aiConversationLog.findFirst({ where: { agentId, remoteJid }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
                    prisma.aiConversationLog.findFirst({ where: { agentId, remoteJid }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
                ]);
                return {
                    totalTurns: count,
                    totalMessages: count * 2,
                    firstAt: first?.createdAt,
                    lastAt: last?.createdAt
                };
            }
        ),
        searchMessages: makeTool(
            'Search prior messages by keyword (case-insensitive partial match). Returns matching messages with their turn index.',
            z.object({
                query: z.string().describe('Search text'),
                limit: z.number().optional().describe('Max results (default 10, max 20)')
            }),
            async ({ query, limit }) => {
                const lim = Math.min(limit || 10, 20);
                const all = await prisma.aiConversationLog.findMany({
                    where: { agentId, remoteJid },
                    orderBy: { createdAt: 'asc' },
                    select: { userMessage: true, agentReply: true, createdAt: true }
                });
                const q = (query || '').toLowerCase();
                if (!q) return { results: [], totalMatches: 0 };
                const matches: any[] = [];
                all.forEach((log, i) => {
                    if (log.userMessage?.toLowerCase().includes(q)) {
                        matches.push({ idx: i + 1, role: 'user', content: log.userMessage, at: log.createdAt });
                    }
                    if (log.agentReply?.toLowerCase().includes(q)) {
                        matches.push({ idx: i + 1, role: 'assistant', content: log.agentReply, at: log.createdAt });
                    }
                });
                return { results: matches.slice(0, lim), totalMatches: matches.length };
            }
        ),
        getMessages: makeTool(
            'Fetch a specific range of past turns by index (1 = oldest). Each turn returns the user message AND the assistant reply. Max 20 turns per call.',
            z.object({
                from: z.number().describe('Start turn index (1-based, oldest first)'),
                to: z.number().describe('End turn index (inclusive)')
            }),
            async ({ from, to }) => {
                const skip = Math.max(0, (from || 1) - 1);
                const take = Math.max(1, Math.min((to || from) - (from || 1) + 1, 20));
                const logs = await prisma.aiConversationLog.findMany({
                    where: { agentId, remoteJid },
                    orderBy: { createdAt: 'asc' },
                    skip,
                    take,
                    select: { userMessage: true, agentReply: true, createdAt: true }
                });
                return {
                    messages: logs.flatMap((log, i) => [
                        { idx: skip + i + 1, role: 'user', content: log.userMessage, at: log.createdAt },
                        { idx: skip + i + 1, role: 'assistant', content: log.agentReply, at: log.createdAt }
                    ])
                };
            }
        ),
        getMessagesAround: makeTool(
            'Get a few turns of context around a specific turn index (useful after searchMessages found a match). Returns "before" + the turn + "after".',
            z.object({
                idx: z.number().describe('Center turn index'),
                before: z.number().optional().describe('Turns before (default 2)'),
                after: z.number().optional().describe('Turns after (default 2)')
            }),
            async ({ idx, before, after }) => {
                const b = before ?? 2;
                const a = after ?? 2;
                const from = Math.max(1, idx - b);
                const to = idx + a;
                const skip = from - 1;
                const take = Math.min(to - from + 1, 20);
                const logs = await prisma.aiConversationLog.findMany({
                    where: { agentId, remoteJid },
                    orderBy: { createdAt: 'asc' },
                    skip,
                    take,
                    select: { userMessage: true, agentReply: true, createdAt: true }
                });
                return {
                    messages: logs.flatMap((log, i) => [
                        { idx: from + i, role: 'user', content: log.userMessage, at: log.createdAt },
                        { idx: from + i, role: 'assistant', content: log.agentReply, at: log.createdAt }
                    ])
                };
            }
        )
    };
}

// ─── Skill Registry ───
export const DEFAULT_SKILL_PROMPTS: Record<string, string> = {
    tables: 'You have access to data tables. Use listTables first, then searchTable or getTableRows.',
    crm: 'You can manage clients in the CRM. Use upsertClient to save/update contacts, getClient to look up, searchClients to find existing clients.',
    user_fields: 'You can read and write user-defined custom fields on the contact you are chatting with. Use listUserFields first to learn what fields exist (key + type), then setUserField to save things you learn from the conversation (age, city, purpose, budget, etc.) and getUserField when you need to recall a stored value. Use searchContactsByField when the human asks for filtering across contacts.',
    http: 'You can call external HTTP APIs via the dedicated tools listed below.',
    memory: 'You have memory tools to recall earlier parts of this conversation: conversationStats (overview), searchMessages (keyword search), getMessages (fetch a range by index), getMessagesAround (context around a match). Only call them when the user references earlier topics, contradicts something they said before, or you need older context. For simple greetings or new topics, do not call them.',
};

function resolveSkillPrompt(skillId: string, skillPrompts?: Record<string, string>): string {
    const custom = skillPrompts?.[skillId];
    if (custom && custom.trim().length > 0) return custom;
    return DEFAULT_SKILL_PROMPTS[skillId] || '';
}

export function buildToolsForSkills(
    skills: string[],
    allowedTableIds: string[],
    userId: string,
    workspaceId: string,
    httpTools: HttpToolTemplate[] = [],
    agentId: string = '',
    remoteJid: string = '',
    skillPrompts: Record<string, string> = {}
) {
    let tools: Record<string, any> = {};
    let prompts: string[] = [];

    if (skills.includes('tables') && allowedTableIds.length > 0) {
        tools = { ...tools, ...buildTableTools(allowedTableIds) };
        prompts.push(resolveSkillPrompt('tables', skillPrompts));
    }

    if (skills.includes('crm')) {
        tools = { ...tools, ...buildCrmTools(workspaceId, userId) };
        prompts.push(resolveSkillPrompt('crm', skillPrompts));
    }

    if (skills.includes('user_fields') && remoteJid) {
        // For WA the phone is the digits before @s.whatsapp.net; for IG it's
        // the IGSID. upsertCrmContact + buildCrmTools normalise both to digits.
        const contactPhone = remoteJid.replace(/[^0-9]/g, '') || remoteJid;
        tools = { ...tools, ...buildUserFieldTools(workspaceId, userId, contactPhone) };
        prompts.push(resolveSkillPrompt('user_fields', skillPrompts));
    }

    if (skills.includes('memory') && agentId && remoteJid) {
        tools = { ...tools, ...buildMemoryTools(agentId, remoteJid) };
        prompts.push(resolveSkillPrompt('memory', skillPrompts));
    }

    if (skills.includes('http') && httpTools && httpTools.length > 0) {
        const contactPhone = remoteJid ? (remoteJid.replace(/[^0-9]/g, '') || remoteJid) : undefined;
        tools = { ...tools, ...buildHttpTools(httpTools, { workspaceId, contactPhone }) };
        const list = httpTools
            .map((t, i) => `- ${sanitizeName(t.name, `httpTool${i + 1}`)}: ${t.description || ''}`)
            .join('\n');
        prompts.push(resolveSkillPrompt('http', skillPrompts) + '\n' + list);
    }

    return { tools: Object.keys(tools).length > 0 ? tools : undefined, skillPrompt: prompts.length > 0 ? '\n\n' + prompts.join('\n\n') : '' };
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
            if (!instance) return;

            // Run automations first — a matching trigger skips the default agent reply
            const lastInbound = await prisma.message.findFirst({
                where: { instanceId, remoteJid, isFromMe: false },
                orderBy: { timestamp: 'desc' }
            });
            const triggerText = lastInbound?.content || '';
            const inboundCount = await prisma.message.count({
                where: { instanceId, remoteJid, isFromMe: false }
            });
            const waPhone = remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '');
            const waContact = await prisma.contact.findFirst({ where: { instanceId, remoteJid } });
            const autoResult = await AutomationEngine.handleMessage({
                userId: instance.userId,
                channel: 'whatsapp',
                text: triggerText,
                contactId: remoteJid,
                contactName: waContact?.pushName || waContact?.name || undefined,
                isNewContact: inboundCount <= 1,
                source: 'dm',
                instanceId,
                sendMessage: async (t) => { await sock.sendMessage(remoteJid, { text: t }); },
                sendMedia: async (p) => {
                    // Map MediaPayload → Baileys message shape
                    let msg: any;
                    if (p.kind === 'image') msg = { image: { url: p.url }, caption: p.caption || undefined };
                    else if (p.kind === 'video') msg = { video: { url: p.url }, caption: p.caption || undefined };
                    else if (p.kind === 'audio') msg = { audio: { url: p.url }, mimetype: p.mimetype || 'audio/mp4', ptt: false };
                    else msg = {
                        document: { url: p.url },
                        mimetype: p.mimetype || 'application/octet-stream',
                        fileName: p.filename || (p.url.split('/').pop() || 'file'),
                        caption: p.caption || undefined,
                    };
                    await sock.sendMessage(remoteJid, msg);
                },
                addTag: async (tag) => {
                    const existing = await prisma.client.findUnique({
                        where: { userId_phone: { userId: instance.userId, phone: waPhone } }
                    }).catch(() => null);
                    const tags = Array.from(new Set([...(existing?.tags || []), tag]));
                    await prisma.client.upsert({
                        where: { userId_phone: { userId: instance.userId, phone: waPhone } },
                        update: { tags },
                        create: { userId: instance.userId, phone: waPhone, tags, status: 'NEW' }
                    });
                },
                setUserField: async (key, value) => {
                    const existing = await prisma.client.findUnique({
                        where: { userId_phone: { userId: instance.userId, phone: waPhone } }
                    }).catch(() => null);
                    const merged = { ...((existing?.customFields as Record<string, any>) || {}), [key]: value };
                    await prisma.client.upsert({
                        where: { userId_phone: { userId: instance.userId, phone: waPhone } },
                        update: { customFields: merged },
                        create: { userId: instance.userId, phone: waPhone, status: 'NEW', tags: [], customFields: merged }
                    });
                }
            });
            if (autoResult.matched) {
                logger.info(`[${instanceId}] message handled by automation`);
                return;
            }

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

            // Fetch chat history (short window — agent uses memory tools for older context when needed)
            const skills = (agent as any).skills || [];
            const historyDepth = skills.includes('memory') ? 3 : 10;
            const history = await prisma.message.findMany({
                where: { instanceId, remoteJid },
                orderBy: { timestamp: 'desc' },
                take: historyDepth
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
            // Instance carries workspaceId after migration; fall back to the
            // agent owner's personal workspace for safety.
            const inst = await prisma.instance.findUnique({ where: { id: instanceId }, select: { workspaceId: true } });
            const wsId = inst?.workspaceId
                || (await (await import('../../lib/workspace-migration')).getOrCreatePersonalWorkspace(agent.userId));

            const client = await prisma.client.findFirst({
                where: { workspaceId: wsId, phone }
            }).catch(() => null);

            // Per-contact pause: messages keep flowing into the message table
            // (so the next time the agent unpauses it has full history via
            // memory tools), but no auto-reply is generated.
            if (client?.agentPaused) {
                logger.info(`[${instanceId}] Agent paused for ${phone} — skipping reply`);
                return;
            }

            const contactName = client?.name || contact?.pushName || contact?.name || null;
            const contactContext = `\n\nCurrent contact info:\n- Phone: ${phone}${contactName ? `\n- Name: ${contactName}` : ''}${client?.status ? `\n- CRM Status: ${client.status}` : ''}${client?.tags?.length ? `\n- Tags: ${client.tags.join(', ')}` : ''}${client?.summary ? `\n- Summary: ${client.summary}` : ''}\nYou already have this info — do NOT ask the customer for their phone number or name.`;

            // Build tools based on agent skills
            const httpTools = (((agent as any).httpTools) || []) as HttpToolTemplate[];
            const skillPrompts = (((agent as any).skillPrompts) || {}) as Record<string, string>;
            const { tools, skillPrompt } = buildToolsForSkills(
                skills, agent.allowedTableIds, agent.userId, wsId, httpTools,
                agent.id, remoteJid, skillPrompts
            );

            const systemPrompt = (agent.systemPrompt || 'You are a helpful WhatsApp assistant.') + contactContext + skillPrompt;

            // Generate AI response
            const t0 = Date.now();
            const result = await generateText({
                model: aiModel,
                system: systemPrompt,
                messages: applyAnthropicCacheControl(providerInfo.provider, messages),
                ...(tools ? { tools, stopWhen: stepCountIs(5) } : {}),
            } as any);
            const durationMs = Date.now() - t0;

            const text = result.text;
            if (!text) return;

            const cacheUsage = extractCacheUsage(providerInfo.provider, result);

            // Lightweight version saved to AiConversationLog (memory) — just
            // the name + args; this is what the agent re-reads as context
            // for future turns, so it stays small.
            const extractedToolCalls = (result.steps || []).flatMap((step: any) =>
                (step.toolCalls || []).map((tc: any) => ({
                    toolName: tc.toolName,
                    args: tc.args,
                }))
            );

            // Rich version saved to AgentActivityLog (3-day human inspection
            // log) — includes results, redacted args, error flags.
            const richToolCalls = extractRichToolCalls(result.steps as any[]);

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
            const userMessageStr = typeof lastUserMsg === 'string' ? lastUserMsg : JSON.stringify(lastUserMsg);
            await prisma.aiConversationLog.create({
                data: {
                    agentId: agent.id, instanceId, remoteJid,
                    userMessage: userMessageStr,
                    agentReply: text,
                    promptTokens: (result as any).usage?.inputTokens || 0,
                    completionTokens: (result as any).usage?.outputTokens || 0,
                    totalTokens: ((result as any).usage?.inputTokens || 0) + ((result as any).usage?.outputTokens || 0),
                    cachedTokens: cacheUsage.cachedTokens,
                    cacheCreationTokens: cacheUsage.cacheCreationTokens,
                    provider: providerInfo.provider, model: agent.model,
                    toolCalls: extractedToolCalls,
                }
            });

            // 3-day human-inspection log (Activity tab on the Agent page).
            prisma.agentActivityLog.create({
                data: {
                    agentId: agent.id, workspaceId: wsId,
                    instanceId, remoteJid,
                    contactPhone: phone, contactName,
                    channel: 'whatsapp',
                    userMessage: userMessageStr,
                    agentReply: text,
                    toolCalls: richToolCalls,
                    durationMs,
                }
            }).catch(err => logger.warn({ err: err.message }, `[${instanceId}] AgentActivityLog write failed`));

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

    // Ephemeral "Test as contact" turn used by the Agent → Test tab.
    // Reads the contact's prior real history for context, runs the
    // same prompt/tool stack as the live handler, but writes NOTHING
    // back to the DB. Destructive CRM tools are stubbed via
    // wrapToolsForDryRun; HTTP tools fire for real so external
    // integrations (Bitrix etc.) can be validated.
    static async runTestTurn(opts: {
        agent: any;
        workspaceId: string;
        contactPhone: string;
        sessionMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
        userMessage: string;
    }): Promise<{ reply: string; toolCalls: any[]; tokens: { prompt: number; completion: number; total: number } }> {
        const { agent, workspaceId, contactPhone, sessionMessages, userMessage } = opts;
        const providerInfo = agent.provider;

        // Pick AI model — same switch as the live handler
        let aiModel: any;
        if (providerInfo.provider === 'OPENAI') {
            aiModel = createOpenAI({ apiKey: providerInfo.apiKey } as any).chat(agent.model);
        } else if (providerInfo.provider === 'CLAUDE') {
            aiModel = createAnthropic({ apiKey: providerInfo.apiKey })(agent.model);
        } else if (providerInfo.provider === 'GEMINI') {
            aiModel = createGoogleGenerativeAI({ apiKey: providerInfo.apiKey })(agent.model);
        } else {
            throw new Error(`Unknown AI Provider: ${providerInfo.provider}`);
        }

        // Look up real CRM record for contact context (read-only)
        const cleanPhone = contactPhone.replace(/[^0-9]/g, '') || contactPhone;
        const client = await prisma.client.findFirst({ where: { workspaceId, phone: cleanPhone } });
        const contactName = client?.name || null;
        const contactContext = `\n\nCurrent contact info:\n- Phone: ${cleanPhone}${contactName ? `\n- Name: ${contactName}` : ''}${client?.status ? `\n- CRM Status: ${client.status}` : ''}${client?.tags?.length ? `\n- Tags: ${client.tags.join(', ')}` : ''}${client?.summary ? `\n- Summary: ${client.summary}` : ''}\nYou already have this info — do NOT ask the customer for their phone number or name.`;

        // Build tools — same as live, then wrap mutators with dry-run
        const skills: string[] = (agent as any).skills || [];
        const httpTools: HttpToolTemplate[] = ((agent as any).httpTools || []) as HttpToolTemplate[];
        const skillPrompts: Record<string, string> = ((agent as any).skillPrompts || {}) as Record<string, string>;
        const fakeRemoteJid = `${cleanPhone}@s.whatsapp.net`;
        const { tools: liveTools, skillPrompt } = buildToolsForSkills(
            skills, agent.allowedTableIds, agent.userId, workspaceId, httpTools,
            agent.id, fakeRemoteJid, skillPrompts
        );
        const tools = wrapToolsForDryRun(liveTools);

        const systemPrompt = (agent.systemPrompt || 'You are a helpful WhatsApp assistant.')
            + contactContext
            + skillPrompt
            + '\n\n[Test session — your replies and tool calls are visible to the operator. Behave normally.]';

        // Read up to 8 prior REAL messages (from any instance for this
        // workspace contact) for context. Memory-skill agents read on
        // demand, so we keep this small.
        let realHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
        if (client) {
            const instances = await prisma.instance.findMany({ where: { workspaceId }, select: { id: true } });
            const instanceIds = instances.map(i => i.id);
            if (instanceIds.length > 0) {
                const rows = await prisma.message.findMany({
                    where: {
                        instanceId: { in: instanceIds },
                        remoteJid: { contains: cleanPhone },
                    },
                    orderBy: { timestamp: 'desc' },
                    take: 8,
                });
                realHistory = rows.reverse().map(r => ({
                    role: (r.isFromMe ? 'assistant' : 'user') as 'assistant' | 'user',
                    content: r.content || '[Unsupported Media]',
                }));
            }
        }

        const messages = [
            ...realHistory,
            ...sessionMessages,
            { role: 'user' as const, content: userMessage },
        ];

        const result = await generateText({
            model: aiModel,
            system: systemPrompt,
            messages: applyAnthropicCacheControl(providerInfo.provider, messages as any),
            ...(tools ? { tools, stopWhen: stepCountIs(5) } : {}),
        } as any);

        const reply = result.text || '';
        const richToolCalls = extractRichToolCalls(result.steps as any[]);

        return {
            reply,
            toolCalls: richToolCalls,
            tokens: {
                prompt: (result as any).usage?.inputTokens || 0,
                completion: (result as any).usage?.outputTokens || 0,
                total: ((result as any).usage?.inputTokens || 0) + ((result as any).usage?.outputTokens || 0),
            },
        };
    }
}

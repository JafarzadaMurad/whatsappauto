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
            // Args used to live on `tc.args`; newer AI SDK versions moved them
            // to `tc.input`. Try both so the inspector always shows what the
            // model actually passed.
            const rawArgs = tc.args ?? tc.input ?? tc.parameters ?? null;
            const hasErrorField = rawResult && typeof rawResult === 'object' && (rawResult as any).error !== undefined;
            return {
                toolName: tc.toolName,
                args: truncateForLog(redactSensitive(rawArgs)),
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
// ─── SKILL: Self-pause ─────────────────────────────────────────
// Lets the agent flip Client.agentPaused = true on the current
// contact when it decides the conversation should be handed over
// to a human (customer became angry, asked for a manager, lead was
// already qualified and sent to CRM, etc). The existing per-contact
// pause check in handleIncomingMessage already honours this flag,
// so paused contacts stop receiving auto-replies until the
// operator unpauses them from the inbox UI.
// ─── Operator-side tools (operator ↔ agent chat) ─────────────────
// These are NOT exposed during a normal customer conversation. They
// are only built and handed to the model inside replyToOperatorQuery,
// where the human on the other end is a teammate, not a buyer. The
// model uses them to forward replies to customers, look up history,
// or answer aggregate questions ("how many leads today?", "list
// people tagged X").
function buildOperatorAgentTools(opts: {
    agentId: string;
    workspaceId: string | null;
    instanceId: string;
    operatorId: string;
}) {
    const { agentId, workspaceId, instanceId, operatorId } = opts;

    return {
        listOpenTickets: makeTool(
            'List THIS operator\'s currently open tickets — the questions the agent has routed to them and is waiting on. Each entry has the 5-char ticket code, the customer (name + JID + phone), the original question, and how long it has been open. Call this before answering so you know which open ticket the operator\'s reply belongs to.',
            z.object({}),
            async () => {
                const open = await prisma.operatorRequest.findMany({
                    where: { operatorId, status: 'open' },
                    orderBy: { sentAt: 'desc' },
                    take: 20,
                    select: { ticket: true, customerJid: true, customerName: true, customerPhone: true, question: true, sentAt: true },
                });
                return {
                    openCount: open.length,
                    tickets: open.map(t => ({
                        ticket: t.ticket,
                        customerJid: t.customerJid,
                        customerName: t.customerName,
                        customerPhone: t.customerPhone,
                        question: t.question,
                        openedAt: t.sentAt,
                    })),
                };
            }
        ),

        answerTicket: makeTool(
            'Mark an open ticket as answered and deliver the answer to the originating customer in their language. Use this when the operator has actually provided the information the customer was waiting for. The "answerForCustomer" you pass is the literal text the customer will receive (polish it on-brand, no greeting, pick up from where the conversation left off). The ticket goes from "open" to "answered". Do NOT use this if the operator asked a clarifying question instead of answering — in that case just reply to the operator with the clarification they need.',
            z.object({
                ticket: z.string().describe('5-char ticket code (e.g. "GNJH5"). Get it from listOpenTickets if unsure.'),
                answerForCustomer: z.string().describe('The polished customer-facing message in the customer\'s own language. No greetings, no mention of "operator"/"manager".'),
            }),
            async ({ ticket, answerForCustomer }) => {
                const code = ticket.toUpperCase().replace(/^\[?REQ-/, '').replace(/\]$/, '');
                const req = await prisma.operatorRequest.findUnique({ where: { ticket: code } });
                if (!req) return { success: false, error: `No ticket found for code "${code}".` };
                if (req.operatorId !== operatorId) return { success: false, error: 'This ticket belongs to a different operator.' };
                if (req.status !== 'open') return { success: false, error: `Ticket ${code} is already ${req.status}.` };

                // Persist the answer text the operator effectively gave
                // (the model's polished version, in this case).
                const updated = await prisma.operatorRequest.update({
                    where: { id: req.id },
                    data: { answer: answerForCustomer, status: 'answered', answeredAt: new Date() },
                });

                try {
                    const { sessions } = await import('../whatsapp/instance.manager');
                    const { io } = await import('../../server');
                    const sock = sessions.get(req.instanceId);
                    if (!sock) return { success: false, error: 'Customer\'s instance is not connected.' };

                    await sock.sendMessage(req.customerJid, { text: answerForCustomer });
                    const saved = await prisma.message.create({
                        data: {
                            instanceId: req.instanceId,
                            remoteJid: req.customerJid,
                            isFromMe: true, messageType: 'text',
                            content: answerForCustomer, timestamp: new Date(),
                        },
                    });
                    await prisma.aiConversationLog.create({
                        data: {
                            agentId, instanceId: req.instanceId, remoteJid: req.customerJid,
                            userMessage: '', agentReply: answerForCustomer,
                            promptTokens: 0, completionTokens: 0, totalTokens: 0,
                            provider: 'OPERATOR', model: 'manual',
                            toolCalls: [],
                        },
                    }).catch(() => {});
                    io.emit(`message.new-${req.instanceId}`, {
                        id: saved.id, isFromMe: true, content: answerForCustomer,
                        remoteJid: req.customerJid, status: 'DELIVERED',
                        timestamp: new Date().toISOString(),
                    });
                    return {
                        success: true, ticket: code,
                        customer: { jid: req.customerJid, name: updated.customerName, phone: updated.customerPhone },
                        sentLength: answerForCustomer.length,
                    };
                } catch (e: any) {
                    return { success: false, error: e.message };
                }
            }
        ),

        sendToCustomer: makeTool(
            'Send a polished WhatsApp message to a specific customer. Use whenever the operator instructs you to message someone ("send X to client", "tell Cəfərzadə that…", or quotes a customer message). The message you pass is what the customer literally receives — polish it on-brand and in the customer\'s own language. The customer must be someone we already have history with on this instance (anti-spam guard).',
            z.object({
                customerJid: z.string().describe('Customer WhatsApp JID, e.g. "994555348024@s.whatsapp.net". Look it up via listRecentCustomers / searchCustomers if you don\'t have it.'),
                message: z.string().describe('The polished, customer-facing text in the customer\'s language.'),
            }),
            async ({ customerJid, message }) => {
                const known = await prisma.message.findFirst({
                    where: { instanceId, remoteJid: customerJid },
                    select: { id: true },
                });
                if (!known) {
                    return { success: false, error: 'No prior conversation with this JID on this instance — refusing to message a stranger.' };
                }
                try {
                    const { sessions } = await import('../whatsapp/instance.manager');
                    const { io } = await import('../../server');
                    const sock = sessions.get(instanceId);
                    if (!sock) return { success: false, error: 'Instance not connected' };

                    await sock.sendMessage(customerJid, { text: message });
                    const saved = await prisma.message.create({
                        data: {
                            instanceId, remoteJid: customerJid,
                            isFromMe: true, messageType: 'text',
                            content: message, timestamp: new Date(),
                        },
                    });
                    // Mirror into the agent's conversation memory so the
                    // next customer turn knows what the bot already said.
                    await prisma.aiConversationLog.create({
                        data: {
                            agentId, instanceId, remoteJid: customerJid,
                            userMessage: '', agentReply: message,
                            promptTokens: 0, completionTokens: 0, totalTokens: 0,
                            provider: 'OPERATOR', model: 'manual',
                            toolCalls: [],
                        },
                    }).catch(() => {});
                    io.emit(`message.new-${instanceId}`, {
                        id: saved.id, isFromMe: true, content: message,
                        remoteJid: customerJid, status: 'DELIVERED',
                        timestamp: new Date().toISOString(),
                    });
                    return { success: true, sentTo: customerJid, length: message.length };
                } catch (e: any) {
                    return { success: false, error: e.message };
                }
            }
        ),

        listRecentCustomers: makeTool(
            'List customers who exchanged messages with this instance recently. Returns name, phone, last activity timestamp, last message preview and total messages in the window.',
            z.object({
                hoursBack: z.number().optional().describe('How many hours back to look. Default 24.'),
                limit: z.number().optional().describe('Max entries. Default 25, hard cap 100.'),
            }),
            async ({ hoursBack, limit }) => {
                const hours = Math.max(1, Math.min(720, hoursBack ?? 24));
                const max = Math.max(1, Math.min(100, limit ?? 25));
                const since = new Date(Date.now() - hours * 3600 * 1000);
                const rows = await prisma.message.findMany({
                    where: { instanceId, timestamp: { gte: since } },
                    orderBy: { timestamp: 'desc' },
                    select: { remoteJid: true, timestamp: true, content: true, isFromMe: true },
                    take: 1000,
                });
                const byJid = new Map<string, { lastTs: Date; lastContent: string; count: number; lastFromMe: boolean; }>();
                for (const r of rows) {
                    const cur = byJid.get(r.remoteJid);
                    if (!cur) {
                        byJid.set(r.remoteJid, { lastTs: r.timestamp, lastContent: r.content || '', count: 1, lastFromMe: r.isFromMe });
                    } else {
                        cur.count++;
                    }
                }
                const jids = Array.from(byJid.keys()).slice(0, max);
                const contacts = jids.length
                    ? await prisma.contact.findMany({
                        where: { instanceId, remoteJid: { in: jids } },
                        select: { remoteJid: true, name: true, pushName: true },
                    })
                    : [];
                const nameByJid = new Map<string, string>();
                for (const c of contacts) nameByJid.set(c.remoteJid, c.name || c.pushName || '');
                return {
                    customers: jids.map(jid => {
                        const s = byJid.get(jid)!;
                        return {
                            customerJid: jid,
                            phone: jid.replace('@s.whatsapp.net', '').replace('@lid', ''),
                            name: nameByJid.get(jid) || null,
                            lastActivity: s.lastTs,
                            lastMessage: s.lastContent.slice(0, 120),
                            lastFromMe: s.lastFromMe,
                            messages: s.count,
                        };
                    }),
                };
            }
        ),

        getCustomerHistory: makeTool(
            'Read the last N messages of the conversation with a specific customer. Useful when the operator asks "what did X say earlier".',
            z.object({
                customerJid: z.string(),
                limit: z.number().optional().describe('Default 20, hard cap 100.'),
            }),
            async ({ customerJid, limit }) => {
                const max = Math.max(1, Math.min(100, limit ?? 20));
                const rows = await prisma.message.findMany({
                    where: { instanceId, remoteJid: customerJid },
                    orderBy: { timestamp: 'desc' },
                    take: max,
                    select: { isFromMe: true, content: true, timestamp: true },
                });
                rows.reverse();
                return {
                    customerJid,
                    messages: rows.map(r => ({
                        from: r.isFromMe ? 'agent' : 'customer',
                        text: r.content,
                        at: r.timestamp,
                    })),
                };
            }
        ),

        searchCustomers: makeTool(
            'Find clients across the workspace by name fragment, phone digits or exact tag. Returns up to 30 matches.',
            z.object({
                query: z.string().describe('Name fragment, phone digits, or a tag name.'),
            }),
            async ({ query }) => {
                if (!workspaceId) return { clients: [] };
                const q = query.trim();
                const digits = q.replace(/[^0-9]/g, '');
                const clients = await prisma.client.findMany({
                    where: {
                        workspaceId,
                        OR: [
                            { name: { contains: q, mode: 'insensitive' } },
                            ...(digits ? [{ phone: { contains: digits } }] : []),
                            { tags: { has: q } },
                        ],
                    },
                    select: { id: true, name: true, phone: true, tags: true, status: true, summary: true, isAnonymous: true, updatedAt: true },
                    take: 30,
                    orderBy: { updatedAt: 'desc' },
                });
                return {
                    clients: clients.map(c => ({
                        ...c,
                        customerJid: c.isAnonymous ? `${c.phone}@lid` : `${c.phone}@s.whatsapp.net`,
                    })),
                };
            }
        ),

        getCustomerStats: makeTool(
            'Aggregate stats for the current instance + workspace: unique customers that messaged in the window, inbound vs outbound counts, clients by status, clients by tag.',
            z.object({
                fromDate: z.string().optional().describe('ISO date like "2026-06-16". Defaults to start of today (UTC).'),
            }),
            async ({ fromDate }) => {
                const since = fromDate ? new Date(fromDate) : new Date(new Date().toISOString().slice(0, 10));
                const grouped = await prisma.message.groupBy({
                    by: ['remoteJid'],
                    where: { instanceId, timestamp: { gte: since }, isFromMe: false },
                });
                const msgCounts = await prisma.message.groupBy({
                    by: ['isFromMe'],
                    where: { instanceId, timestamp: { gte: since } },
                    _count: { _all: true },
                });
                const inCount = msgCounts.find(m => !m.isFromMe)?._count._all || 0;
                const outCount = msgCounts.find(m => m.isFromMe)?._count._all || 0;
                let byStatus: Record<string, number> = {};
                let byTag: Record<string, number> = {};
                if (workspaceId) {
                    const clients = await prisma.client.findMany({
                        where: { workspaceId, updatedAt: { gte: since } },
                        select: { status: true, tags: true },
                    });
                    for (const c of clients) {
                        byStatus[c.status] = (byStatus[c.status] || 0) + 1;
                        for (const t of c.tags) byTag[t] = (byTag[t] || 0) + 1;
                    }
                }
                return {
                    since,
                    uniqueCustomersInWindow: grouped.length,
                    messagesIn: inCount,
                    messagesOut: outCount,
                    clientsTouchedInWindow: Object.values(byStatus).reduce((a, b) => a + b, 0),
                    byStatus, byTag,
                };
            }
        ),

        getCustomersByTag: makeTool(
            'List clients carrying a specific tag (up to 50, newest first).',
            z.object({ tag: z.string() }),
            async ({ tag }) => {
                if (!workspaceId) return { tag, count: 0, clients: [] };
                const clients = await prisma.client.findMany({
                    where: { workspaceId, tags: { has: tag } },
                    select: { id: true, name: true, phone: true, status: true, tags: true, summary: true, isAnonymous: true, updatedAt: true },
                    orderBy: { updatedAt: 'desc' },
                    take: 50,
                });
                return {
                    tag, count: clients.length,
                    clients: clients.map(c => ({
                        ...c,
                        customerJid: c.isAnonymous ? `${c.phone}@lid` : `${c.phone}@s.whatsapp.net`,
                    })),
                };
            }
        ),
    };
}

function buildSelfPauseTool(workspaceId: string, userId: string, contactPhone: string) {
    return {
        pauseAgent: makeTool(
            'Pause yourself for the CURRENT contact. After calling this you will no longer auto-reply to their messages — a human operator will take over. Only call when handover is appropriate (handoff to manager done, customer explicitly asked for a human, customer is angry, off-topic spam). Cannot be undone by the agent; only a human un-pauses.',
            z.object({
                reason: z.string().describe('Short reason for the pause, in English. Saved for the operator. Example: "Lead qualified and sent to Bitrix" / "Customer asked to speak with a person" / "Customer is frustrated".'),
            }),
            async ({ reason }) => {
                const cleanPhone = contactPhone.replace(/[^0-9]/g, '') || contactPhone;
                const existing = await prisma.client.findFirst({
                    where: { workspaceId, phone: cleanPhone },
                    select: { id: true, summary: true },
                });
                const pauseNote = `[paused by agent: ${reason.slice(0, 200)}]`;
                if (existing) {
                    await prisma.client.update({
                        where: { id: existing.id },
                        data: {
                            agentPaused: true,
                            pausedAt: new Date(),
                            // Append a short audit trail to the summary so the
                            // operator opening the inbox sees why the agent
                            // stepped back.
                            summary: existing.summary ? `${existing.summary}\n${pauseNote}` : pauseNote,
                        },
                    });
                    return { success: true, paused: true, clientId: existing.id };
                }
                const created = await prisma.client.create({
                    data: {
                        userId, workspaceId, phone: cleanPhone,
                        status: 'NEW', tags: [],
                        agentPaused: true,
                        pausedAt: new Date(),
                        summary: pauseNote,
                    },
                });
                return { success: true, paused: true, clientId: created.id };
            }
        ),
    };
}

// ─── SKILL: Live operator ─────────────────────────────────────
// askOperator routes a question to a human teammate via WhatsApp.
// listOperators returns the team so the model can decide who to ask
// (each operator has a name + role/prompt). The agent stays in
// dialogue with the customer while the operator handles the request;
// when the operator answers, the routing logic delivers a polished
// reply back to the customer automatically (see operator.service +
// AiService.composeCustomerReplyFromOperator).
function buildLiveOperatorTools(agentId: string, instanceId: string, customerJid: string, customerName: string | null, customerPhone: string | null, workspaceId: string | null) {
    return {
        listOperators: makeTool(
            'List the live operators (human teammates) available for this agent. Returns their id, name and role description. Call this before askOperator if you need to pick who to ask.',
            z.object({}),
            async () => {
                const ops = await prisma.operator.findMany({
                    where: { agentId, isActive: true },
                    orderBy: { order: 'asc' },
                    select: { id: true, name: true, systemPrompt: true, order: true },
                });
                return { operators: ops.map(o => ({ id: o.id, name: o.name, role: o.systemPrompt || '', order: o.order })) };
            }
        ),
        askOperator: makeTool(
            'Send a question to a human operator over WhatsApp and continue chatting with the customer. The operator\'s reply is automatically delivered back to the customer by the system — you do NOT wait. Use this when the customer asks something only a human can answer (current pricing, special approvals, stock checks, exceptions). After calling this, tell the customer something like "let me check and get back to you in a moment".',
            z.object({
                operatorId: z.string().describe('Operator id from listOperators. If unsure pick the first one (lowest order).'),
                question: z.string().describe('Full question for the operator, in their working language. Include enough customer context that the operator can answer without asking you back.'),
            }),
            async ({ operatorId, question }) => {
                const { createOperatorRequest } = await import('../operator/operator.service');
                const result = await createOperatorRequest({
                    agentId, workspaceId,
                    instanceId,
                    operatorId,
                    customerJid,
                    customerName,
                    customerPhone,
                    question,
                });
                if (!result.ok) return { success: false, error: result.error };
                return {
                    success: true,
                    ticket: result.ticket,
                    operatorName: result.operatorName,
                    delivered: result.delivered,
                    timeoutAt: result.timeoutAt,
                };
            }
        ),
    };
}

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
                // Reject keys with anything other than [a-zA-Z0-9_] so the
                // raw jsonb_set path can't be abused for SQL injection.
                if (!/^[A-Za-z0-9_]+$/.test(key)) {
                    return { success: false, error: 'Invalid field key. Use letters, digits and underscores only.' };
                }

                // Ensure a Client row exists; capture its id.
                const existing = await prisma.client.findFirst({
                    where: { workspaceId, phone: cleanPhone },
                    select: { id: true },
                });
                let clientId: string;
                if (existing) {
                    clientId = existing.id;
                } else {
                    const created = await prisma.client.create({
                        data: { userId, workspaceId, phone: cleanPhone, status: 'NEW', tags: [], customFields: {} },
                    });
                    clientId = created.id;
                }

                // Atomic per-key update. With multiple parallel setUserField
                // calls in the same agent turn the previous read-merge-write
                // pattern raced — each call read the same starting object,
                // merged its key, and wrote back; the last writer won and
                // earlier keys silently disappeared. jsonb_set on a single
                // sub-path is atomic in Postgres, so concurrent calls each
                // touch their own key without clobbering siblings.
                await prisma.$executeRaw`
                    UPDATE "Client"
                    SET "customFields" = jsonb_set(
                        COALESCE("customFields", '{}'::jsonb),
                        ARRAY[${key}]::text[],
                        ${JSON.stringify(value)}::jsonb,
                        true
                    ),
                    "updatedAt" = NOW()
                    WHERE id = ${clientId}
                `;

                return { success: true, key, value, clientId };
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
        // Defensively normalise headers / queryParams / bodyParams. Older
        // tools or templates restored from an external source occasionally
        // store these as plain objects ({Authorization: "Bearer …"})
        // instead of the expected [{name, value:{mode, value}}] array;
        // forEach blows up on the object form and kills the whole agent
        // turn. Treat anything non-array as empty.
        const qParams = Array.isArray(tpl.queryParams) ? tpl.queryParams : [];
        const headersArr = Array.isArray(tpl.headers) ? tpl.headers : [];
        const bodyArr = Array.isArray(tpl.bodyParams) ? tpl.bodyParams : [];
        qParams.forEach((p: any, i: number) => {
            if (p?.value?.mode === 'ai') {
                const key = `query_${sanitizeName(p.name, `p${i}`)}`;
                shape[key] = z.string().describe(p.value.description || `Value for query param "${p.name}"`);
            }
        });
        headersArr.forEach((h: any, i: number) => {
            if (h?.value?.mode === 'ai') {
                const key = `header_${sanitizeName(h.name, `h${i}`)}`;
                shape[key] = z.string().describe(h.value.description || `Value for header "${h.name}"`);
            }
        });
        if (tpl.bodyType === 'json') {
            bodyArr.forEach((b: any, i: number) => {
                if (b?.value?.mode === 'ai') {
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

// ─── Distribution helpers (random + round-robin) ──────────────────
// Use cases: round-robining HTTP tool fields like Bitrix
// ASSIGNED_BY_ID between several sales managers without involving
// the LLM (LLMs are bad at uniform sampling) and without per-template
// configuration. Syntax:
//   {{random:7,9}}          → picks one of the listed values uniformly
//   {{random:foo,bar,baz}}  → strings work too (whitespace trimmed)
//   {{rotate:7,9}}          → cycles through values, sticky per workspace
const RANDOM_PLACEHOLDER_RE = /\{\{\s*random\s*:\s*([^}]+?)\s*\}\}/g;
const ROTATE_PLACEHOLDER_RE = /\{\{\s*rotate\s*:\s*([^}]+?)\s*\}\}/g;

function splitListValues(list: string): string[] {
    return list.split(',').map(s => s.trim()).filter(Boolean);
}

function substituteRandomPlaceholders(text: string): string {
    if (!text || typeof text !== 'string') return text;
    return text.replace(RANDOM_PLACEHOLDER_RE, (_, list: string) => {
        const values = splitListValues(list);
        if (values.length === 0) return '';
        return values[Math.floor(Math.random() * values.length)];
    });
}

// Round-robin state lives in SystemConfig keyed by
// `rotate:<workspaceId>:<comma-joined-values>`. The value is the
// index (as a decimal string) of the NEXT slot to pick. Two callers
// racing on the same key may briefly hand out the same value, but
// over time the distribution evens out and we avoid an extra table
// just for this counter.
async function substituteRotatePlaceholders(text: string, workspaceId?: string): Promise<string> {
    if (!text || typeof text !== 'string') return text;
    // Snapshot every match first because we replace asynchronously.
    const re = new RegExp(ROTATE_PLACEHOLDER_RE.source, 'g');
    const matches: Array<{ full: string; values: string[] }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const values = splitListValues(m[1]);
        if (values.length > 0) matches.push({ full: m[0], values });
    }
    if (matches.length === 0) return text;

    let out = text;
    for (const match of matches) {
        let pick = match.values[0];
        if (workspaceId) {
            const key = `rotate:${workspaceId}:${match.values.join(',')}`;
            try {
                const row = await prisma.systemConfig.findUnique({ where: { key } });
                const idx = row ? (parseInt(row.value, 10) || 0) % match.values.length : 0;
                pick = match.values[idx];
                const nextIdx = (idx + 1) % match.values.length;
                await prisma.systemConfig.upsert({
                    where: { key },
                    update: { value: String(nextIdx) },
                    create: { key, value: String(nextIdx) },
                });
            } catch {
                // If state read/write fails fall back to the first value
                // — better to pick deterministically than blow up the
                // request.
            }
        }
        // Only replace the FIRST occurrence so independent placeholders
        // in the same text each get their own rotation step. We re-search
        // because the index shifts as we replace.
        out = out.replace(match.full, pick);
    }
    return out;
}

async function applyAllPlaceholders(
    text: string,
    crm: { contact: Record<string, string>; field: Record<string, string> },
    stepResults: Record<string, any>,
    ctx?: HttpCtx,
): Promise<string> {
    let t = substituteCrmPlaceholders(text, crm);
    t = substitutePrevPlaceholders(t, stepResults);
    t = substituteRandomPlaceholders(t);
    t = await substituteRotatePlaceholders(t, ctx?.workspaceId);
    return t;
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
                const rawWithCrm = await applyAllPlaceholders(tpl.rawRequest || '', crmValues, stepResults, ctx);
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
            const url = await applyAllPlaceholders(rawUrl, crmValues, stepResults, ctx);
            if (!url) return { error: 'No URL provided' };

            // Defensive normalisation — see comment in buildTemplateSchema.
            const qParams: any[] = Array.isArray(tpl.queryParams) ? tpl.queryParams : [];
            const headerList: any[] = Array.isArray(tpl.headers) ? tpl.headers : [];
            const bodyParamsList: any[] = Array.isArray(tpl.bodyParams) ? tpl.bodyParams : [];

            // Query params
            const params: Record<string, string> = {};
            for (let i = 0; i < qParams.length; i++) {
                const p = qParams[i];
                if (!p?.name) continue;
                const aiKey = `query_${sanitizeName(p.name, `p${i}`)}`;
                params[p.name] = await applyAllPlaceholders(resolveValue(p.value, args[aiKey]), crmValues, stepResults, ctx);
            }

            // Headers
            const headers: Record<string, string> = {};
            for (let i = 0; i < headerList.length; i++) {
                const h = headerList[i];
                if (!h?.name) continue;
                const aiKey = `header_${sanitizeName(h.name, `h${i}`)}`;
                headers[h.name] = await applyAllPlaceholders(resolveValue(h.value, args[aiKey]), crmValues, stepResults, ctx);
            }

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
                for (let i = 0; i < bodyParamsList.length; i++) {
                    const b = bodyParamsList[i];
                    if (!b?.name) continue;
                    const aiKey = `body_${sanitizeName(b.name, `b${i}`)}`;
                    obj[b.name] = await applyAllPlaceholders(resolveValue(b.value, args[aiKey]), crmValues, stepResults, ctx);
                }
                data = obj;
                if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
            } else if (tpl.bodyType === 'raw' && tpl.rawBody) {
                const rawBodyResolved = tpl.rawBody.mode === 'fixed' ? tpl.rawBody.value : (args.body || '');
                data = await applyAllPlaceholders(rawBodyResolved, crmValues, stepResults, ctx);
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
    self_pause: 'You can pause yourself for the current contact via pauseAgent({reason}). After calling this you will NOT auto-reply to this contact again until a human operator un-pauses you from the inbox. Use it only when handover to a human is the right next step: lead is fully qualified and you already pushed it to the CRM, the customer explicitly asked to speak with a person, the customer is angry or off-topic, or any other reason a live agent should take over. Do not pause for trivial reasons — every pause requires an operator to manually resume.',
    reminder: 'You can periodically re-engage idle contacts. A background scheduler picks customers who haven\'t replied for the configured number of hours and invokes a special "reminder turn". When you are in a reminder turn (the latest non-assistant turn will be marked [REMINDER_TURN: customer silent for Xh]) read the conversation, then write ONE short warm message that nudges the customer based on where the conversation left off — never restart the funnel, never repeat your last message verbatim, never apologise for writing again. Stay in the customer\'s language. Keep it conversational, max 2 short sentences.',
    live_operator: 'You can consult human teammates ("operators") for things only they know — pricing, special approvals, stock, exceptions. Use listOperators to see who is available, then askOperator({operatorId, question}) to ping them. The operator\'s reply is delivered to the customer automatically by the system; you do NOT need to wait. After calling askOperator, write a short holding message to the customer ("let me check and get back to you shortly") so they aren\'t left hanging. Only consult operators for genuinely human-needed questions, not for things in your data tables or general FAQ.',
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
    skillPrompts: Record<string, string> = {},
    instanceId: string = '',
    contactName: string | null = null,
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

    if (skills.includes('self_pause') && remoteJid) {
        const contactPhone = remoteJid.replace(/[^0-9]/g, '') || remoteJid;
        tools = { ...tools, ...buildSelfPauseTool(workspaceId, userId, contactPhone) };
        prompts.push(resolveSkillPrompt('self_pause', skillPrompts));
    }

    if (skills.includes('live_operator') && agentId && remoteJid && instanceId) {
        const contactPhone = remoteJid.replace(/[^0-9]/g, '') || remoteJid;
        tools = { ...tools, ...buildLiveOperatorTools(agentId, instanceId, remoteJid, contactName, contactPhone, workspaceId) };
        prompts.push(resolveSkillPrompt('live_operator', skillPrompts));
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

// Builds the router-specific tools: handoffTo (binds the contact to a
// specialised agent) and unassignAgent (releases the binding so future
// messages flow back through the router). Returned alongside a prompt
// block that lists every assignable sibling agent + its
// routerDescription so the model knows when to pick which.
async function buildRouterTools(opts: {
    workspaceId: string;
    currentAgentId: string;
    contactPhone: string;
    allowedAgentIds?: string[];
}): Promise<{ tools: Record<string, any>; prompt: string }> {
    // If the router has an explicit allow-list, narrow to those IDs.
    // Otherwise (empty array) fall back to "any non-router sibling" so
    // routers from before this field existed keep working.
    const where: any = {
        workspaceId: opts.workspaceId,
        isActive: true,
        isRouter: false,
        id: { not: opts.currentAgentId },
    };
    if (opts.allowedAgentIds && opts.allowedAgentIds.length > 0) {
        where.id = { in: opts.allowedAgentIds, not: opts.currentAgentId } as any;
    }
    const siblings = await prisma.agent.findMany({
        where,
        select: { id: true, name: true, routerDescription: true },
        orderBy: { name: 'asc' },
    });
    if (siblings.length === 0) return { tools: {}, prompt: '' };

    const enumIds = siblings.map(s => s.id) as [string, ...string[]];
    const handoffSchema = z.object({
        agentId: z.enum(enumIds).describe('Which specialised agent should take over.'),
        greeting: z.string().optional().describe('Short Azerbaijani / Russian one-liner to send to the customer right before handing off, e.g. "Sizi mütəxəssisə yönəldirəm."'),
    });

    const tools: Record<string, any> = {
        handoffTo: makeTool(
            'BINDS the contact to a specialised agent. This is the ONLY way the customer actually gets routed. If you intend to say "I will connect you to X", you MUST call this tool in the SAME turn — otherwise the customer sees your message but nothing happens and the next message comes back to YOU, the router. After a successful call, the chosen agent owns every future message until the binding is released.',
            handoffSchema,
            async (params: { agentId: string; greeting?: string }) => {
                const target = siblings.find(s => s.id === params.agentId);
                if (!target) return { ok: false, error: 'Unknown agent' };
                await prisma.client.updateMany({
                    where: { workspaceId: opts.workspaceId, phone: opts.contactPhone },
                    data: { assignedAgentId: params.agentId },
                });
                logger.info({ phone: opts.contactPhone, assignedTo: target.name, agentId: params.agentId }, '[router] handoff executed');
                return { ok: true, assignedTo: target.name, greeting: params.greeting || null };
            },
        ),
        unassignAgent: makeTool(
            'Release the current contact\'s agent binding. After this the router will handle the next message again (use when the customer says "I want a different topic" or similar).',
            z.object({}),
            async () => {
                await prisma.client.updateMany({
                    where: { workspaceId: opts.workspaceId, phone: opts.contactPhone },
                    data: { assignedAgentId: null },
                });
                logger.info({ phone: opts.contactPhone }, '[router] handoff cleared');
                return { ok: true };
            },
        ),
    };

    const list = siblings
        .map(s => `- agentId="${s.id}"  →  ${s.name}  →  ${s.routerDescription || '(no description)'}`)
        .join('\n');
    const prompt = `

## ROUTING — CRITICAL INSTRUCTIONS
You are a router agent. Your ONLY job is to figure out which specialised agent the customer needs, then bind them via the handoffTo tool. You do NOT answer business questions yourself — you greet, identify the topic, and route.

### Available specialised agents
${list}

### How to behave
1. If the customer hasn't told you which topic yet, ask ONE short question listing the choices (use the agent names, e.g. "Hansı mövzu üzrə kömək lazımdır: <Name1>, yoxsa <Name2>?"). Then STOP and wait — do not call any tool yet.
2. As soon as the customer's reply matches one of the agents above (even loosely — "realeast", "real east", "realestate" all clearly mean the Real East agent), you MUST call \`handoffTo\` with that agent's agentId. The text you write to the customer in the same turn is the transition line (e.g. "Sizi Real East üzrə mütəxəssisə yönləndirirəm.").
3. If the topic doesn't match any agent above, apologise briefly. Do NOT call handoffTo with a guess.

### ABSOLUTE RULES — DO NOT BREAK
- **Saying "I will route you" is NOT routing.** The customer is only routed when you call the handoffTo tool. If you write "Sizi yönləndirirəm" / "I'll connect you" / "I'll transfer you" without calling handoffTo in the same turn, the routing FAILS — the customer's next message comes back to you and the loop repeats. This has actually happened. Do NOT make this mistake.
- Always call handoffTo BEFORE or alongside your transition message, never instead of it.
- One handoffTo per conversation. Once called, the binding sticks.
- Use unassignAgent only when an already-assigned customer explicitly says they want a different topic.
`;
    return { tools, prompt };
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
                include: {
                    agent: { include: { provider: true } },
                    routerAgent: { include: { provider: true } },
                },
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

            // If the channel has neither a primary agent nor a router
            // configured, treat it as intentionally disabled and stay
            // silent — even when a contact still has a sticky
            // assignedAgentId from a previous configuration. The owner
            // explicitly removed the agent from this channel; respecting
            // that beats "remembering" the old binding.
            if (!instance.agentId && !instance.routerAgentId) {
                logger.info(`[${instanceId}] no agent or router configured on instance — skipping AI`);
                return;
            }

            // ─── Sticky routing ───
            // Resolution order:
            //   1. The contact already has Client.assignedAgentId set → use that agent
            //      (this is what the router's handoffTo tool wrote).
            //   2. Instance has a routerAgent configured AND the contact
            //      isn't assigned yet → use the router. It will pick a
            //      specialised agent via handoffTo on its first turn.
            //   3. Fall back to Instance.agent (the legacy single-agent
            //      setup — most workspaces stay on this path).
            const phoneForLookup = remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '');
            const wsLookup = instance.workspaceId
                || (await (await import('../../lib/workspace-migration')).getOrCreatePersonalWorkspace(instance.userId));
            const clientForRouting = await prisma.client.findFirst({
                where: { workspaceId: wsLookup, phone: phoneForLookup },
                select: { assignedAgentId: true },
            });
            let resolvedAgent: any = null;
            if (clientForRouting?.assignedAgentId) {
                resolvedAgent = await prisma.agent.findUnique({
                    where: { id: clientForRouting.assignedAgentId },
                    include: { provider: true },
                });
            }
            if (!resolvedAgent && instance.routerAgent) {
                resolvedAgent = instance.routerAgent;
            }
            if (!resolvedAgent) {
                resolvedAgent = instance.agent;
            }
            if (!resolvedAgent?.provider) return;
            if (!(resolvedAgent as any).isActive) return;

            const agent = resolvedAgent;
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

            // Fetch chat history. The number of recent messages the
            // model sees comes straight from the agent's historyDepth
            // setting (default 10). With the memory skill enabled the
            // agent can fetch older context on demand via tools, so a
            // small window stays useful; without memory pick a larger
            // window from the UI.
            const skills = (agent as any).skills || [];
            const historyDepth = Math.max(1, Math.min(50, Number((agent as any).historyDepth) || 10));
            const history = await prisma.message.findMany({
                where: { instanceId, remoteJid },
                orderBy: { timestamp: 'desc' },
                take: historyDepth
            });
            history.reverse();

            // Vision: if the agent has visionEnabled and the model
            // supports image input, attach the image as a native content
            // part on the LAST user message. Earlier history rows stay
            // as plain text since most providers cap image cost per
            // turn — only the most recent attachment matters anyway.
            const visionOn = !!(agent as any).visionEnabled;
            const lastIdx = history.length - 1;
            const messages: any[] = history.map((msg, idx) => {
                const isImage = visionOn && idx === lastIdx
                    && !msg.isFromMe && msg.mediaUrl
                    && (msg.messageType === 'image' || msg.messageType === 'sticker'
                        || (msg.mediaMime || '').toLowerCase().startsWith('image/'));
                const text = msg.content || '[Unsupported Media]';
                if (isImage) {
                    return {
                        role: 'user' as const,
                        content: [
                            { type: 'text' as const, text },
                            { type: 'image' as const, image: new URL(msg.mediaUrl as string) },
                        ],
                    };
                }
                return {
                    role: (msg.isFromMe ? 'assistant' : 'user') as 'assistant' | 'user',
                    content: text,
                };
            });

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
            const { tools: skillTools, skillPrompt } = buildToolsForSkills(
                skills, agent.allowedTableIds, agent.userId, wsId, httpTools,
                agent.id, remoteJid, skillPrompts,
                instanceId, contactName
            );

            // Router agents pick up the handoffTo / unassignAgent tools and
            // a prompt block listing every assignable sibling agent.
            let tools = skillTools as Record<string, any> | undefined;
            let routerPrompt = '';
            if ((agent as any).isRouter) {
                const r = await buildRouterTools({
                    workspaceId: wsId, currentAgentId: agent.id,
                    contactPhone: phone,
                    allowedAgentIds: ((agent as any).routableAgentIds || []) as string[],
                });
                if (Object.keys(r.tools).length > 0) {
                    tools = { ...(tools || {}), ...r.tools };
                    routerPrompt = r.prompt;
                }
            }

            const systemPrompt = (agent.systemPrompt || 'You are a helpful WhatsApp assistant.') + contactContext + skillPrompt + routerPrompt;

            // Set AGENT_DEBUG=true to dump the exact provider request
            // (system prompt, message turns, tool names) and the
            // resulting response on every call. Off by default so logs
            // stay clean in production; flip it on, send one test
            // message, then turn it back off and pm2 restart backend.
            if (process.env.AGENT_DEBUG === 'true') {
                logger.info({
                    instanceId,
                    remoteJid,
                    provider: providerInfo.provider,
                    model: agent.model,
                    historyDepth,
                    systemPromptChars: systemPrompt.length,
                    systemPromptPreview: systemPrompt.slice(0, 800),
                    toolNames: tools ? Object.keys(tools) : [],
                    messages: messages.map((m: any) => ({
                        role: m.role,
                        content: typeof m.content === 'string'
                            ? m.content.slice(0, 600)
                            : (m.content || []).map((p: any) => p.type === 'text' ? { type: 'text', text: String(p.text || '').slice(0, 600) } : { type: p.type })
                    })),
                }, '[ai-debug] outgoing request');
            }

            // Generate AI response
            const t0 = Date.now();
            const result = await generateText({
                model: aiModel,
                system: systemPrompt,
                messages: applyAnthropicCacheControl(providerInfo.provider, messages),
                // 10-step ceiling lets a multi-tool handoff sequence
                // (e.g. setUserField → upsertClient → bitrix_create_lead
                // → final reply) finish without the SDK cutting the
                // model off mid-flow. Was 5 — too tight for the 3-step
                // Bitrix handoff plus a final reply.
                ...(tools ? { tools, stopWhen: stepCountIs(10) } : {}),
            } as any);
            const durationMs = Date.now() - t0;

            if (process.env.AGENT_DEBUG === 'true') {
                logger.info({
                    instanceId,
                    remoteJid,
                    durationMs,
                    finalText: String(result.text || '').slice(0, 800),
                    steps: (result.steps || []).map((s: any) => ({
                        toolCalls: (s.toolCalls || []).map((tc: any) => ({ tool: tc.toolName, args: tc.args ?? tc.input ?? null })),
                        toolResults: (s.toolResults || []).map((tr: any) => ({ tool: tr.toolName, resultPreview: JSON.stringify(tr.result ?? tr.output ?? null).slice(0, 300) })),
                    })),
                    tokens: result.usage,
                }, '[ai-debug] response');
            }

            const cacheUsage = extractCacheUsage(providerInfo.provider, result);

            // Lightweight version saved to AiConversationLog (memory) — just
            // the name + args; this is what the agent re-reads as context
            // for future turns, so it stays small.
            const extractedToolCalls = (result.steps || []).flatMap((step: any) =>
                (step.toolCalls || []).map((tc: any) => ({
                    toolName: tc.toolName,
                    args: tc.args ?? tc.input ?? tc.parameters ?? null,
                }))
            );

            // Rich version saved to AgentActivityLog (3-day human inspection
            // log) — includes results, redacted args, error flags.
            const richToolCalls = extractRichToolCalls(result.steps as any[]);

            if (extractedToolCalls.length > 0) {
                logger.info({ tools: extractedToolCalls.map((tc: any) => tc.toolName) },
                    `[${instanceId}] AI used tools`);
            }

            // Tools-only turn fallback: if the model used up its step
            // budget on tool calls and produced no user-facing text but
            // successfully created a Bitrix lead, the customer would
            // otherwise be left hanging. Synthesise a short "we'll be
            // in touch" reply so they at least get an acknowledgement.
            let text = result.text;
            const calledBitrixOk = richToolCalls.some((tc: any) =>
                /bitrix.*lead/i.test(tc.toolName) && tc.ok
            );
            if (!text && calledBitrixOk) {
                text = 'Готово! ✅ Передала ваши данные нашему менеджеру 🤝 Он свяжется с вами в самое ближайшее время. Спасибо за интерес! 🙌';
                logger.warn(`[${instanceId}] AI produced no text after Bitrix handoff — using fallback reply`);
            }

            const lastUserMsg = messages[messages.length - 1]?.content || '';
            const userMessageStr = typeof lastUserMsg === 'string' ? lastUserMsg : JSON.stringify(lastUserMsg);

            // Always persist the activity log so the operator can see
            // every turn, even tools-only ones that don't produce a
            // visible reply. Used to be gated by `if (!text) return`
            // above, which made silent tool-only turns invisible.
            prisma.agentActivityLog.create({
                data: {
                    agentId: agent.id, workspaceId: wsId,
                    instanceId, remoteJid,
                    contactPhone: phone, contactName,
                    channel: 'whatsapp',
                    userMessage: userMessageStr,
                    agentReply: text || '(no text — tools-only turn)',
                    toolCalls: richToolCalls,
                    durationMs,
                }
            }).catch(err => logger.warn({ err: err.message }, `[${instanceId}] AgentActivityLog write failed`));

            if (!text) {
                logger.warn(`[${instanceId}] AI produced no reply text — nothing to send to ${remoteJid}`);
                return;
            }

            // Send WhatsApp message
            const sentMsg = await sock.sendMessage(remoteJid, { text });

            // Save message to DB
            const saved = await prisma.message.create({
                data: { instanceId, remoteJid, isFromMe: true, messageType: 'text', content: text, timestamp: new Date() }
            });

            // Save conversation log
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

            // Real-time emit
            io.emit(`message.new-${instanceId}`, {
                id: sentMsg?.key?.id || saved.id, isFromMe: true, content: text,
                status: 'DELIVERED', timestamp: new Date().toISOString()
            });

            logger.info(`[${instanceId}] AI replied to ${remoteJid}`);

            // If the router just dispatched the contact, run the freshly
            // assigned specialist agent immediately so the customer gets a
            // proper greeting / first answer without having to write
            // another message. The specialist sees the full conversation
            // history including the router's transition line, so it knows
            // exactly what the customer wanted.
            const handoffOccurred = (agent as any).isRouter && (result.steps || []).some((s: any) =>
                (s.toolCalls || []).some((tc: any) => tc.toolName === 'handoffTo')
            );
            if (handoffOccurred) {
                logger.info({ instanceId, remoteJid }, '[router] follow-up: invoking specialist agent');
                // Tiny delay so the router's own message lands first on the
                // customer's phone before the specialist's response arrives.
                setTimeout(() => {
                    AiService.handleIncomingMessage(instanceId, remoteJid, sock, io).catch(err => {
                        logger.error({ err: err.message, instanceId, remoteJid }, '[router] follow-up call failed');
                    });
                }, 800);
            }

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
            agent.id, fakeRemoteJid, skillPrompts,
            '', contactName
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
            ...(tools ? { tools, stopWhen: stepCountIs(10) } : {}),
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

    // Pick the right ai-sdk model for an agent. Pulled out of the
    // live + test paths so the operator-related entry points can
    // reuse the same provider-resolution logic.
    private static buildAiModel(agent: any) {
        const providerInfo = agent.provider;
        if (!providerInfo) throw new Error('Agent has no provider configured');
        if (providerInfo.provider === 'OPENAI') return createOpenAI({ apiKey: providerInfo.apiKey } as any).chat(agent.model);
        if (providerInfo.provider === 'CLAUDE') return createAnthropic({ apiKey: providerInfo.apiKey })(agent.model);
        if (providerInfo.provider === 'GEMINI') return createGoogleGenerativeAI({ apiKey: providerInfo.apiKey })(agent.model);
        throw new Error(`Unknown AI Provider: ${providerInfo.provider}`);
    }

    // Operator answered a question raised via askOperator → compose a
    // polished customer-facing reply that incorporates the answer
    // naturally and send it to the originating customer. Logs the
    // exchange so the operator can see it in the Activity tab.
    static async composeCustomerReplyFromOperator(opts: {
        instanceId: string;
        request: any; // OperatorRequest row (with customerJid, question, etc.)
        operatorAnswer: string;
    }) {
        const { instanceId, request, operatorAnswer } = opts;
        // Late imports to avoid the ai.service ⇄ instance.manager ⇄ server
        // circular dependency at module load time.
        const { sessions } = await import('../whatsapp/instance.manager');
        const { io } = await import('../../server');
        const sock = sessions.get(instanceId);
        if (!sock) {
            logger.warn(`[ai-operator] instance ${instanceId} not connected — cannot deliver to customer`);
            return;
        }

        const agent = await prisma.agent.findUnique({
            where: { id: request.agentId },
            include: { provider: true },
        });
        if (!agent || !(agent as any).isActive) return;

        // Pull recent chat history so the composer knows the customer
        // has already been greeted, what context was set up, and the
        // tone used. Without this the model treats every operator
        // handoff as a fresh dialog and re-greets ("Salam! …") on
        // every relayed answer.
        const recentHistory = await prisma.message.findMany({
            where: { instanceId, remoteJid: request.customerJid },
            orderBy: { timestamp: 'desc' },
            take: 10,
            select: { isFromMe: true, content: true },
        });
        recentHistory.reverse();
        const historyMessages = recentHistory.map(m => ({
            role: (m.isFromMe ? 'assistant' : 'user') as 'assistant' | 'user',
            content: m.content || '',
        }));

        const baseSystem = agent.systemPrompt || 'You are a helpful WhatsApp assistant.';
        const composePrompt =
            `${baseSystem}\n\n[Live operator handoff — internal note]:\n` +
            `Earlier in this same chat the customer asked: "${request.question}".\n` +
            `You told them you'd check and that you'd get back to them.\n` +
            `A human teammate has now confirmed the answer: "${operatorAnswer}".\n\n` +
            `Write ONE short follow-up message to the customer that delivers the answer naturally, in the SAME language and tone they were using. Rules:\n` +
            `• Do NOT greet again. You've already greeted earlier in the chat — jump straight to the answer.\n` +
            `• Do NOT mention "operator", "manager", "teammate", or that you consulted anyone.\n` +
            `• Pick up the conversation where it left off, like you just got back from checking.\n` +
            `• Keep it brief (1–3 sentences).\n` +
            `• 🛑 ANTI-HALLUCINATION: if the operator's reply does NOT actually contain the information the customer asked for (e.g. they asked a question back, they said "wait", "i'll check", or the reply is unrelated), DO NOT invent specs, prices, model names or details. Send a polite holding message in the customer's language ("Bir az gözləyin, dəqiqləşdirib qayıdacam" / "Подождите немного, уточню и вернусь") and stop. Better to make them wait than to lie.`;

        try {
            const aiModel = this.buildAiModel(agent);
            const result = await generateText({
                model: aiModel,
                system: composePrompt,
                // Give the model the actual recent dialog so it can see
                // that greetings already happened and can match tone.
                // The final synthetic turn ("you just confirmed X") is
                // what we want it to react to.
                messages: [
                    ...historyMessages,
                    { role: 'user', content: `[internal note] You just got the answer back: ${operatorAnswer}\nReply now, no greeting.` },
                ],
            } as any);
            const text = (result.text || operatorAnswer).trim();

            await sock.sendMessage(request.customerJid, { text });
            await prisma.message.create({
                data: {
                    instanceId, remoteJid: request.customerJid,
                    isFromMe: true, messageType: 'text',
                    content: text, timestamp: new Date(),
                },
            });
            io.emit(`message.new-${instanceId}`, {
                id: `op-${request.ticket}`, isFromMe: true, content: text,
                remoteJid: request.customerJid, status: 'DELIVERED',
                timestamp: new Date().toISOString(),
            });
            logger.info(`[ai-operator] ticket ${request.ticket} answer delivered to ${request.customerJid}`);
        } catch (err: any) {
            logger.error({ err: err.message, ticket: request.ticket }, '[ai-operator] composing customer reply failed');
        }
    }

    // Sends a single AI-generated reminder to a contact that has gone
    // quiet. The model sees the full chat history, a system instruction
    // explaining this is a reminder turn, and drafts ONE short
    // re-engagement message. Used by the background reminder scheduler;
    // never called from the regular message-receive path.
    static async triggerReminder(opts: {
        instanceId: string;
        remoteJid: string;
        idleHours: number;
        sock: WASocket;
        io: Server;
    }) {
        const { instanceId, remoteJid, idleHours, sock, io } = opts;
        try {
            const instance = await prisma.instance.findUnique({
                where: { id: instanceId },
                include: { agent: { include: { provider: true } } },
            });
            if (!instance?.agent?.provider) return;
            if (!(instance.agent as any).isActive) return;
            const agent: any = instance.agent;
            const providerInfo = agent.provider;
            if (!(agent.skills || []).includes('reminder')) return;

            // Same provider wiring as handleIncomingMessage.
            let aiModel: any;
            if (providerInfo.provider === 'OPENAI')      aiModel = createOpenAI({ apiKey: providerInfo.apiKey } as any).chat(agent.model);
            else if (providerInfo.provider === 'CLAUDE') aiModel = createAnthropic({ apiKey: providerInfo.apiKey })(agent.model);
            else if (providerInfo.provider === 'GEMINI') aiModel = createGoogleGenerativeAI({ apiKey: providerInfo.apiKey })(agent.model);
            else return;

            // Skip when the contact is paused or has no Client row.
            const phone = remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '');
            const inst = await prisma.instance.findUnique({ where: { id: instanceId }, select: { workspaceId: true } });
            const wsId = inst?.workspaceId
                || (await (await import('../../lib/workspace-migration')).getOrCreatePersonalWorkspace(agent.userId));
            const client = await prisma.client.findFirst({ where: { workspaceId: wsId, phone } });
            if (client?.agentPaused) {
                logger.info(`[${instanceId}] reminder skipped: contact paused`);
                return;
            }

            const historyDepth = Math.max(1, Math.min(50, Number(agent.historyDepth) || 10));
            const history = await prisma.message.findMany({
                where: { instanceId, remoteJid },
                orderBy: { timestamp: 'desc' },
                take: historyDepth,
            });
            history.reverse();
            if (history.length === 0) return;

            const messages: any[] = history.map(msg => ({
                role: (msg.isFromMe ? 'assistant' : 'user') as 'assistant' | 'user',
                content: msg.content || '[Unsupported Media]',
            }));
            // Append the explicit reminder cue as a user-side system note
            // so the model picks it up as the "current turn" instead of
            // re-reading the last assistant message.
            messages.push({
                role: 'user' as const,
                content: `[REMINDER_TURN: customer silent for ${idleHours}h. Write ONE short warm follow-up that nudges them based on chat history. Do not restart the funnel, do not apologise for writing again, do not repeat your last message verbatim.]`,
            });

            const skills = agent.skills || [];
            const httpTools = (agent.httpTools || []) as HttpToolTemplate[];
            const skillPrompts = (agent.skillPrompts || {}) as Record<string, string>;
            const contactName = client?.name || null;
            const contactContext = `\n\nCurrent contact info:\n- Phone: ${phone}${contactName ? `\n- Name: ${contactName}` : ''}\nYou already have this info — do NOT ask the customer for their phone number or name.`;
            const { tools, skillPrompt } = buildToolsForSkills(
                skills, agent.allowedTableIds, agent.userId, wsId, httpTools,
                agent.id, remoteJid, skillPrompts, instanceId, contactName,
            );
            const systemPrompt = (agent.systemPrompt || 'You are a helpful WhatsApp assistant.') + contactContext + skillPrompt;

            const result = await generateText({
                model: aiModel,
                system: systemPrompt,
                messages: applyAnthropicCacheControl(providerInfo.provider, messages),
                ...(tools ? { tools, stopWhen: stepCountIs(5) } : {}),
            } as any);

            const text = (result.text || '').trim();
            if (!text) {
                logger.info(`[${instanceId}] reminder skipped: empty model output`);
                return;
            }

            const sentMsg = await sock.sendMessage(remoteJid, { text });
            const saved = await prisma.message.create({
                data: { instanceId, remoteJid, isFromMe: true, messageType: 'text', content: text, timestamp: new Date() },
            });
            await prisma.aiConversationLog.create({
                data: {
                    agentId: agent.id, instanceId, remoteJid,
                    userMessage: '', agentReply: text,
                    promptTokens: (result as any).usage?.inputTokens || 0,
                    completionTokens: (result as any).usage?.outputTokens || 0,
                    totalTokens: ((result as any).usage?.inputTokens || 0) + ((result as any).usage?.outputTokens || 0),
                    provider: providerInfo.provider, model: agent.model,
                    toolCalls: [{ toolName: 'auto_reminder', args: { idleHours } }] as any,
                },
            });
            if (client) {
                await prisma.client.update({ where: { id: client.id }, data: { lastReminderAt: new Date() } });
            }
            io.emit(`message.new-${instanceId}`, {
                id: sentMsg?.key?.id || saved.id, isFromMe: true, content: text,
                status: 'DELIVERED', timestamp: new Date().toISOString(),
            });
            logger.info(`[${instanceId}] [reminder] sent to ${remoteJid} (idle ${idleHours}h)`);
        } catch (e: any) {
            logger.error({ err: e?.message, instanceId, remoteJid }, '[reminder] trigger failed');
        }
    }

    // The operator chat is its own full conversation with the agent —
    // the model has chat history with the operator, the list of open
    // tickets, all the lookup tools, and answerTicket / sendToCustomer
    // for outbound action. It decides itself whether an incoming
    // operator message is an answer to a ticket, a question back, an
    // analytics request, or a request to message a customer.
    static async replyToOperatorQuery(opts: {
        instanceId: string;
        operator: any;
        question: string;
        quotedBody?: string | null;
    }) {
        const { instanceId, operator, question, quotedBody } = opts;
        const { sessions } = await import('../whatsapp/instance.manager');
        const sock = sessions.get(instanceId);
        if (!sock) return;

        const agent = await prisma.agent.findUnique({
            where: { id: operator.agentId },
            include: { provider: true },
        });
        if (!agent || !(agent as any).isActive) {
            logger.warn(`[ai-operator] agent ${operator.agentId} is missing or inactive — operator ${operator.name} got no reply`);
            return;
        }

        const opTools = buildOperatorAgentTools({
            agentId: agent.id,
            workspaceId: (agent as any).workspaceId || null,
            instanceId,
            operatorId: operator.id,
        });

        // 1. Conversation history with THIS operator on this instance —
        //    so the model has multi-turn context (operator might have
        //    asked something earlier and the new message refers to it).
        const opJid = `${operator.phone}@s.whatsapp.net`;
        const opHistoryRows = await prisma.message.findMany({
            where: { instanceId, remoteJid: opJid },
            orderBy: { timestamp: 'desc' },
            take: 20,
            select: { isFromMe: true, content: true },
        });
        opHistoryRows.reverse();
        // Drop the most recent inbound message because it's the same
        // "question" we're about to feed in as the current turn.
        const lastInboundIdx = (() => {
            for (let i = opHistoryRows.length - 1; i >= 0; i--) {
                if (!opHistoryRows[i].isFromMe) return i;
            }
            return -1;
        })();
        const historyMessages = opHistoryRows
            .filter((_, i) => i !== lastInboundIdx)
            .map(r => ({
                role: (r.isFromMe ? 'assistant' : 'user') as 'assistant' | 'user',
                content: r.content || '',
            }));

        // 2. Open tickets — exact same shape the answerTicket tool
        //    accepts, so the model can see what's outstanding and
        //    pick a ticket if the operator's reply answers one.
        const openTickets = await prisma.operatorRequest.findMany({
            where: { operatorId: operator.id, status: 'open' },
            orderBy: { sentAt: 'desc' },
            take: 15,
            select: { ticket: true, customerJid: true, customerName: true, customerPhone: true, question: true, sentAt: true },
        });
        const openTicketsBlob = openTickets.length === 0
            ? '(No tickets currently waiting on this operator.)'
            : openTickets.map(t => {
                const who = t.customerName || (t.customerPhone ? '+' + t.customerPhone : '?');
                return `• [REQ-${t.ticket}] ${who} (${t.customerJid}) asked: "${t.question.slice(0, 120)}"`;
            }).join('\n');

        const opPrompt = (operator.systemPrompt || '').trim();
        const system =
            `You are the AI agent's back-office assistant talking with operator "${operator.name}" over WhatsApp. This is INTERNAL STAFF CHAT, NOT a customer conversation. You and the operator are teammates working together to serve customers.\n\n` +
            `🎯 Your job in this chat:\n` +
            `• When the operator answers a customer question — close the matching open ticket with answerTicket so the customer actually receives the answer. Don't just chat back; the customer is waiting.\n` +
            `• When the operator asks YOU a question (clarification, looking up context, "what did X ask?", "how many tagged hot today?") — answer it concisely in chat, using the lookup tools when needed. The customer is NOT involved in this kind of turn.\n` +
            `• When the operator instructs you to message a customer outside an open ticket ("tell Cəfərzadə X", "ping +994…") — use sendToCustomer.\n` +
            `• When the operator's message is ambiguous (which customer? which ticket?) — ask them back, briefly. Never guess silently and never fabricate facts.\n\n` +
            `🛠 Tools available to you:\n` +
            `• listOpenTickets — current open tickets owned by this operator.\n` +
            `• answerTicket({ticket, answerForCustomer}) — closes a ticket + sends a polished message to that customer in their language. Use ONLY when the operator has truly provided the information the customer was waiting for. Strip any greeting; the customer was already greeted earlier.\n` +
            `• sendToCustomer({customerJid, message}) — proactive message to a customer outside the ticket flow.\n` +
            `• listRecentCustomers / getCustomerHistory / searchCustomers / getCustomersByTag / getCustomerStats — read-only lookups.\n\n` +
            `🛑 Anti-hallucination: never invent specs, prices, model names, video card or RAM details. If you don't have the info from the operator or the tools, do not make it up. Ask back or tell the operator you need clarification.\n\n` +
            `🌐 Language: reply to the operator in the operator's language. When you call answerTicket / sendToCustomer, write the customer-facing message in the customer's language and tone.\n\n` +
            (opPrompt ? `[Operator-specific instructions from settings]\n${opPrompt}\n\n` : '') +
            (quotedBody ? `[The operator quoted this earlier message in their WhatsApp reply — use it to identify which ticket or customer they mean]\n${quotedBody.slice(0, 1500)}\n\n` : '') +
            `[Open tickets this operator is currently responsible for]\n${openTicketsBlob}`;

        try {
            const aiModel = this.buildAiModel(agent);
            const result = await generateText({
                model: aiModel,
                system,
                messages: [
                    ...historyMessages,
                    { role: 'user', content: question },
                ],
                tools: opTools,
                stopWhen: stepCountIs(10),
            } as any);
            const text = (result.text || '').trim();

            const calls = (result.steps || []).flatMap((s: any) => (s.toolCalls || []).map((tc: any) => tc.toolName));
            // If the model fired an action but skipped writing back to
            // the operator, synthesise a minimal acknowledgement so
            // the chat doesn't go silent on them.
            const ack = text || (calls.length > 0 ? `✅ Готово (${calls.join(', ')}).` : '');
            if (!ack) return;

            await sock.sendMessage(opJid, { text: ack });
            logger.info(`[ai-operator] replied to operator ${operator.name} (${operator.phone}) tools=[${calls.join(',')}]`);
        } catch (err: any) {
            logger.error({ err: err.message, operatorId: operator.id }, '[ai-operator] reply failed');
        }
    }
}

import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

// ─── Provider helpers ─────────────────────────────────────────
function buildOversightModel(provider: string, apiKey: string, model: string) {
    if (provider === 'OPENAI') return createOpenAI({ apiKey } as any).chat(model);
    if (provider === 'CLAUDE') return createAnthropic({ apiKey })(model);
    if (provider === 'GEMINI') return createGoogleGenerativeAI({ apiKey })(model);
    throw new Error(`Unknown provider ${provider}`);
}

// ─── Compute nextRunAt from interval + run hour ───────────────
// "Every N days at HH:00 local". Starting point is lastRunAt
// (or now() if never run). The result is naive UTC — close enough
// for a self-improvement loop; production-grade scheduling would
// store the user's tz.
export function computeNextRunAt(lastRunAt: Date | null, intervalDays: number, runHour: number): Date {
    const base = lastRunAt ? new Date(lastRunAt) : new Date();
    const next = new Date(base.getTime());
    next.setUTCDate(next.getUTCDate() + Math.max(1, intervalDays));
    next.setUTCHours(Math.max(0, Math.min(23, runHour)), 0, 0, 0);
    // If we've already passed it (e.g. server downtime), bump forward to today's hour.
    if (next.getTime() < Date.now()) {
        const today = new Date();
        today.setUTCHours(runHour, 0, 0, 0);
        if (today.getTime() > Date.now()) return today;
        const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000);
        return tomorrow;
    }
    return next;
}

// ─── Suggestion shape contract with the LLM ────────────────────
// We instruct the model to return strict JSON that maps to these
// shapes. parse + validate before persisting.
type LlmSuggestion = {
    type: 'prompt_append' | 'prompt_replace' | 'add_http_tool' | 'add_table_row' | 'enable_skill' | 'disable_skill' | 'info_note';
    title: string;
    description: string;
    applicable: boolean;
    targetAgentName: string; // human reference; we map back to id by name
    payload?: any;
};

const APPLICABLE_TYPES = new Set(['prompt_append', 'prompt_replace', 'add_http_tool', 'add_table_row', 'enable_skill', 'disable_skill']);

// ─── Build the analysis prompt + send to LLM ───────────────────
async function buildAnalysisPrompt(oversight: any, agents: any[], lookbackDays: number): Promise<string> {
    const since = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);

    const agentBlocks: string[] = [];
    for (const a of agents) {
        // 1) Agent config snapshot
        const skillsLine = (a.skills || []).join(', ') || '(none)';
        const httpTools = ((a.httpTools as any[]) || []);
        const toolList = httpTools.length
            ? httpTools.map((t: any, i: number) => `  - ${t.name || 'tool' + i}: ${t.description || ''}`).join('\n')
            : '  (none)';

        // 2) Allowed tables (knowledge base)
        let tablesBlock = '';
        if (a.allowedTableIds?.length) {
            const tables = await prisma.customTable.findMany({
                where: { id: { in: a.allowedTableIds } },
                select: { name: true, description: true, columns: true, _count: { select: { rows: true } } },
            });
            tablesBlock = '\n## Knowledge base\n' + tables.map(t =>
                `- ${t.name}: ${t._count.rows} rows · ${t.description || '(no description)'}`
            ).join('\n');
        }

        // 3) Sample of customer activity in the lookback window
        const activity = await prisma.agentActivityLog.findMany({
            where: { agentId: a.id, createdAt: { gte: since } },
            orderBy: { createdAt: 'desc' },
            take: 40,
            select: { contactPhone: true, contactName: true, userMessage: true, agentReply: true, toolCalls: true, createdAt: true },
        });
        const activityBlob = activity.length === 0
            ? '(no customer activity in window)'
            : activity.map(r => {
                const who = r.contactName || r.contactPhone || '?';
                const tools = Array.isArray(r.toolCalls)
                    ? (r.toolCalls as any[]).map((t: any) => t.toolName).join(',')
                    : '';
                return `[${r.createdAt.toISOString().slice(0, 19)}] ${who}\nCustomer: ${(r.userMessage || '').slice(0, 200)}\nAgent: ${(r.agentReply || '').slice(0, 200)}\nTools used: ${tools || '(none)'}`;
            }).join('\n---\n');

        // 4) Operator interactions
        const opReqs = await prisma.operatorRequest.findMany({
            where: { agentId: a.id, sentAt: { gte: since } },
            orderBy: { sentAt: 'desc' },
            take: 20,
            select: { ticket: true, status: true, question: true, answer: true, sentAt: true, answeredAt: true, customerName: true },
        });
        const opBlob = opReqs.length === 0
            ? '(no operator escalations in window)'
            : opReqs.map(r =>
                `[REQ-${r.ticket}] ${r.status} · ${r.customerName || '?'} · Q: "${r.question.slice(0, 100)}" · A: "${(r.answer || '(no answer)').slice(0, 100)}"`
            ).join('\n');

        // 5) Aggregate stats
        const turnsCount = activity.length;
        const opsAnswered = opReqs.filter(r => r.status === 'answered').length;
        const opsTimedOut = opReqs.filter(r => r.status === 'timeout').length;

        agentBlocks.push(
`### Agent: ${a.name} (id=${a.id})
Provider: ${a.provider?.provider || '?'} · Model: ${a.model}
Skills enabled: ${skillsLine}
HTTP tools:
${toolList}${tablesBlock}

## System prompt (current)
${(a.systemPrompt || '(empty)').slice(0, 3000)}

## Stats (last ${lookbackDays} days)
- Customer turns observed: ${turnsCount}
- Operator tickets answered: ${opsAnswered}, timed out: ${opsTimedOut}

## Sample customer turns (newest first, capped)
${activityBlob.slice(0, 5000)}

## Operator escalations
${opBlob.slice(0, 2000)}`
        );
    }

    const customInstr = (oversight.systemPrompt || '').trim();
    return `You are an oversight reviewer for AI customer-support agents. Your job: read the data below and propose CONCRETE improvements as a structured JSON array.

${customInstr ? `[Custom oversight instructions]\n${customInstr}\n` : ''}

Rules for your output:
- Reply ONLY with valid JSON, no prose, no markdown fences.
- Top-level shape: { "summary": "one-line verdict for the dashboard", "suggestions": [...] }
- Each suggestion has fields:
  - type: one of "prompt_append" | "prompt_replace" | "add_http_tool" | "add_table_row" | "enable_skill" | "disable_skill" | "info_note"
  - title: 4-12 word headline
  - description: 1-3 sentence explanation of WHY (cite specific customer turns where possible)
  - applicable: boolean — true ONLY if you provide a complete, ready-to-apply payload
  - targetAgentName: name of the agent the suggestion is about (from the blocks below)
  - payload: type-specific, see below
- payload shapes:
  - prompt_append → { "text": "<text to append at end of agent's system prompt>" }
  - prompt_replace → { "newPrompt": "<full replacement system prompt>" }
  - add_http_tool → { "tool": { "name": "...", "description": "...", "method": "GET|POST|...", "url": {"mode":"fixed","value":"https://..."} , ... } }
  - add_table_row → { "tableName": "<exact CustomTable name>", "data": { ... matching the columns ... } }
  - enable_skill / disable_skill → { "skill": "memory|crm|user_fields|tables|http|self_pause|live_operator" }
  - info_note → null (just an observation, no payload, applicable must be false)
- If everything looks good, output { "summary": "All agents are operating well — no changes recommended.", "suggestions": [] }.
- Cap at 8 suggestions max. Focus on the highest-impact ones.

=== AGENT DATA ===
${agentBlocks.join('\n\n=== === === ===\n\n')}`;
}

function safeParseJson(text: string): any | null {
    if (!text) return null;
    let s = text.trim();
    // Strip common markdown fences a model might still output.
    if (s.startsWith('```')) {
        s = s.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
    }
    try {
        return JSON.parse(s);
    } catch {
        // Try to grab the first {...} or [...] block as a fallback
        const m = s.match(/[\{\[][\s\S]*[\}\]]/);
        if (m) {
            try { return JSON.parse(m[0]); } catch { return null; }
        }
        return null;
    }
}

// ─── Run one oversight cycle ─────────────────────────────────
// Loads watched agents + their last N days of activity, builds the
// prompt, calls the LLM, persists OversightRun + OversightSuggestion
// rows, updates lastRunAt / nextRunAt. Errors are caught and logged
// per oversight so a bad one doesn't sink the rest of the sweep.
export async function runOversightAgent(oversightId: string): Promise<{ ok: boolean; runId?: string; suggestionsCount: number; error?: string }> {
    const oversight = await prisma.oversightAgent.findUnique({
        where: { id: oversightId },
        include: {
            provider: true,
            watches: { include: { agent: { include: { provider: true } } } },
        },
    });
    if (!oversight) return { ok: false, suggestionsCount: 0, error: 'Oversight agent not found' };
    if (!oversight.provider) return { ok: false, suggestionsCount: 0, error: 'No AI provider configured' };
    if (oversight.watches.length === 0) return { ok: false, suggestionsCount: 0, error: 'No watched agents' };

    const run = await prisma.oversightRun.create({
        data: { oversightAgentId: oversight.id, status: 'running' },
    });

    try {
        const agents = oversight.watches.map(w => w.agent);
        const prompt = await buildAnalysisPrompt(oversight, agents, oversight.lookbackDays);
        const model = buildOversightModel(oversight.provider.provider, oversight.provider.apiKey, oversight.model);

        const result = await generateText({
            model,
            system: prompt,
            messages: [{ role: 'user', content: 'Now produce the JSON.' }],
        } as any);

        const text = result.text || '';
        const parsed = safeParseJson(text);
        if (!parsed) throw new Error('LLM did not return valid JSON');
        const rawSuggestions: LlmSuggestion[] = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
        const summary: string = (parsed.summary || '').toString().slice(0, 500);

        const agentsByName = new Map(agents.map(a => [a.name, a.id]));

        let created = 0;
        for (const s of rawSuggestions.slice(0, 8)) {
            if (!s || !s.type || !s.title || !s.description) continue;
            const targetId = agentsByName.get(s.targetAgentName) || agents[0].id;
            const isApplicable = APPLICABLE_TYPES.has(s.type) && !!s.payload;
            await prisma.oversightSuggestion.create({
                data: {
                    oversightAgentId: oversight.id,
                    runId: run.id,
                    targetAgentId: targetId,
                    type: s.type,
                    title: String(s.title).slice(0, 200),
                    description: String(s.description).slice(0, 4000),
                    payload: s.payload || null,
                    applicable: isApplicable,
                    status: 'pending',
                },
            }).then(() => { created++; }).catch(err =>
                logger.warn({ err: err.message, type: s.type }, '[oversight] failed to persist suggestion')
            );
        }

        const now = new Date();
        const nextRunAt = computeNextRunAt(now, oversight.intervalDays, oversight.runHour);
        await Promise.all([
            prisma.oversightRun.update({
                where: { id: run.id },
                data: {
                    status: 'completed',
                    finishedAt: now,
                    suggestionsCount: created,
                    summary,
                    tokensIn: (result as any).usage?.inputTokens || 0,
                    tokensOut: (result as any).usage?.outputTokens || 0,
                },
            }),
            prisma.oversightAgent.update({
                where: { id: oversight.id },
                data: { lastRunAt: now, nextRunAt },
            }),
        ]);

        logger.info(`[oversight] ${oversight.name} (${oversight.id}) → ${created} suggestions, next ${nextRunAt.toISOString()}`);
        return { ok: true, runId: run.id, suggestionsCount: created };
    } catch (err: any) {
        await prisma.oversightRun.update({
            where: { id: run.id },
            data: { status: 'failed', finishedAt: new Date(), errorMsg: err.message.slice(0, 2000) },
        }).catch(() => {});
        // Even on failure, push nextRunAt forward so we don't retry every minute
        const nextRunAt = computeNextRunAt(new Date(), oversight.intervalDays, oversight.runHour);
        await prisma.oversightAgent.update({
            where: { id: oversight.id },
            data: { lastRunAt: new Date(), nextRunAt },
        }).catch(() => {});
        logger.error({ err: err.message, oversightId }, '[oversight] run failed');
        return { ok: false, suggestionsCount: 0, error: err.message };
    }
}

// ─── Apply an approved suggestion ─────────────────────────────
// Only "applicable" types can be applied. Each type knows how to
// mutate its target. Failures are recorded on the suggestion row so
// the operator sees why it didn't take effect.
export async function applySuggestion(suggestionId: string, reviewedBy: string): Promise<{ ok: boolean; error?: string }> {
    const sug = await prisma.oversightSuggestion.findUnique({
        where: { id: suggestionId },
        include: { targetAgent: true },
    });
    if (!sug) return { ok: false, error: 'Suggestion not found' };
    if (!sug.applicable) return { ok: false, error: 'This suggestion is informational only.' };
    if (sug.status === 'applied') return { ok: false, error: 'Already applied.' };

    const payload: any = sug.payload || {};
    const agent = sug.targetAgent;
    if (!agent) return { ok: false, error: 'Target agent missing' };

    try {
        switch (sug.type) {
            case 'prompt_append': {
                const append = String(payload.text || '');
                if (!append) throw new Error('Empty append payload');
                const newPrompt = `${agent.systemPrompt || ''}\n\n${append}`.trim();
                await prisma.agent.update({ where: { id: agent.id }, data: { systemPrompt: newPrompt } });
                break;
            }
            case 'prompt_replace': {
                const newPrompt = String(payload.newPrompt || '');
                if (!newPrompt) throw new Error('Empty newPrompt');
                await prisma.agent.update({ where: { id: agent.id }, data: { systemPrompt: newPrompt } });
                break;
            }
            case 'add_http_tool': {
                const tool = payload.tool;
                if (!tool || !tool.name || !tool.method || !tool.url) throw new Error('Incomplete tool payload');
                const existing = ((agent.httpTools as any[]) || []);
                await prisma.agent.update({
                    where: { id: agent.id },
                    data: { httpTools: [...existing, tool] as any },
                });
                break;
            }
            case 'add_table_row': {
                const tableName = String(payload.tableName || '');
                const data = payload.data || {};
                if (!tableName) throw new Error('Missing tableName');
                const table = await prisma.customTable.findFirst({ where: { name: tableName } });
                if (!table) throw new Error(`Table "${tableName}" not found`);
                await prisma.customRow.create({ data: { tableId: table.id, data } });
                break;
            }
            case 'enable_skill':
            case 'disable_skill': {
                const skill = String(payload.skill || '');
                if (!skill) throw new Error('Missing skill name');
                const set = new Set(agent.skills || []);
                if (sug.type === 'enable_skill') set.add(skill); else set.delete(skill);
                await prisma.agent.update({
                    where: { id: agent.id },
                    data: { skills: Array.from(set) },
                });
                break;
            }
            default:
                throw new Error(`Unsupported type ${sug.type}`);
        }

        await prisma.oversightSuggestion.update({
            where: { id: sug.id },
            data: { status: 'applied', appliedAt: new Date(), reviewedAt: new Date(), reviewedBy },
        });
        return { ok: true };
    } catch (err: any) {
        await prisma.oversightSuggestion.update({
            where: { id: sug.id },
            data: { status: 'apply_failed', applyError: err.message.slice(0, 1000), reviewedAt: new Date(), reviewedBy },
        }).catch(() => {});
        return { ok: false, error: err.message };
    }
}

// ─── Periodic sweeper ────────────────────────────────────────
// Server boots → starts the sweeper. Every 5 minutes it looks for
// active oversight agents whose nextRunAt is past and fires them
// (serialised, one at a time, so multiple bulky runs don't compete
// for tokens or DB locks).
export function startOversightScheduler() {
    const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
    const tick = async () => {
        try {
            const due = await prisma.oversightAgent.findMany({
                where: {
                    isActive: true,
                    OR: [
                        { nextRunAt: null },
                        { nextRunAt: { lte: new Date() } },
                    ],
                },
                take: 5,
                orderBy: { lastRunAt: 'asc' },
            });
            for (const o of due) {
                await runOversightAgent(o.id).catch(err =>
                    logger.error({ err: err.message, oversightId: o.id }, '[oversight] tick run failed')
                );
            }
        } catch (err: any) {
            logger.warn({ err: err.message }, '[oversight] sweep failed');
        }
    };
    setTimeout(tick, 30_000); // first sweep 30s after boot so we don't slow startup
    setInterval(tick, SWEEP_INTERVAL_MS);
}

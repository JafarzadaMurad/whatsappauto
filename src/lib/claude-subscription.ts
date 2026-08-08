// Running Claude work on a subscription instead of the platform API key.
//
// One shared pool of subscription tokens serves the whole platform. There
// is no per-user assignment: a request either qualifies for the pool or it
// doesn't, decided by one rule (see `shouldUseSubscription`):
//
//   1. Workspace brought its own key  → their key. Always. A customer who
//      pays for their own Anthropic account must be billed to it.
//   2. Subscription mode is on and a token is healthy → the pool. Free.
//   3. Otherwise → the platform API key, as before.
//
// A subscription can only be driven through the Claude Code harness (the
// Agent SDK), not through /v1/messages — so this module does not build an
// AI SDK model. It runs the turn in a subprocess and returns a result
// shaped like `generateText`'s, so callers keep reading `.text`, `.steps`
// and `.usage` unchanged.
//
// The honest limit, stated once: a subscription's rate limit is sized for
// one person's day of work, and this platform answers messages around the
// clock. The pool WILL run out. That is designed for rather than hoped
// against — a token that reports a limit is benched for a cooldown, the
// next token takes over, and when every token is benched the caller falls
// back to the API key. Running out costs money, never function.

import crypto from 'crypto';
import { prisma } from './prisma';
import { logger } from '../utils/logger';

// ─── Configuration ──────────────────────────────────────────────────

const CONFIG_ENABLED = 'CLAUDE_SUB_ENABLED';
const CONFIG_TOKENS = 'CLAUDE_SUB_TOKENS';   // JSON [{ id, label, token }]
const CONFIG_MODEL = 'CLAUDE_SUB_MODEL';

export type SubTokenPublic = { id: string; label: string; tokenSet: boolean; cooldownUntil: number | null };
type SubToken = { id: string; label: string; token: string };

export class SubscriptionError extends Error {
    code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

// Config is read on nearly every LLM call, so it is cached briefly. The
// TTL is short enough that flipping the admin switch takes effect while
// the admin is still looking at the page.
const CONFIG_TTL_MS = 30_000;
let configCache: { at: number; enabled: boolean; model: string | null; tokens: SubToken[] } | null = null;

export function invalidateSubscriptionCache() { configCache = null; }

async function loadRaw() {
    if (configCache && Date.now() - configCache.at < CONFIG_TTL_MS) return configCache;

    const rows = await prisma.systemConfig.findMany({
        where: { key: { in: [CONFIG_ENABLED, CONFIG_TOKENS, CONFIG_MODEL] } },
    });
    const map = Object.fromEntries(rows.map(r => [r.key, (r.value || '').trim()]));

    let tokens: SubToken[] = [];
    try {
        const parsed = map[CONFIG_TOKENS] ? JSON.parse(map[CONFIG_TOKENS]) : [];
        if (Array.isArray(parsed)) {
            tokens = parsed
                .filter((t: any) => t && typeof t.token === 'string' && t.token.trim())
                .map((t: any, i: number) => ({
                    id: String(t.id || `t${i}`),
                    label: String(t.label || `Token ${i + 1}`),
                    token: String(t.token).trim(),
                }));
        }
    } catch (err: any) {
        logger.error(`[claude-sub] token list is not valid JSON — treating the pool as empty: ${err.message}`);
    }

    configCache = {
        at: Date.now(),
        enabled: map[CONFIG_ENABLED] === 'true',
        model: map[CONFIG_MODEL] || null,
        tokens,
    };
    return configCache;
}

/** Admin view: labels and whether a token is stored, never the token. */
export async function getSubscriptionSettings() {
    const cfg = await loadRaw();
    return {
        enabled: cfg.enabled,
        model: cfg.model,
        tokens: cfg.tokens.map<SubTokenPublic>(t => ({
            id: t.id,
            label: t.label,
            tokenSet: true,
            cooldownUntil: cooldowns.get(t.id) ?? null,
        })),
    };
}

export async function saveSubscriptionSettings(next: {
    enabled?: boolean;
    model?: string | null;
    /**
     * The full pool as the admin edited it. An entry with no `token` keeps
     * whatever is already stored under that id — the browser never sees a
     * token, so it cannot send one back.
     */
    tokens?: { id?: string; label?: string; token?: string; remove?: boolean }[];
}) {
    const current = await loadRaw();
    const writes: { key: string; value: string }[] = [];

    if (next.enabled !== undefined) writes.push({ key: CONFIG_ENABLED, value: next.enabled ? 'true' : 'false' });
    if (next.model !== undefined) writes.push({ key: CONFIG_MODEL, value: next.model || '' });

    if (next.tokens) {
        const merged: SubToken[] = [];
        for (const entry of next.tokens) {
            if (entry.remove) continue;
            const id = entry.id || `t_${crypto.randomBytes(4).toString('hex')}`;
            const existing = current.tokens.find(t => t.id === id);
            const token = (entry.token || '').trim() || existing?.token || '';
            if (!token) continue;   // nothing stored and nothing supplied
            merged.push({ id, label: (entry.label || existing?.label || 'Token').trim(), token });
        }
        writes.push({ key: CONFIG_TOKENS, value: JSON.stringify(merged) });

        // A re-saved token is a fixed token: clear its bench so the pool
        // starts using it again immediately instead of after the cooldown.
        for (const entry of next.tokens) {
            if (entry.token && entry.token.trim() && entry.id) cooldowns.delete(entry.id);
        }
    }

    for (const w of writes) {
        await prisma.systemConfig.upsert({
            where: { key: w.key },
            update: { value: w.value },
            create: { key: w.key, value: w.value },
        });
    }
    invalidateSubscriptionCache();
}

// ─── Pool health ────────────────────────────────────────────────────

/**
 * Tokens benched until a timestamp. A subscription that reports a limit
 * stays hit for a while, so retrying it on the next message would just
 * burn latency on a guaranteed failure — and, worse, would keep the whole
 * platform slow while the limit lasts.
 */
const cooldowns = new Map<string, number>();
const RATE_LIMIT_COOLDOWN_MS = 30 * 60_000;
const AUTH_COOLDOWN_MS = 6 * 60 * 60_000;   // a dead token won't fix itself soon

let cursor = 0;

function healthyTokens(tokens: SubToken[]): SubToken[] {
    const now = Date.now();
    return tokens.filter(t => (cooldowns.get(t.id) ?? 0) <= now);
}

function bench(tokenId: string, ms: number, why: string) {
    cooldowns.set(tokenId, Date.now() + ms);
    logger.warn(`[claude-sub] benched token ${tokenId} for ${Math.round(ms / 60000)}m — ${why}`);
}

/** Is the pool usable right now? Cheap enough to call per request. */
export async function subscriptionAvailable(): Promise<boolean> {
    const cfg = await loadRaw();
    return cfg.enabled && healthyTokens(cfg.tokens).length > 0;
}

/**
 * The routing rule, in one place so every callsite agrees.
 *
 * A workspace on its own key is never diverted: they are paying their own
 * provider bill and a silent switch to our subscription would put their
 * traffic on our account without them asking.
 */
export async function shouldUseSubscription(providerInfo: {
    provider: string;
    useOwnKey?: boolean;
}): Promise<boolean> {
    const p = String(providerInfo.provider || '').toUpperCase();
    if (p !== 'CLAUDE' && p !== 'ANTHROPIC') return false;
    if (providerInfo.useOwnKey) return false;
    return subscriptionAvailable();
}

// ─── Running a turn ─────────────────────────────────────────────────

export type SubscriptionResult = {
    text: string;
    /** Same shape the AI SDK produces, so callers read it unchanged. */
    steps: { toolCalls: { toolName: string; args: any }[]; toolResults: any[] }[];
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
    /** Shaped like the AI SDK's, so pricing reads cache hits the same way. */
    providerMetadata: { anthropic: { cacheReadInputTokens: number } };
    /** What the harness reported running — not necessarily what was asked for. */
    model: string | null;
    tokenId: string;
    durationMs: number;
};

export type SubscriptionRunOpts = {
    system?: string;
    /** Text-only conversation, oldest first. */
    messages: { role: string; content: any }[];
    /** AI SDK tools. Each must carry `_zod` (see makeTool) to be bridged. */
    tools?: Record<string, any>;
    /** Extra MCP servers — the copilot passes its HTTP endpoint here. */
    mcpServers?: Record<string, any>;
    allowedTools?: string[];
    maxTurns?: number;
    /** The model the caller wants. Falls back to the pool's override. */
    model?: string;
    /** Shows up in logs so a slow rail can be traced to a feature. */
    label?: string;
};

/**
 * Turn an AI SDK image part into an Anthropic image block.
 *
 * Claude reads images on this rail exactly as it does on the API — the
 * harness carries content blocks, not just a string. What it can't carry
 * is audio or arbitrary files, so those still send the turn to the API.
 */
function toImageBlock(part: any): any | null {
    const img = part?.image ?? part?.data;
    if (!img) return null;

    if (img instanceof URL) return { type: 'image', source: { type: 'url', url: img.href } };
    if (typeof img === 'string') {
        if (/^https?:\/\//i.test(img)) return { type: 'image', source: { type: 'url', url: img } };
        // A data: URI carries its own media type; a bare string is base64
        // whose type we only know if the part told us.
        const m = img.match(/^data:([^;]+);base64,(.*)$/);
        if (m) return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
        if (part.mediaType || part.mimeType) {
            return { type: 'image', source: { type: 'base64', media_type: part.mediaType || part.mimeType, data: img } };
        }
        return null;
    }
    if (img instanceof Uint8Array || Buffer.isBuffer(img)) {
        const mediaType = part.mediaType || part.mimeType;
        if (!mediaType) return null;   // guessing the type would corrupt the block
        return {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: Buffer.from(img).toString('base64') },
        };
    }
    return null;
}

/**
 * Fold the conversation into the content blocks of a single user turn.
 *
 * The harness drives its own session, while our history lives in the
 * database — this is the one place the two meet. Speaker labels keep the
 * dialogue legible, and images stay inline at the point they were sent so
 * "what is the price of this one?" still has a picture attached to "this
 * one".
 *
 * Returns null when a part can't be represented — audio, documents, an
 * image with no discoverable media type. Dropping it silently would make
 * the agent answer about something it never saw, which is worse than
 * paying for the API call.
 */
function buildContentBlocks(messages: { role: string; content: any }[]): any[] | null {
    const blocks: any[] = [];
    const pushText = (t: string) => {
        const last = blocks[blocks.length - 1];
        if (last?.type === 'text') last.text += t;
        else blocks.push({ type: 'text', text: t });
    };

    for (const m of messages) {
        const who = m.role === 'assistant' ? 'Assistant' : m.role === 'system' ? 'System' : 'User';
        pushText(`${blocks.length ? '\n\n' : ''}${who}: `);

        if (typeof m.content === 'string') {
            pushText(m.content);
            continue;
        }
        if (!Array.isArray(m.content)) return null;

        for (const part of m.content) {
            if (!part?.type || part.type === 'text') {
                pushText(String(part?.text || ''));
            } else if (part.type === 'image') {
                const block = toImageBlock(part);
                if (!block) return null;
                blocks.push(block);
            } else {
                return null;
            }
        }
    }
    return blocks.length ? blocks : null;
}

/** Bridge AI SDK tools into an in-process MCP server the subprocess can call. */
async function bridgeTools(tools: Record<string, any>) {
    const { tool, createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk');

    const defs = Object.entries(tools).map(([name, t]) => {
        // `makeTool` keeps the raw zod object precisely for this. A tool
        // defined straight from JSON Schema can't be bridged, and guessing
        // a shape for it would hand the model a tool it can't call
        // correctly — so the whole turn goes to the API instead.
        const shape = (t as any)?._zod?.shape;
        if (!shape) throw new SubscriptionError('untranslatable_tool', `Tool "${name}" has no zod schema to bridge.`);

        return tool(
            name,
            String(t.description || name),
            shape,
            async (args: any) => {
                const out = await t.execute(args);
                return {
                    content: [{
                        type: 'text' as const,
                        text: typeof out === 'string' ? out : JSON.stringify(out ?? null),
                    }],
                };
            }
        );
    });

    return createSdkMcpServer({ name: 'agent', version: '1.0.0', tools: defs });
}

export async function runOnSubscription(opts: SubscriptionRunOpts): Promise<SubscriptionResult> {
    const cfg = await loadRaw();
    if (!cfg.enabled) throw new SubscriptionError('disabled', 'Subscription mode is off.');

    const available = healthyTokens(cfg.tokens);
    if (!available.length) throw new SubscriptionError('no_token', 'No healthy subscription token.');

    const blocks = buildContentBlocks(opts.messages);
    if (blocks === null) throw new SubscriptionError('unsupported_content', 'Conversation carries a part this rail cannot send.');

    // Streaming-input mode: one user turn whose content blocks hold the
    // whole conversation, images included.
    const prompt = (async function* () {
        yield { type: 'user' as const, message: { role: 'user' as const, content: blocks }, parent_tool_use_id: null };
    })();

    // Round-robin so a two-token pool actually spreads load rather than
    // exhausting the first token and then discovering the second.
    const picked = available[cursor++ % available.length];

    const mcpServers: Record<string, any> = { ...(opts.mcpServers || {}) };
    const allowedTools = [...(opts.allowedTools || [])];
    if (opts.tools && Object.keys(opts.tools).length) {
        mcpServers.agent = await bridgeTools(opts.tools);
        allowedTools.push('mcp__agent__*');
    }

    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const t0 = Date.now();

    const text: string[] = [];
    const toolCalls: { toolName: string; args: any }[] = [];
    let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let cacheReadTokens = 0;
    // What the harness reports actually running, which is the only
    // trustworthy answer to "which model served this?".
    let actualModel: string | null = null;

    const run = query({
        prompt,
        options: {
            // The model the caller asked for wins. Someone who picks Opus
            // in the copilot must get Opus, not whatever the pool happens
            // to default to — the pool override only fills the gap when
            // the caller has no opinion.
            ...(opts.model || cfg.model ? { model: (opts.model || cfg.model) as string } : {}),
            ...(opts.system ? { systemPrompt: opts.system } : {}),
            mcpServers,
            // Only the tools we hand over. The harness's own file and bash
            // tools are deliberately absent — this is answering customer
            // messages, not operating the server it runs on.
            allowedTools,
            // Nothing here can wait on a human at a terminal: an
            // unanswered prompt would hang a customer's WhatsApp reply.
            permissionMode: 'dontAsk',
            maxTurns: opts.maxTurns ?? 15,
            // `env` REPLACES the environment rather than merging, so the
            // base has to be copied or the subprocess loses PATH/HOME.
            // ANTHROPIC_API_KEY is stripped explicitly: if it were present
            // the CLI would silently prefer it and bill the API — the very
            // thing this module exists to avoid.
            env: {
                ...process.env,
                ANTHROPIC_API_KEY: undefined,
                ANTHROPIC_AUTH_TOKEN: undefined,
                CLAUDE_CODE_OAUTH_TOKEN: picked.token,
            } as any,
        },
    });

    try {
        for await (const msg of run as any) {
            if (msg.type === 'assistant') {
                for (const block of msg.message?.content || []) {
                    if (block.type === 'text' && block.text) text.push(block.text);
                    if (block.type === 'tool_use') {
                        toolCalls.push({
                            // Strip the bridge prefix so activity logs and
                            // handoff checks see the same names the API path
                            // produces.
                            toolName: String(block.name || '').replace(/^mcp__agent__/, ''),
                            args: block.input ?? null,
                        });
                    }
                }
            } else if (msg.type === 'system' && msg.subtype === 'init') {
                if (typeof msg.model === 'string') actualModel = msg.model;
            } else if (msg.type === 'result') {
                if (msg.subtype && msg.subtype !== 'success') {
                    throw new SubscriptionError('run_failed', `Claude Code returned ${msg.subtype}.`);
                }
                if (typeof msg.result === 'string' && msg.result.trim()) {
                    text.length = 0;
                    text.push(msg.result);
                }
                const u = msg.usage || {};
                usage = {
                    inputTokens: Number(u.input_tokens || 0),
                    outputTokens: Number(u.output_tokens || 0),
                    totalTokens: Number(u.input_tokens || 0) + Number(u.output_tokens || 0),
                };
                // Cache hits are billed at a fraction of input, and the
                // harness caches aggressively — dropping this number would
                // overcharge the customer for tokens that were cheap.
                cacheReadTokens = Number(u.cache_read_input_tokens || 0);
            }
        }
    } catch (err: any) {
        const message = String(err?.message || err);
        if (/rate.?limit|429|usage limit|limit reached/i.test(message)) {
            bench(picked.id, RATE_LIMIT_COOLDOWN_MS, 'rate limit');
            throw new SubscriptionError('rate_limited', message);
        }
        if (/401|403|unauthor|invalid.*token|expired/i.test(message)) {
            bench(picked.id, AUTH_COOLDOWN_MS, 'token rejected');
            throw new SubscriptionError('auth', message);
        }
        throw err;
    } finally {
        try { (run as any).close?.(); } catch { /* already closed */ }
    }

    const durationMs = Date.now() - t0;
    logger.info(
        `[claude-sub] ${opts.label || 'turn'} served by ${picked.label} · ` +
        `model=${actualModel || opts.model || cfg.model || 'default'} ` +
        `in=${usage.inputTokens} out=${usage.outputTokens} cached=${cacheReadTokens} ` +
        `tools=${toolCalls.length} ${durationMs}ms`
    );

    return {
        text: text.join('').trim(),
        // One synthetic step: callers read steps to find which tools ran,
        // and the harness doesn't expose its own step boundaries.
        steps: [{ toolCalls, toolResults: [] }],
        usage,
        providerMetadata: { anthropic: { cacheReadInputTokens: cacheReadTokens } },
        model: actualModel,
        tokenId: picked.id,
        durationMs,
    };
}

/**
 * Run on the subscription if this request qualifies, otherwise return null
 * and let the caller do exactly what it did before.
 *
 * Every failure returns null rather than throwing: a burned pool must
 * never turn into a customer not getting a reply.
 */
export async function tryOnSubscription(
    providerInfo: { provider: string; useOwnKey?: boolean },
    opts: SubscriptionRunOpts
): Promise<SubscriptionResult | null> {
    try {
        if (!await shouldUseSubscription(providerInfo)) return null;
        return await runOnSubscription(opts);
    } catch (err: any) {
        const code = err instanceof SubscriptionError ? err.code : 'error';
        // Routine: a voice note or document arrived, or a tool this rail
        // can't express. Not worth a warning every time.
        const routine = code === 'unsupported_content' || code === 'untranslatable_tool' || code === 'disabled';
        const line = `[claude-sub] ${opts.label || 'turn'} not served (${code}: ${err.message}) — using the API key`;
        if (routine) logger.debug(line); else logger.warn(line);
        return null;
    }
}

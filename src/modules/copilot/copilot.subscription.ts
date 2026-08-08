// Running the copilot on a Claude subscription instead of the API.
//
// The API path bills per token against the platform key. For the handful
// of people who run this platform — not customers, not partners — a
// Claude subscription they already hold covers the same work at no
// per-token cost. This module is that second path.
//
// Two things make it work without duplicating the copilot:
//
//   1. The Agent SDK spawns the Claude Code CLI, which authenticates with
//      a subscription OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`) rather than
//      an API key. Each person's token is their own seat.
//
//   2. The CLI is a separate process, so it can't reach the in-process
//      tool registry — but this platform already exposes that registry
//      over Streamable HTTP at /api/mcp. The subprocess connects back to
//      it as an MCP client, which means the subscription copilot gets the
//      exact same tools as the API one, from one definition.
//
// The honest limits, stated once here so nobody rediscovers them at 2am:
// a subscription's rate limit is sized for one human's day of work. That
// fits a copilot somebody is sitting in front of. It does not fit the
// WhatsApp agents, which answer around the clock — those stay on the API,
// and this module refuses to serve them.

import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { config } from '../../config';

export type ClaudeAccount = {
    /** Stable id used in the user→account mapping. */
    id: string;
    label: string;
    /** SystemConfig key holding the OAuth token. */
    configKey: string;
    tokenSet: boolean;
};

const ACCOUNT_SLOTS: { id: string; label: string; configKey: string }[] = [
    { id: 'a', label: 'Account 1', configKey: 'CLAUDE_SUB_TOKEN_A' },
    { id: 'b', label: 'Account 2', configKey: 'CLAUDE_SUB_TOKEN_B' },
    { id: 'c', label: 'Account 3', configKey: 'CLAUDE_SUB_TOKEN_C' },
];

const CONFIG_ENABLED = 'CLAUDE_SUB_ENABLED';
const CONFIG_MAP = 'CLAUDE_SUB_USER_MAP';   // { [userId]: accountId }
const CONFIG_MODEL = 'CLAUDE_SUB_MODEL';

export class SubscriptionError extends Error {
    code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

// ─── Configuration ──────────────────────────────────────────────────

export async function loadSubscriptionConfig() {
    const keys = [CONFIG_ENABLED, CONFIG_MAP, CONFIG_MODEL, ...ACCOUNT_SLOTS.map(s => s.configKey)];
    const rows = await prisma.systemConfig.findMany({ where: { key: { in: keys } } });
    const map = Object.fromEntries(rows.map(r => [r.key, (r.value || '').trim()]));

    let userMap: Record<string, string> = {};
    try {
        userMap = map[CONFIG_MAP] ? JSON.parse(map[CONFIG_MAP]) : {};
    } catch { userMap = {}; }

    const accounts: ClaudeAccount[] = ACCOUNT_SLOTS.map(s => ({
        id: s.id,
        label: s.label,
        configKey: s.configKey,
        tokenSet: !!map[s.configKey],
    }));

    return {
        enabled: map[CONFIG_ENABLED] === 'true',
        model: map[CONFIG_MODEL] || null,
        accounts,
        userMap,
        // Kept out of the returned object everywhere except the runner —
        // a token is a credential, not configuration to be echoed back.
        tokenFor: (accountId: string) => {
            const slot = ACCOUNT_SLOTS.find(s => s.id === accountId);
            return slot ? (map[slot.configKey] || null) : null;
        },
    };
}

export async function saveSubscriptionConfig(next: {
    enabled?: boolean;
    model?: string | null;
    userMap?: Record<string, string>;
    tokens?: Record<string, string>;   // accountId → token
}) {
    const writes: { key: string; value: string }[] = [];
    if (next.enabled !== undefined) writes.push({ key: CONFIG_ENABLED, value: next.enabled ? 'true' : 'false' });
    if (next.model !== undefined) writes.push({ key: CONFIG_MODEL, value: next.model || '' });
    if (next.userMap) writes.push({ key: CONFIG_MAP, value: JSON.stringify(next.userMap) });
    for (const [accountId, token] of Object.entries(next.tokens || {})) {
        const slot = ACCOUNT_SLOTS.find(s => s.id === accountId);
        if (slot) writes.push({ key: slot.configKey, value: token });
    }

    for (const w of writes) {
        await prisma.systemConfig.upsert({
            where: { key: w.key },
            update: { value: w.value },
            create: { key: w.key, value: w.value },
        });
    }
}

/** Which account serves this user, or null if they aren't on a seat. */
export async function accountForUser(userId: string): Promise<string | null> {
    const cfg = await loadSubscriptionConfig();
    if (!cfg.enabled) return null;
    const accountId = cfg.userMap[userId];
    if (!accountId) return null;
    return cfg.tokenFor(accountId) ? accountId : null;
}

// ─── Tool access for the subprocess ─────────────────────────────────

const INTERNAL_KEY_NAME = 'copilot-subscription (internal)';

/**
 * A key the spawned CLI uses to call this platform's own MCP endpoint.
 *
 * Minted once per user+workspace and reused. It carries exactly the
 * access that user already has — the MCP layer scopes every tool to the
 * key's workspace, so this grants nothing new; it only gives a
 * subprocess a way to present the same identity.
 */
async function internalMcpKey(userId: string, workspaceId: string): Promise<string> {
    const existing = await prisma.apiKey.findFirst({
        where: { userId, workspaceId, name: INTERNAL_KEY_NAME },
        select: { key: true },
    });
    if (existing) return existing.key;

    const key = `sk_${crypto.randomBytes(24).toString('hex')}`;
    await prisma.apiKey.create({ data: { key, userId, workspaceId, name: INTERNAL_KEY_NAME } });
    logger.info({ userId, workspaceId }, '[copilot-sub] minted internal MCP key');
    return key;
}

// ─── Running a turn ─────────────────────────────────────────────────

export type SubscriptionTurn = {
    text: string;
    toolCalls: { name: string; args: any }[];
    durationMs: number;
    accountId: string;
    /** Reported by the SDK. Informational — nothing is billed for it. */
    usage: { inputTokens: number; outputTokens: number } | null;
};

/**
 * Run one copilot turn on a subscription seat.
 *
 * Throws SubscriptionError when the user isn't on a seat — callers fall
 * back to the API path rather than failing the request, so losing a seat
 * degrades cost, not function.
 */
export async function runSubscriptionTurn(opts: {
    userId: string;
    workspaceId: string;
    systemPrompt: string;
    message: string;
    /** Prior turns, oldest first. */
    history: { role: string; content: string }[];
}): Promise<SubscriptionTurn> {
    const cfg = await loadSubscriptionConfig();
    if (!cfg.enabled) throw new SubscriptionError('disabled', 'Subscription mode is off.');

    const accountId = cfg.userMap[opts.userId];
    if (!accountId) throw new SubscriptionError('no_seat', 'This user is not assigned a Claude seat.');
    const token = cfg.tokenFor(accountId);
    if (!token) throw new SubscriptionError('no_token', `No token stored for ${accountId}.`);

    const mcpKey = await internalMcpKey(opts.userId, opts.workspaceId);
    const base = (config.FRONTEND_URL || 'https://chatbot.tural.ai').replace(/\/$/, '');

    // The conversation is flattened into the prompt because the Agent SDK
    // drives its own session; the copilot's history lives in our DB, so
    // this is the one place the two models of "a conversation" meet.
    const transcript = opts.history
        .map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
        .join('\n\n');
    const prompt = transcript
        ? `${transcript}\n\nUser: ${opts.message}`
        : opts.message;

    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const t0 = Date.now();

    const text: string[] = [];
    const toolCalls: { name: string; args: any }[] = [];
    let usage: SubscriptionTurn['usage'] = null;

    const run = query({
        prompt,
        options: {
            ...(cfg.model ? { model: cfg.model } : {}),
            systemPrompt: opts.systemPrompt,
            // Only this platform's own tools. The CLI's built-in file and
            // bash tools are deliberately absent: the copilot's job is to
            // operate a workspace through the API, not to touch the box
            // the server runs on.
            mcpServers: {
                chatbot: {
                    type: 'http',
                    url: `${base}/api/mcp`,
                    headers: { Authorization: `Bearer ${mcpKey}` },
                },
            },
            allowedTools: ['mcp__chatbot__*'],
            // Nothing here should ever wait on a human at a terminal —
            // an unanswered prompt would hang the HTTP request.
            permissionMode: 'dontAsk',
            maxTurns: 15,
            // `env` REPLACES the environment rather than merging, so the
            // base has to be copied or the subprocess loses PATH/HOME.
            // ANTHROPIC_API_KEY is stripped explicitly: if it were present
            // the CLI would silently prefer it and bill the API — the
            // exact failure this whole module exists to avoid.
            env: {
                ...process.env,
                ANTHROPIC_API_KEY: undefined,
                ANTHROPIC_AUTH_TOKEN: undefined,
                CLAUDE_CODE_OAUTH_TOKEN: token,
            },
        },
    });

    try {
        for await (const msg of run as any) {
            if (msg.type === 'assistant') {
                for (const block of msg.message?.content || []) {
                    if (block.type === 'text' && block.text) text.push(block.text);
                    if (block.type === 'tool_use') {
                        toolCalls.push({
                            // Strip the mcp__chatbot__ prefix so the UI shows
                            // the same tool names the API path does.
                            name: String(block.name || '').replace(/^mcp__chatbot__/, ''),
                            args: block.input ?? null,
                        });
                    }
                }
            } else if (msg.type === 'result') {
                if (msg.subtype && msg.subtype !== 'success') {
                    throw new SubscriptionError('run_failed', `Claude Code returned ${msg.subtype}.`);
                }
                if (typeof msg.result === 'string' && msg.result.trim()) {
                    // The result carries the final answer; prefer it over
                    // the accumulated deltas when both are present.
                    text.length = 0;
                    text.push(msg.result);
                }
                const u = msg.usage || {};
                usage = {
                    inputTokens: Number(u.input_tokens || 0),
                    outputTokens: Number(u.output_tokens || 0),
                };
            } else if (msg.type === 'system' && msg.subtype === 'init') {
                const broken = (msg.mcp_servers || []).filter(
                    (s: any) => s.status === 'failed' || s.status === 'needs-auth');
                if (broken.length) {
                    logger.warn({ broken }, '[copilot-sub] MCP server unavailable — tools will be missing');
                }
            }
        }
    } finally {
        try { (run as any).close?.(); } catch { /* already closed */ }
    }

    return {
        text: text.join('').trim(),
        toolCalls,
        durationMs: Date.now() - t0,
        accountId,
        usage,
    };
}

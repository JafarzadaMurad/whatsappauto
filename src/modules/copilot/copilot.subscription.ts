// The copilot's half of the Claude subscription rail.
//
// Everything about tokens, pooling and routing lives in
// `lib/claude-subscription` — shared with the WhatsApp, Instagram,
// campaign and oversight paths. What is specific to the copilot is how it
// hands over its tools: they are defined as raw JSON Schema, which the
// in-process bridge can't express, but the platform already publishes the
// same registry over Streamable HTTP at /api/mcp. So the copilot points
// the subprocess back at our own MCP endpoint instead.

import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { runOnSubscription, shouldUseSubscription, SubscriptionError } from '../../lib/claude-subscription';

export { SubscriptionError };

const INTERNAL_KEY_NAME = 'copilot-subscription (internal)';

/**
 * A key the spawned CLI uses to call this platform's own MCP endpoint.
 *
 * Minted once per user+workspace and reused. It carries exactly the
 * access that user already has — the MCP layer scopes every tool to the
 * key's workspace — so this grants nothing new; it only gives a
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

export type CopilotSubscriptionTurn = {
    text: string;
    toolCalls: { name: string; args: any }[];
    durationMs: number;
    tokenId: string;
    /** What the harness actually ran. */
    model: string | null;
    /** Pooled turns are billed like API ones — the customer bought the work. */
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
    providerMetadata: { anthropic: { cacheReadInputTokens: number } };
};

/** Is the copilot allowed to use the pool for this workspace's provider? */
export async function copilotCanUseSubscription(providerInfo: {
    provider: string; useOwnKey?: boolean;
}): Promise<boolean> {
    return shouldUseSubscription(providerInfo);
}

export async function runCopilotSubscriptionTurn(opts: {
    userId: string;
    workspaceId: string;
    systemPrompt: string;
    message: string;
    /** Prior turns, oldest first. */
    history: { role: string; content: string }[];
    /** What the user picked in the copilot's model dropdown. */
    model?: string;
}): Promise<CopilotSubscriptionTurn> {
    const mcpKey = await internalMcpKey(opts.userId, opts.workspaceId);
    const base = (config.FRONTEND_URL || 'https://chatbot.tural.ai').replace(/\/$/, '');

    const res = await runOnSubscription({
        label: 'copilot',
        model: opts.model,
        system: opts.systemPrompt,
        messages: [...opts.history, { role: 'user', content: opts.message }],
        mcpServers: {
            chatbot: {
                type: 'http',
                url: `${base}/api/mcp`,
                headers: { Authorization: `Bearer ${mcpKey}` },
            },
        },
        allowedTools: ['mcp__chatbot__*'],
    });

    return {
        text: res.text,
        // The shared runner strips its own bridge prefix; the HTTP server
        // carries a different one, so trim that here.
        toolCalls: res.steps.flatMap(s => s.toolCalls.map(tc => ({
            name: tc.toolName.replace(/^mcp__chatbot__/, ''),
            args: tc.args,
        }))),
        durationMs: res.durationMs,
        tokenId: res.tokenId,
        model: res.model,
        usage: res.usage,
        providerMetadata: res.providerMetadata,
    };
}

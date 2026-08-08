// cai credit system — enforcement wrapper around LLM calls.
//
// Every generateText() site in the codebase should go through
// runWithCredits(). This function:
//   1. Resolves the workspace's plan and cai balance
//   2. Decides whether to use the AiProvider's own key (BYOK, no cai)
//      or the platform key (bill against cai)
//   3. Pre-checks the balance for platform calls (throws
//      CreditsExhaustedError if empty and plan.overageBehavior !== top_up)
//   4. Runs the caller-supplied generation function with the resolved key
//   5. Records the actual usage in CreditLedger and decrements the pool
//
// Usage inside ai.service.ts:
//     const { result, credits } = await runWithCredits({
//         workspaceId, userId, providerUpper: providerInfo.provider,
//         providerApiKey: providerInfo.apiKey,
//         providerUseOwnKey: providerInfo.useOwnKey,
//         model: agent.model, cause: 'whatsapp_reply',
//     }, (apiKey) => generateText({ model: buildModel(apiKey), ... }));

import { prisma } from './prisma';
import { logger } from '../utils/logger';
import {
    priceUsage,
    extractUsage,
    resolvePlatformKey,
    providerLower,
} from './ai-pricing';

export class CreditsExhaustedError extends Error {
    remaining: number;
    limit: number;
    constructor(remaining: number, limit: number) {
        super(`cai credit pool exhausted (${remaining}/${limit})`);
        this.name = 'CreditsExhaustedError';
        this.remaining = remaining;
        this.limit = limit;
    }
}

export class PlatformKeyMissingError extends Error {
    provider: string;
    constructor(provider: string) {
        super(`Platform API key for ${provider} is not configured — admin must set it in System Config`);
        this.name = 'PlatformKeyMissingError';
        this.provider = provider;
    }
}

export type CreditCause =
    | 'whatsapp_reply'
    | 'instagram_dm'
    | 'campaign'
    | 'oversight'
    | 'ads_gen'
    | 'mcp_tool'
    | 'router'
    | 'whisper'
    | 'other';

export type RunOpts = {
    workspaceId: string | null;
    userId?: string | null;
    providerUpper: string;             // 'CLAUDE' | 'OPENAI' | 'GEMINI'
    providerApiKey: string;            // whatever AiProvider.apiKey holds
    providerUseOwnKey?: boolean;       // AiProvider.useOwnKey — allowed only on Pro+
    model: string;                     // agent.model
    cause: CreditCause;
};

export type RunResult<T> = {
    result: T;
    credits: number;
    realCostUsd: number;
    usedOwnKey: boolean;
};

// Load workspace + plan in a single query. Returns null if the
// workspace has no active plan (which means the credit pool is 0
// and every call gets blocked — free-tier users are expected to be
// on the default plan with monthlyCredits > 0).
async function loadWorkspaceCtx(workspaceId: string) {
    return prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
            id: true,
            creditsUsedThisPeriod: true,
            creditTopUp: true,
            periodResetAt: true,
            plan: {
                select: {
                    id: true,
                    monthlyCredits: true,
                    allowCustomApiKeys: true,
                    overageBehavior: true,
                },
            },
        },
    });
}

/**
 * Run an LLM generation while enforcing cai quotas.
 *
 * The caller passes a `fn` that takes the resolved API key and does
 * the actual generateText() / openai / anthropic call. This wrapper
 * decides which key to hand it, gates the call on remaining credits
 * (unless the plan allows overage), and after success records the
 * usage. If the LLM call itself throws, no credits are consumed and
 * no ledger row is written — same as if the call never happened.
 */
export async function runWithCredits<T>(
    opts: RunOpts,
    fn: (apiKey: string) => Promise<T>
): Promise<RunResult<T>> {
    const { workspaceId, userId, providerUpper, providerApiKey, providerUseOwnKey, model, cause } = opts;

    // 1. Decide platform-vs-BYOK.
    let usedOwnKey = false;
    let apiKey = providerApiKey;

    let ctx: Awaited<ReturnType<typeof loadWorkspaceCtx>> = null;
    if (workspaceId) ctx = await loadWorkspaceCtx(workspaceId);

    if (providerUseOwnKey && providerApiKey && ctx?.plan?.allowCustomApiKeys) {
        usedOwnKey = true;
    } else {
        // Fall back to the platform key.
        const platformKey = await resolvePlatformKey(providerUpper);
        if (!platformKey) {
            // Last-resort fallback: if the AiProvider row has a real key
            // (legacy BYOK from before the credit system), use it but
            // still deduct credits — the admin hasn't set up platform
            // keys yet. This keeps existing installs working during the
            // rollout window.
            if (providerApiKey) {
                apiKey = providerApiKey;
                logger.warn({ providerUpper, workspaceId }, '[credit-guard] platform key missing — falling back to AiProvider key (still billed)');
            } else {
                throw new PlatformKeyMissingError(providerUpper);
            }
        } else {
            apiKey = platformKey;
        }
    }

    // 2. Pre-check balance for platform calls (skip on BYOK).
    if (!usedOwnKey && ctx?.plan) {
        const budget = (ctx.plan.monthlyCredits || 0) + (ctx.creditTopUp || 0);
        const used = ctx.creditsUsedThisPeriod || 0;
        if (used >= budget && ctx.plan.overageBehavior === 'hard_block') {
            throw new CreditsExhaustedError(Math.max(0, budget - used), budget);
        }
    } else if (!usedOwnKey && !ctx?.plan && workspaceId) {
        // No plan at all → block. (Workspaces with no subscription can't
        // burn our platform key.)
        throw new CreditsExhaustedError(0, 0);
    }

    // 3. Call the model.
    const result: any = await fn(apiKey);

    // 4. Price the usage and write ledger. Non-fatal on errors —
    // the LLM already answered, we don't want to make the caller
    // wait for our accounting.
    try {
        const usage = extractUsage(providerUpper, result);
        const pricedProvider = providerLower(providerUpper);
        const { realCostUsd, credits } = await priceUsage(pricedProvider, model, usage);
        const chargedCredits = usedOwnKey ? 0 : credits;

        if (workspaceId) {
            await prisma.$transaction([
                prisma.creditLedger.create({
                    data: {
                        workspaceId,
                        userId: userId || null,
                        provider: pricedProvider,
                        model,
                        inputTokens: usage.inputTokens,
                        outputTokens: usage.outputTokens,
                        cachedTokens: usage.cachedTokens || 0,
                        realCostUsd,
                        creditsUsed: chargedCredits,
                        usedOwnKey,
                        cause,
                    },
                }),
                ...(chargedCredits > 0
                    ? [prisma.workspace.update({
                        where: { id: workspaceId },
                        data: { creditsUsedThisPeriod: { increment: chargedCredits } },
                    })]
                    : []),
            ]);
        }

        return { result, credits: chargedCredits, realCostUsd, usedOwnKey };
    } catch (err: any) {
        logger.error({ err: err.message, workspaceId, model }, '[credit-guard] ledger write failed');
        return { result, credits: 0, realCostUsd: 0, usedOwnKey };
    }
}

/**
 * Post-hoc usage recorder. Same accounting as runWithCredits() but
 * runs AFTER an existing generateText() call the caller already made.
 * Use this at LLM call sites that are too tangled to refactor into
 * the runWithCredits() wrapper — you keep your aiModel construction
 * and generateText() unchanged, then hand us the result and we
 * price + record + decrement the workspace pool. Non-throwing:
 * ledger write failures log but don't break the caller.
 */
export async function recordUsagePostHoc(
    opts: {
        workspaceId: string | null;
        userId?: string | null;
        agentId?: string | null;
        providerInfo: { provider: string; apiKey: string; useOwnKey?: boolean };
        model: string;
        cause: CreditCause;
    },
    aiResult: any
): Promise<number | null> {
    const { workspaceId, userId, agentId, providerInfo, model, cause } = opts;

    // Turns served by the Claude subscription pool are billed exactly like
    // API turns. What the customer buys is the work, priced by the model
    // they picked — how we sourced the capacity is our side of the ledger,
    // not theirs. The subscription changes our cost, not their price.
    if (!workspaceId) {
        logger.warn({ providerInfo: providerInfo.provider, model, cause }, '[credit-guard] skipped — no workspaceId');
        return null;
    }
    try {
        // Fetch plan settings to know if BYOK is allowed (governs
        // `usedOwnKey` — even if useOwnKey=true, we only honour it on
        // a plan that has allowCustomApiKeys).
        const ws = await loadWorkspaceCtx(workspaceId);
        const usedOwnKey = !!providerInfo.useOwnKey && !!ws?.plan?.allowCustomApiKeys;

        const usage = extractUsage(providerInfo.provider, aiResult);
        const pricedProvider = providerLower(providerInfo.provider);
        const { realCostUsd, credits, priceRow } = await priceUsage(pricedProvider, model, usage);
        const chargedCredits = usedOwnKey ? 0 : credits;

        // Loud info-level log on every ledger write. Grep for
        // "[credit-guard] recorded" in pm2 logs to see billing running.
        // A row here with inputTokens=0 or credits=0 means the AI SDK
        // returned an empty usage block — extractUsage returned zeroes
        // — so the model/provider probably changed how usage is shaped.
        logger.info({
            workspaceId, userId, cause, provider: pricedProvider, model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedTokens: usage.cachedTokens || 0,
            realCostUsd: Number(realCostUsd.toFixed(6)),
            credits: chargedCredits,
            usedOwnKey,
            priceRowFound: !!priceRow,
            balanceUpdated: chargedCredits > 0,
        }, '[credit-guard] recorded');

        await prisma.$transaction([
            prisma.creditLedger.create({
                data: {
                    workspaceId,
                    userId: userId || null,
                    agentId: agentId || null,
                    provider: pricedProvider,
                    model,
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    cachedTokens: usage.cachedTokens || 0,
                    realCostUsd,
                    creditsUsed: chargedCredits,
                    usedOwnKey,
                    cause,
                },
            }),
            ...(chargedCredits > 0
                ? [prisma.workspace.update({
                    where: { id: workspaceId },
                    data: { creditsUsedThisPeriod: { increment: chargedCredits } },
                })]
                : []),
        ]);
        // Handed back so a caller that wants to show the user what a
        // turn cost doesn't have to price it a second time.
        return chargedCredits;
    } catch (err: any) {
        logger.error({
            err: err.message,
            stack: err.stack?.slice(0, 500),
            workspaceId,
            provider: providerInfo.provider,
            model,
            cause,
        }, '[credit-guard] post-hoc ledger write failed');
        return null;
    }
}

/**
 * Read-only helper for the /api/credits endpoint. Returns the cai
 * balance shape the user dashboard renders. `remaining` can go
 * negative for workspaces on overage → clamp to 0 for display.
 */
export async function getCreditBalance(workspaceId: string) {
    const ws = await loadWorkspaceCtx(workspaceId);
    if (!ws) return null;
    const budget = (ws.plan?.monthlyCredits || 0) + (ws.creditTopUp || 0);
    const used = ws.creditsUsedThisPeriod || 0;
    return {
        monthlyCredits: ws.plan?.monthlyCredits || 0,
        topUp: ws.creditTopUp || 0,
        totalBudget: budget,
        used,
        remaining: Math.max(0, budget - used),
        periodResetAt: ws.periodResetAt,
        allowCustomApiKeys: !!ws.plan?.allowCustomApiKeys,
        overageBehavior: ws.plan?.overageBehavior || 'hard_block',
    };
}

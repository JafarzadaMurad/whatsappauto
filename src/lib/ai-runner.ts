// One-stop helper that combines the AI SDK model factory with the
// cai credit-guard. Every LLM callsite (WhatsApp reply, IG DM,
// campaign draft, oversight review, ...) goes through this so:
//   - The workspace's plan is checked (hard-block if out of cai)
//   - The right apiKey (BYOK vs platform) is injected into the model
//   - The response usage is priced and recorded in CreditLedger
//   - The workspace pool is decremented atomically with the ledger row
//
// Callers pass the same `providerInfo` object they already had from
// their `agent.provider` include and the same generateText() options
// they used before — the wrapper takes care of model construction and
// billing.

import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

import { runWithCredits, CreditCause } from './credit-guard';
import { tryOnSubscription } from './claude-subscription';

export type ProviderInfoLike = {
    provider: string;      // 'OPENAI' | 'CLAUDE' | 'GEMINI' | 'GLM' | 'ANTHROPIC' | 'GOOGLE'
    apiKey: string;
    useOwnKey?: boolean;
};

export type RunAgentGenerateOpts = {
    workspaceId: string | null;
    userId?: string | null;
    providerInfo: ProviderInfoLike;
    model: string;
    cause: CreditCause;
    // Everything below is forwarded verbatim to generateText(). We
    // keep `any` because the AI SDK's shape drifts between versions
    // and the callers already type-cast this stuff.
    system?: string;
    messages?: any[];
    tools?: any;
    prompt?: string;
    schema?: any;
    stopWhen?: any;
    [extra: string]: any;
};

/**
 * Build the model factory the AI SDK expects, given the provider
 * label and an apiKey the credit-guard resolved for us.
 */
function buildAiModel(providerUpper: string, apiKey: string, model: string): any {
    const p = providerUpper.toUpperCase();
    if (p === 'OPENAI') return createOpenAI({ apiKey } as any).chat(model);
    if (p === 'CLAUDE' || p === 'ANTHROPIC') return createAnthropic({ apiKey })(model);
    if (p === 'GEMINI' || p === 'GOOGLE') return createGoogleGenerativeAI({ apiKey })(model);
    if (p === 'GLM') return createOpenAI({ apiKey, baseURL: 'https://api.z.ai/api/paas/v4/' } as any).chat(model);
    throw new Error(`Unknown AI provider: ${providerUpper}`);
}

/**
 * Drop-in replacement for `generateText({ model: ... , ... })`.
 * Returns the AI SDK result unchanged so callers keep reading
 * `.text`, `.steps`, `.usage`, `.providerMetadata` as before.
 */
export async function runAgentGenerate<T = any>(opts: RunAgentGenerateOpts): Promise<T> {
    const { workspaceId, userId, providerInfo, model, cause, ...gen } = opts;
    const { result } = await runWithCredits<T>(
        {
            workspaceId,
            userId,
            providerUpper: providerInfo.provider,
            providerApiKey: providerInfo.apiKey,
            providerUseOwnKey: !!providerInfo.useOwnKey,
            model,
            cause,
        },
        async (apiKey) => {
            const aiModel = buildAiModel(providerInfo.provider, apiKey, model);
            return generateText({ ...gen, model: aiModel } as any) as any;
        }
    );
    return result;
}

/**
 * `generateText`, but routed: a Claude request that qualifies for the
 * subscription pool runs there instead, free of charge.
 *
 * Callers pass exactly what they passed generateText, plus the
 * providerInfo they already had. The returned object is shaped the same
 * either way — `.text`, `.steps`, `.usage`, `.providerMetadata` — so
 * billing prices a pooled turn exactly like an API one. The subscription
 * changes what the capacity costs us, not what the work costs the
 * customer. `__subscription` is there for logging, not for billing.
 *
 * Anything the subscription can't serve (a workspace on its own key, an
 * image in the conversation, an exhausted pool) simply falls through to
 * the original call. Failure here costs money, never a reply.
 */
export async function generateTextRouted(
    providerInfo: ProviderInfoLike,
    label: string,
    genOpts: any
): Promise<any> {
    const sub = await tryOnSubscription(providerInfo, {
        label,
        system: genOpts.system,
        messages: genOpts.messages || (genOpts.prompt ? [{ role: 'user', content: genOpts.prompt }] : []),
        tools: genOpts.tools,
    });
    if (sub) {
        return {
            text: sub.text,
            steps: sub.steps,
            usage: sub.usage,
            providerMetadata: sub.providerMetadata,
            __subscription: true,
            __subscriptionToken: sub.tokenId,
        };
    }
    return generateText(genOpts);
}

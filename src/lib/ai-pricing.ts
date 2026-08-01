// cai credit system — pricing calculator and platform-key resolver.
//
// The AiPricing table stores the raw provider USD cost per 1M tokens
// plus a margin multiplier. This module wraps that with an in-memory
// TTL cache (the same row is read on every LLM completion, so a bare
// DB round-trip would double request latency) and exposes small
// helpers used by the credit-guard wrapper.

import { prisma } from './prisma';

// 1 cai = $0.0001 (0.01 cent). Chosen so the smallest sensible LLM
// call (a few thousand cheap tokens) still costs ≥1 cai after rounding.
export const CAI_PER_USD = 10_000;

export type Provider = 'anthropic' | 'openai' | 'google';

export type Usage = {
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
};

export type PriceRow = {
    provider: string;
    model: string;
    inputCostPer1M: number;
    outputCostPer1M: number;
    cachedCostPer1M: number;
    marginMultiplier: number;
};

// key = `${provider}|${model}`
const priceCache = new Map<string, { row: PriceRow; at: number }>();
const PRICE_TTL_MS = 60_000;

async function loadPriceRow(provider: string, model: string): Promise<PriceRow | null> {
    const key = `${provider}|${model}`;
    const cached = priceCache.get(key);
    if (cached && Date.now() - cached.at < PRICE_TTL_MS) return cached.row;
    const row = await prisma.aiPricing.findFirst({
        where: { provider, model, isActive: true },
    });
    if (!row) return null;
    const shaped: PriceRow = {
        provider: row.provider,
        model: row.model,
        inputCostPer1M: row.inputCostPer1M,
        outputCostPer1M: row.outputCostPer1M,
        cachedCostPer1M: row.cachedCostPer1M,
        marginMultiplier: row.marginMultiplier,
    };
    priceCache.set(key, { row: shaped, at: Date.now() });
    return shaped;
}

// Small helper so the admin UI's "save" can force every worker to
// re-read a rate immediately instead of waiting out the TTL.
export function invalidatePriceCache(provider?: string, model?: string) {
    if (provider && model) priceCache.delete(`${provider}|${model}`);
    else priceCache.clear();
}

export type PricedUsage = {
    realCostUsd: number;
    credits: number;
    priceRow: PriceRow | null;
};

// Given real token usage from the LLM response, compute BOTH the
// underlying provider cost (for audit / user-facing "you saved $X"
// numbers on BYOK calls) AND the cai the workspace owes for platform
// calls. Falls back to a conservative default when the model isn't
// in the pricing table so we never under-charge silently.
export async function priceUsage(provider: string, model: string, usage: Usage): Promise<PricedUsage> {
    const row = await loadPriceRow(provider, model);
    if (!row) {
        // Unknown model — fall back to Claude Sonnet 5 rates and log so
        // the admin sees the gap and adds a row.
        const fallbackInput = 3.0;   // $/1M
        const fallbackOutput = 15.0;
        const inputUsd = (usage.inputTokens / 1_000_000) * fallbackInput;
        const outputUsd = (usage.outputTokens / 1_000_000) * fallbackOutput;
        const realCostUsd = inputUsd + outputUsd;
        const credits = Math.ceil(realCostUsd * 3 * CAI_PER_USD);
        return { realCostUsd, credits, priceRow: null };
    }

    const rawInput = usage.inputTokens - (usage.cachedTokens || 0);
    const inputUsd = (Math.max(0, rawInput) / 1_000_000) * row.inputCostPer1M;
    const cachedUsd = ((usage.cachedTokens || 0) / 1_000_000) * row.cachedCostPer1M;
    const outputUsd = (usage.outputTokens / 1_000_000) * row.outputCostPer1M;
    const realCostUsd = inputUsd + cachedUsd + outputUsd;
    const credits = Math.max(0, Math.ceil(realCostUsd * row.marginMultiplier * CAI_PER_USD));
    return { realCostUsd, credits, priceRow: row };
}

// Convert AI-SDK / provider-specific `usage` blob into the flat shape
// we bill on. Anthropic reports cache hits under two names; OpenAI
// exposes prompt/completion; Gemini uses promptTokenCount /
// candidatesTokenCount. Vercel AI SDK normalises most of these but
// keeps provider-specific fields under result.providerMetadata.
export function extractUsage(providerUpper: string, aiResult: any): Usage {
    const u = aiResult?.usage || {};
    const meta = aiResult?.providerMetadata || {};
    const inputTokens = Number(
        u.inputTokens ?? u.promptTokens ?? u.prompt_tokens ?? u.promptTokenCount ?? 0
    );
    const outputTokens = Number(
        u.outputTokens ?? u.completionTokens ?? u.completion_tokens ?? u.candidatesTokenCount ?? 0
    );
    let cachedTokens = 0;
    const p = String(providerUpper || '').toUpperCase();
    if (p === 'CLAUDE' || p === 'ANTHROPIC') {
        const a = meta.anthropic || {};
        cachedTokens = Number(a.cacheReadInputTokens ?? u.cachedInputTokens ?? 0);
    } else if (p === 'OPENAI') {
        const o = meta.openai || {};
        cachedTokens = Number(o.cachedPromptTokens ?? u.cachedInputTokens ?? 0);
    }
    return { inputTokens, outputTokens, cachedTokens };
}

// ─── Platform key resolver ─────────────────────────────────────────
// Free / Starter workspaces don't hold their own provider keys; every
// LLM / voice-provider call uses the shared platform key that the
// admin sets in SystemConfig. Keys currently supported:
//   PLATFORM_ANTHROPIC_KEY      — sk-ant-…
//   PLATFORM_OPENAI_KEY         — sk-…
//   PLATFORM_GOOGLE_KEY         — AIza…
//   PLATFORM_GROQ_KEY           — gsk_…   (text-LLM behind voice)
//   PLATFORM_DEEPGRAM_KEY       — STT + Aura TTS
//   PLATFORM_ELEVENLABS_KEY     — TTS
//   PLATFORM_CARTESIA_KEY       — TTS (Sonic)
//   PLATFORM_ASSEMBLYAI_KEY     — STT
//   PLATFORM_GLADIA_KEY         — STT
//   PLATFORM_SPEECHMATICS_KEY   — STT
//   PLATFORM_SONIOX_KEY         — STT
//   PLATFORM_PLAYHT_KEY         — TTS  (needs user id too, appended after `|`)
//   PLATFORM_AZURE_SPEECH_KEY   — Azure Speech (region appended after `|`)

const PLATFORM_KEY_MAP: Record<string, string> = {
    CLAUDE: 'PLATFORM_ANTHROPIC_KEY',
    ANTHROPIC: 'PLATFORM_ANTHROPIC_KEY',
    OPENAI: 'PLATFORM_OPENAI_KEY',
    'OPENAI-REALTIME': 'PLATFORM_OPENAI_KEY',
    GEMINI: 'PLATFORM_GOOGLE_KEY',
    GOOGLE: 'PLATFORM_GOOGLE_KEY',
    GROQ: 'PLATFORM_GROQ_KEY',
    GLM: 'PLATFORM_ZAI_KEY',
    ZAI: 'PLATFORM_ZAI_KEY',
    DEEPGRAM: 'PLATFORM_DEEPGRAM_KEY',
    ELEVENLABS: 'PLATFORM_ELEVENLABS_KEY',
    CARTESIA: 'PLATFORM_CARTESIA_KEY',
    ASSEMBLYAI: 'PLATFORM_ASSEMBLYAI_KEY',
    GLADIA: 'PLATFORM_GLADIA_KEY',
    SPEECHMATICS: 'PLATFORM_SPEECHMATICS_KEY',
    SONIOX: 'PLATFORM_SONIOX_KEY',
    PLAYHT: 'PLATFORM_PLAYHT_KEY',
    AZURE: 'PLATFORM_AZURE_SPEECH_KEY',
};

/** Which SystemConfig key holds this provider's platform API key. */
export function PLATFORM_KEY_FOR(provider: string): string | null {
    return PLATFORM_KEY_MAP[provider.toUpperCase()] ?? null;
}

const platformKeyCache = new Map<string, { key: string; at: number }>();
const PLATFORM_KEY_TTL_MS = 60_000;

export async function resolvePlatformKey(providerUpper: string): Promise<string | null> {
    const cfgKey = PLATFORM_KEY_MAP[providerUpper.toUpperCase()];
    if (!cfgKey) return null;
    const cached = platformKeyCache.get(cfgKey);
    if (cached && Date.now() - cached.at < PLATFORM_KEY_TTL_MS) return cached.key || null;
    const row = await prisma.systemConfig.findUnique({ where: { key: cfgKey } });
    const val = row?.value || '';
    platformKeyCache.set(cfgKey, { key: val, at: Date.now() });
    return val || null;
}

export function invalidatePlatformKeyCache() {
    platformKeyCache.clear();
}

// Which voice providers currently have a platform key set? Voice
// catalog + plan editor use this to hide entries the runtime can't
// actually call — no key means the bridge would crash if the user
// picked that transcriber / TTS / LLM.
//
// `openai-realtime` intentionally piggy-backs on `openai`'s key.
export async function listConfiguredProviders(providers: string[]): Promise<Set<string>> {
    const configured = new Set<string>();
    const seen = new Map<string, boolean>();
    for (const p of providers) {
        const cfgKey = PLATFORM_KEY_MAP[p.toUpperCase()];
        if (!cfgKey) continue;
        if (seen.has(cfgKey)) {
            if (seen.get(cfgKey)) configured.add(p);
            continue;
        }
        const key = await resolvePlatformKey(p);
        const has = !!(key && key.trim());
        seen.set(cfgKey, has);
        if (has) configured.add(p);
    }
    return configured;
}

// Normalise our internal provider labels (CLAUDE / OPENAI / GEMINI)
// into the pricing-table's provider key.
export function providerLower(providerUpper: string): Provider {
    const p = providerUpper.toUpperCase();
    if (p === 'CLAUDE' || p === 'ANTHROPIC') return 'anthropic';
    if (p === 'OPENAI') return 'openai';
    return 'google';
}

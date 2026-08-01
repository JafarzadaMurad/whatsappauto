// Seeds AiPricing with the current provider price sheet on first boot,
// and exposes a `refreshAiPricing()` op for the admin "Refresh from
// catalog" button (upsert — overwrites the stored prices for every
// row in DEFAULT_ROWS, useful after a provider price change).
//
// Source of truth (2026-07):
//   Anthropic → https://platform.claude.com/docs/en/about-claude/pricing
//   OpenAI    → https://developers.openai.com/api/docs/pricing
//   Google    → https://ai.google.dev/gemini-api/docs/pricing
//   Z.ai      → https://docs.z.ai/guides/overview/pricing
// Update these numbers whenever a provider bumps a rate — the admin
// can then hit "Refresh from catalog" to propagate the change.

import { prisma } from './prisma';
import { logger } from '../utils/logger';
import { invalidatePriceCache } from './ai-pricing';
import { voiceCatalogPricingRows } from './voice-catalog';

type Row = {
    provider: 'anthropic' | 'openai' | 'google';
    model: string;
    inputCostPer1M: number;
    outputCostPer1M: number;
    cachedCostPer1M?: number;
};

// Verified 2026-07 against each provider's official pricing docs.
// Prices are in USD per 1M tokens. `cachedCostPer1M` is the cache-read
// hit cost (Anthropic 0.1× input; OpenAI cached input; Gemini context-
// cache read). Realtime audio rates are per audio-token, ~100 tokens
// per audio-second.
const DEFAULT_ROWS: Row[] = [
    // ─── Anthropic (Claude) ──────────────────────────────────────────
    // Opus 4.5 → 4.8 all share the same rate ($5 in / $25 out / $0.50 cache)
    { provider: 'anthropic', model: 'claude-opus-4-8',              inputCostPer1M: 5,    outputCostPer1M: 25,   cachedCostPer1M: 0.50 },
    { provider: 'anthropic', model: 'claude-opus-4-7',              inputCostPer1M: 5,    outputCostPer1M: 25,   cachedCostPer1M: 0.50 },
    { provider: 'anthropic', model: 'claude-opus-4-6',              inputCostPer1M: 5,    outputCostPer1M: 25,   cachedCostPer1M: 0.50 },
    { provider: 'anthropic', model: 'claude-opus-4-5',              inputCostPer1M: 5,    outputCostPer1M: 25,   cachedCostPer1M: 0.50 },
    // Sonnet 5 introductory pricing runs through Aug 31 2026; then $3/$15.
    { provider: 'anthropic', model: 'claude-sonnet-5',              inputCostPer1M: 2,    outputCostPer1M: 10,   cachedCostPer1M: 0.20 },
    { provider: 'anthropic', model: 'claude-sonnet-4-6',            inputCostPer1M: 3,    outputCostPer1M: 15,   cachedCostPer1M: 0.30 },
    { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929',   inputCostPer1M: 3,    outputCostPer1M: 15,   cachedCostPer1M: 0.30 },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001',    inputCostPer1M: 1,    outputCostPer1M: 5,    cachedCostPer1M: 0.10 },

    // ─── OpenAI (current lineup) ─────────────────────────────────────
    // GPT-5.6 tier (flagship reasoning family)
    { provider: 'openai',    model: 'gpt-5.6-sol',                  inputCostPer1M: 5,    outputCostPer1M: 30,   cachedCostPer1M: 0.50 },
    { provider: 'openai',    model: 'gpt-5.6-terra',                inputCostPer1M: 2.5,  outputCostPer1M: 15,   cachedCostPer1M: 0.25 },
    { provider: 'openai',    model: 'gpt-5.6-luna',                 inputCostPer1M: 1,    outputCostPer1M: 6,    cachedCostPer1M: 0.10 },
    // GPT-5.5 (standard chat) + Pro (premium reasoning, no cache)
    { provider: 'openai',    model: 'gpt-5.5',                      inputCostPer1M: 5,    outputCostPer1M: 30,   cachedCostPer1M: 0.50 },
    { provider: 'openai',    model: 'gpt-5.5-pro',                  inputCostPer1M: 30,   outputCostPer1M: 180,  cachedCostPer1M: 0 },
    // GPT-5.4 family
    { provider: 'openai',    model: 'gpt-5.4',                      inputCostPer1M: 2.5,  outputCostPer1M: 15,   cachedCostPer1M: 0.25 },
    { provider: 'openai',    model: 'gpt-5.4-mini',                 inputCostPer1M: 0.75, outputCostPer1M: 4.5,  cachedCostPer1M: 0.075 },
    { provider: 'openai',    model: 'gpt-5.4-nano',                 inputCostPer1M: 0.2,  outputCostPer1M: 1.25, cachedCostPer1M: 0.02 },
    { provider: 'openai',    model: 'gpt-5.4-pro',                  inputCostPer1M: 30,   outputCostPer1M: 180,  cachedCostPer1M: 0 },
    // GPT-5.3-codex (code specialist)
    { provider: 'openai',    model: 'gpt-5.3-codex',                inputCostPer1M: 1.75, outputCostPer1M: 14,   cachedCostPer1M: 0.175 },
    // chat-latest alias — mirrors the current flagship (5.6-sol)
    { provider: 'openai',    model: 'chat-latest',                  inputCostPer1M: 5,    outputCostPer1M: 30,   cachedCostPer1M: 0.50 },
    // Realtime — audio tokens (~100 per audio-second)
    { provider: 'openai',    model: 'gpt-realtime',             inputCostPer1M: 32,   outputCostPer1M: 64,   cachedCostPer1M: 0.40 },
    { provider: 'openai',    model: 'gpt-realtime-mini',        inputCostPer1M: 10,   outputCostPer1M: 20,   cachedCostPer1M: 0.30 },
    // Legacy aliases still accepted by the API — kept so existing
    // workspaces with the old ids in their agent config keep billing
    // correctly instead of hitting the fallback estimator.
    { provider: 'openai',    model: 'gpt-5',                        inputCostPer1M: 2.5,  outputCostPer1M: 10,   cachedCostPer1M: 0.25 },
    { provider: 'openai',    model: 'gpt-5-mini',                   inputCostPer1M: 0.25, outputCostPer1M: 2,    cachedCostPer1M: 0.025 },
    { provider: 'openai',    model: 'gpt-4o',                       inputCostPer1M: 2.5,  outputCostPer1M: 10,   cachedCostPer1M: 0.25 },
    { provider: 'openai',    model: 'gpt-4o-mini',                  inputCostPer1M: 0.15, outputCostPer1M: 0.6,  cachedCostPer1M: 0.015 },
    { provider: 'openai',    model: 'gpt-4o-realtime-preview-2024-12-17', inputCostPer1M: 40, outputCostPer1M: 80, cachedCostPer1M: 2.5 },

    // ─── Google (Gemini) ─────────────────────────────────────────────
    // Gemini 3.x (newest)
    { provider: 'google',    model: 'gemini-3.5-flash',             inputCostPer1M: 1.50, outputCostPer1M: 9,    cachedCostPer1M: 0.15 },
    { provider: 'google',    model: 'gemini-3.1-pro-preview',       inputCostPer1M: 2,    outputCostPer1M: 12,   cachedCostPer1M: 0.20 },
    { provider: 'google',    model: 'gemini-3.1-flash-lite',        inputCostPer1M: 0.25, outputCostPer1M: 1.50, cachedCostPer1M: 0.025 },
    // Gemini 2.5 (stable)
    { provider: 'google',    model: 'gemini-2.5-pro',               inputCostPer1M: 1.25, outputCostPer1M: 10,   cachedCostPer1M: 0.125 },
    { provider: 'google',    model: 'gemini-2.5-flash',             inputCostPer1M: 0.30, outputCostPer1M: 2.5,  cachedCostPer1M: 0.03 },
    { provider: 'google',    model: 'gemini-2.5-flash-lite',        inputCostPer1M: 0.10, outputCostPer1M: 0.40, cachedCostPer1M: 0.01 },
];

// Z.ai (GLM) — priced separately because AiPricing.provider is a
// String not an enum; kept in its own list so a future stricter enum
// migration doesn't need per-provider branching in one place.
const DEFAULT_ROWS_GLM: { provider: string; model: string; inputCostPer1M: number; outputCostPer1M: number; cachedCostPer1M: number }[] = [
    // GLM 5.x (flagship)
    { provider: 'zai', model: 'glm-5.2',            inputCostPer1M: 1.4,  outputCostPer1M: 4.4, cachedCostPer1M: 0.26 },
    { provider: 'zai', model: 'glm-5.1',            inputCostPer1M: 1.4,  outputCostPer1M: 4.4, cachedCostPer1M: 0.26 },
    { provider: 'zai', model: 'glm-5',              inputCostPer1M: 1.0,  outputCostPer1M: 3.2, cachedCostPer1M: 0.20 },
    { provider: 'zai', model: 'glm-5-turbo',        inputCostPer1M: 1.2,  outputCostPer1M: 4.0, cachedCostPer1M: 0.24 },
    // GLM 4.x
    { provider: 'zai', model: 'glm-4.7',            inputCostPer1M: 0.6,  outputCostPer1M: 2.2, cachedCostPer1M: 0.11 },
    { provider: 'zai', model: 'glm-4.7-flashx',     inputCostPer1M: 0.07, outputCostPer1M: 0.4, cachedCostPer1M: 0.01 },
    { provider: 'zai', model: 'glm-4.6',            inputCostPer1M: 0.6,  outputCostPer1M: 2.2, cachedCostPer1M: 0.11 },
    { provider: 'zai', model: 'glm-4.5',            inputCostPer1M: 0.6,  outputCostPer1M: 2.2, cachedCostPer1M: 0.11 },
    { provider: 'zai', model: 'glm-4.5-x',          inputCostPer1M: 2.2,  outputCostPer1M: 8.9, cachedCostPer1M: 0.45 },
    { provider: 'zai', model: 'glm-4.5-air',        inputCostPer1M: 0.2,  outputCostPer1M: 1.1, cachedCostPer1M: 0.03 },
    { provider: 'zai', model: 'glm-4.5-airx',       inputCostPer1M: 1.1,  outputCostPer1M: 4.5, cachedCostPer1M: 0.22 },
    // Vision variants (v-suffix)
    { provider: 'zai', model: 'glm-5v-turbo',       inputCostPer1M: 1.2,  outputCostPer1M: 4.0, cachedCostPer1M: 0.24 },
    { provider: 'zai', model: 'glm-4.6v',           inputCostPer1M: 0.3,  outputCostPer1M: 0.9, cachedCostPer1M: 0.05 },
    { provider: 'zai', model: 'glm-4.6v-flashx',    inputCostPer1M: 0.04, outputCostPer1M: 0.4, cachedCostPer1M: 0.004 },
    { provider: 'zai', model: 'glm-4.5v',           inputCostPer1M: 0.6,  outputCostPer1M: 1.8, cachedCostPer1M: 0.11 },
];

// Free-tier models — no charge from the provider, but the row still
// exists so pricing lookups don't fall through to the estimator (which
// would over-charge). Cached column irrelevant when input is 0.
const DEFAULT_ROWS_FREE: { provider: string; model: string; inputCostPer1M: number; outputCostPer1M: number; cachedCostPer1M: number }[] = [
    { provider: 'zai', model: 'glm-4.7-flash',   inputCostPer1M: 0, outputCostPer1M: 0, cachedCostPer1M: 0 },
    { provider: 'zai', model: 'glm-4.5-flash',   inputCostPer1M: 0, outputCostPer1M: 0, cachedCostPer1M: 0 },
    { provider: 'zai', model: 'glm-4.6v-flash',  inputCostPer1M: 0, outputCostPer1M: 0, cachedCostPer1M: 0 },
];

const DEFAULT_MARGIN = 3.0;

type SeedRow = {
    provider: string; model: string;
    inputCostPer1M: number; outputCostPer1M: number; cachedCostPer1M?: number;
    kind?: 'token' | 'stt_minute' | 'tts_chars';
    unitCostUsd?: number;
};

// Text models are listed above; the voice pipeline contributes its own
// transcribers, speech models and TTS voices. Folding them in here is
// what makes "every model an operator can pick has a price row" true,
// and what makes adding one to the voice catalogue enough for it to
// appear under Admin -> AI Pricing without any further work.
function allRows(): SeedRow[] {
    const text: SeedRow[] = [...DEFAULT_ROWS, ...DEFAULT_ROWS_GLM, ...DEFAULT_ROWS_FREE];
    const voice: SeedRow[] = voiceCatalogPricingRows().map(r => ({
        provider: r.provider,
        model: r.model,
        inputCostPer1M: r.inputCostPer1M,
        outputCostPer1M: r.outputCostPer1M,
        cachedCostPer1M: 0,
        kind: r.kind,
        unitCostUsd: r.unitCostUsd,
    }));
    // Text definitions win on collision, so a model present in both
    // lists (the Realtime rows, say) keeps its curated token pricing.
    const seen = new Set(text.map(r => r.provider + ':' + r.model));
    return [...text, ...voice.filter(r => !seen.has(r.provider + ':' + r.model))];
}

/**
 * Idempotent boot seed — creates rows that don't exist yet, leaves
 * everything else alone so an admin's manual price adjustments always
 * survive a restart. Use `refreshAiPricing()` for the one-click
 * "sync all catalog rows to current provider prices" flow.
 */
export async function seedAiPricing() {
    const rows = allRows();
    let inserted = 0;
    for (const r of rows) {
        const existing = await prisma.aiPricing.findFirst({
            where: { provider: r.provider, model: r.model },
        });
        if (existing) continue;
        await prisma.aiPricing.create({
            data: {
                provider: r.provider,
                model: r.model,
                inputCostPer1M: r.inputCostPer1M,
                outputCostPer1M: r.outputCostPer1M,
                cachedCostPer1M: r.cachedCostPer1M ?? 0,
                marginMultiplier: DEFAULT_MARGIN,
                isActive: true,
            },
        });
        inserted++;
    }
    if (inserted > 0) logger.info(`[ai-pricing] seeded ${inserted} default model rows`);
}

/**
 * One-shot "resync every catalog row to current provider prices" —
 * exposed as an admin endpoint. Overwrites input/output/cached prices
 * for every row in DEFAULT_ROWS(_GLM|_FREE); leaves marginMultiplier
 * + isActive untouched (admin controls those independently); inserts
 * rows that don't exist yet. Returns a diff so the UI can toast
 * "3 refreshed, 2 added".
 */
export async function refreshAiPricing(): Promise<{ updated: number; inserted: number; unchanged: number }> {
    const rows = allRows();
    let updated = 0;
    let inserted = 0;
    let unchanged = 0;
    for (const r of rows) {
        const existing = await prisma.aiPricing.findFirst({
            where: { provider: r.provider, model: r.model },
        });
        if (!existing) {
            await prisma.aiPricing.create({
                data: {
                    provider: r.provider,
                    model: r.model,
                    inputCostPer1M: r.inputCostPer1M,
                    outputCostPer1M: r.outputCostPer1M,
                    cachedCostPer1M: r.cachedCostPer1M ?? 0,
                    kind: r.kind ?? 'token',
                    unitCostUsd: r.unitCostUsd ?? 0,
                    marginMultiplier: DEFAULT_MARGIN,
                    isActive: true,
                },
            });
            inserted++;
            continue;
        }
        const same =
            existing.inputCostPer1M === r.inputCostPer1M &&
            existing.outputCostPer1M === r.outputCostPer1M &&
            existing.cachedCostPer1M === (r.cachedCostPer1M ?? 0) &&
            existing.kind === (r.kind ?? 'token') &&
            existing.unitCostUsd === (r.unitCostUsd ?? 0);
        if (same) { unchanged++; continue; }
        await prisma.aiPricing.update({
            where: { id: existing.id },
            data: {
                inputCostPer1M: r.inputCostPer1M,
                outputCostPer1M: r.outputCostPer1M,
                cachedCostPer1M: r.cachedCostPer1M ?? 0,
                kind: r.kind ?? 'token',
                unitCostUsd: r.unitCostUsd ?? 0,
            },
        });
        updated++;
    }
    // Drop the in-memory pricing cache so live workers pick up the
    // new numbers on the very next LLM call without a restart.
    invalidatePriceCache();
    logger.info({ updated, inserted, unchanged }, '[ai-pricing] refreshed from catalog');
    return { updated, inserted, unchanged };
}

// Seeds AiPricing with the current 2026 provider price sheet the
// first time the server boots (or fills in only the models an admin
// has never inserted, without ever overwriting an admin-edited row).
//
// Update these numbers as providers change their sheets. Source of
// truth links:
//   Anthropic — https://www.anthropic.com/pricing
//   OpenAI    — https://openai.com/pricing
//   Google    — https://ai.google.dev/pricing

import { prisma } from './prisma';
import { logger } from '../utils/logger';

type Row = {
    provider: 'anthropic' | 'openai' | 'google';
    model: string;
    inputCostPer1M: number;
    outputCostPer1M: number;
    cachedCostPer1M?: number;
};

const DEFAULT_ROWS: Row[] = [
    // Anthropic — Claude family
    { provider: 'anthropic', model: 'claude-opus-4-8',              inputCostPer1M: 15,   outputCostPer1M: 75,  cachedCostPer1M: 1.5 },
    { provider: 'anthropic', model: 'claude-opus-4-7',              inputCostPer1M: 15,   outputCostPer1M: 75,  cachedCostPer1M: 1.5 },
    { provider: 'anthropic', model: 'claude-sonnet-5',              inputCostPer1M: 3,    outputCostPer1M: 15,  cachedCostPer1M: 0.3 },
    { provider: 'anthropic', model: 'claude-haiku-4-5-20251001',    inputCostPer1M: 1,    outputCostPer1M: 5,   cachedCostPer1M: 0.1 },
    { provider: 'anthropic', model: 'claude-3-5-sonnet-latest',     inputCostPer1M: 3,    outputCostPer1M: 15,  cachedCostPer1M: 0.3 },
    { provider: 'anthropic', model: 'claude-3-5-haiku-latest',      inputCostPer1M: 0.8,  outputCostPer1M: 4,   cachedCostPer1M: 0.08 },
    // OpenAI — GPT family
    { provider: 'openai',    model: 'gpt-5',                        inputCostPer1M: 2.5,  outputCostPer1M: 10,  cachedCostPer1M: 0.25 },
    { provider: 'openai',    model: 'gpt-5-mini',                   inputCostPer1M: 0.25, outputCostPer1M: 2,   cachedCostPer1M: 0.025 },
    { provider: 'openai',    model: 'gpt-4.1',                      inputCostPer1M: 2,    outputCostPer1M: 8,   cachedCostPer1M: 0.2 },
    { provider: 'openai',    model: 'gpt-4.1-mini',                 inputCostPer1M: 0.4,  outputCostPer1M: 1.6, cachedCostPer1M: 0.04 },
    { provider: 'openai',    model: 'gpt-4o',                       inputCostPer1M: 2.5,  outputCostPer1M: 10,  cachedCostPer1M: 0.25 },
    { provider: 'openai',    model: 'gpt-4o-mini',                  inputCostPer1M: 0.15, outputCostPer1M: 0.6, cachedCostPer1M: 0.015 },
    // Google — Gemini family
    { provider: 'google',    model: 'gemini-2.5-pro',               inputCostPer1M: 1.25, outputCostPer1M: 10,  cachedCostPer1M: 0.125 },
    { provider: 'google',    model: 'gemini-2.5-flash',             inputCostPer1M: 0.075, outputCostPer1M: 0.3, cachedCostPer1M: 0.0075 },
    { provider: 'google',    model: 'gemini-1.5-pro',               inputCostPer1M: 1.25, outputCostPer1M: 5,   cachedCostPer1M: 0.125 },
    { provider: 'google',    model: 'gemini-1.5-flash',             inputCostPer1M: 0.075, outputCostPer1M: 0.3, cachedCostPer1M: 0.0075 },
];

const DEFAULT_MARGIN = 3.0;

/**
 * Idempotent seed. For each row: create it if missing, LEAVE IT ALONE
 * if it exists — the admin's editable marginMultiplier / cost tweaks
 * must survive every boot.
 */
export async function seedAiPricing() {
    let inserted = 0;
    for (const r of DEFAULT_ROWS) {
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

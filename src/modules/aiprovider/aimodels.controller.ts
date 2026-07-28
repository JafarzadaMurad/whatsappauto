import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { getWorkspaceId } from '../../lib/workspace-context';
import { loadAllowedModels } from '../../lib/model-access';

// Catalogue of model ids the agent UIs offer per provider. Lives in
// SystemConfig under the "ai_models" key as a JSON-stringified
// { OPENAI: string[]; CLAUDE: string[]; GEMINI: string[]; GLM: string[] }.
// Admins manage the list; workspace members just read it when picking
// a model for their agent.

// Verified 2026-07 against each provider's model catalogue. Updated
// alongside src/lib/ai-pricing.seed.ts — if a model ships here, its
// pricing row lives there too so credit billing doesn't fall back to
// the estimator. New model? Add to BOTH files.
const DEFAULT_MODELS: Record<string, string[]> = {
    // OpenAI — new 5.6 / 5.5 / 5.4 lineup + Realtime + backwards-compat aliases.
    OPENAI: [
        'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
        'gpt-5.5', 'gpt-5.5-pro',
        'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4-pro',
        'gpt-5.3-codex', 'chat-latest',
        'gpt-realtime', 'gpt-realtime-mini',
        // Legacy IDs still accepted by the API — kept so existing agent
        // configs referencing older ids keep billing correctly.
        'gpt-5', 'gpt-5-mini', 'gpt-4o', 'gpt-4o-mini',
    ],
    // Claude — all four Opus 4.x snapshots share the same rate, Sonnet 5
    // + 4.6 + 4.5 dated snapshot, Haiku 4.5 dated snapshot.
    CLAUDE: [
        'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-opus-4-5',
        'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5-20250929',
        'claude-haiku-4-5-20251001',
    ],
    // Gemini — 3.x newest, 2.5 stable tier. Older 1.5/2.0 removed;
    // they still respond but Google no longer prices them separately
    // (both fall back to the 2.5-flash rate today).
    GEMINI: [
        'gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite',
        'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
    ],
    // Z.ai's GLM family — 5.x reasoning, 4.x chat, and v-suffix vision
    // variants that accept {type:'image'} content parts so visionEnabled
    // agents work transparently. `-flash` variants are free (limited-time).
    GLM: [
        'glm-5.2', 'glm-5.1', 'glm-5', 'glm-5-turbo',
        'glm-4.7', 'glm-4.7-flashx', 'glm-4.7-flash',
        'glm-4.6', 'glm-4.5', 'glm-4.5-x', 'glm-4.5-air', 'glm-4.5-airx', 'glm-4.5-flash',
        'glm-5v-turbo', 'glm-4.6v', 'glm-4.6v-flashx', 'glm-4.6v-flash', 'glm-4.5v',
    ],
};

async function readModels(): Promise<Record<string, string[]>> {
    const row = await prisma.systemConfig.findUnique({ where: { key: 'ai_models' } });
    if (!row?.value) return DEFAULT_MODELS;
    try {
        const parsed = JSON.parse(row.value);
        // Guarantee every provider key exists so the UI doesn't
        // need to defensively check for missing arrays.
        return {
            OPENAI: Array.isArray(parsed.OPENAI) ? parsed.OPENAI : DEFAULT_MODELS.OPENAI,
            CLAUDE: Array.isArray(parsed.CLAUDE) ? parsed.CLAUDE : DEFAULT_MODELS.CLAUDE,
            GEMINI: Array.isArray(parsed.GEMINI) ? parsed.GEMINI : DEFAULT_MODELS.GEMINI,
            GLM: Array.isArray(parsed.GLM) ? parsed.GLM : DEFAULT_MODELS.GLM,
        };
    } catch {
        return DEFAULT_MODELS;
    }
}

export class AiModelsController {
    // Public-ish (auth-gated by the router): any logged-in user can
    // read the list so the agent settings dropdown can populate. The
    // returned list is intersected with the workspace's plan-scoped
    // allowedModels — the admin ticks a subset per plan, everyone else
    // sees only what they can actually use. Empty allow-list on a plan
    // = pass-through (current default for grandfathered plans).
    async list(req: Request, res: Response) {
        try {
            const models = await readModels();
            const workspaceId = getWorkspaceId(req);
            if (workspaceId) {
                const allowed = await loadAllowedModels(workspaceId);
                if (allowed.length > 0) {
                    const filtered: Record<string, string[]> = { OPENAI: [], CLAUDE: [], GEMINI: [], GLM: [] };
                    for (const p of Object.keys(models) as Array<keyof typeof models>) {
                        filtered[p] = models[p].filter(m => allowed.includes(`${p}:${m}`));
                    }
                    return res.json({ success: true, models: filtered, planRestricted: true });
                }
            }
            return res.json({ success: true, models, planRestricted: false });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Admin-only — overwrites the catalogue. Mounted under the admin
    // routes so requireAdmin gates it.
    async set(req: Request, res: Response) {
        try {
            const schema = z.object({
                models: z.object({
                    OPENAI: z.array(z.string().min(1)).max(50),
                    CLAUDE: z.array(z.string().min(1)).max(50),
                    GEMINI: z.array(z.string().min(1)).max(50),
                    GLM: z.array(z.string().min(1)).max(50),
                }),
            });
            const { models } = schema.parse(req.body);
            // Dedupe + trim before save so the UI doesn't accumulate
            // whitespace duplicates.
            const cleaned: Record<string, string[]> = {};
            for (const [k, v] of Object.entries(models)) {
                const seen = new Set<string>();
                const out: string[] = [];
                for (const m of v) {
                    const t = m.trim();
                    if (!t || seen.has(t)) continue;
                    seen.add(t);
                    out.push(t);
                }
                cleaned[k] = out;
            }
            await prisma.systemConfig.upsert({
                where: { key: 'ai_models' },
                update: { value: JSON.stringify(cleaned) },
                create: { key: 'ai_models', value: JSON.stringify(cleaned) },
            });
            return res.json({ success: true, models: cleaned });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

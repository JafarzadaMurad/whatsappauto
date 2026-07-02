import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';

// Catalogue of model ids the agent UIs offer per provider. Lives in
// SystemConfig under the "ai_models" key as a JSON-stringified
// { OPENAI: string[]; CLAUDE: string[]; GEMINI: string[]; GLM: string[] }.
// Admins manage the list; workspace members just read it when picking
// a model for their agent.

const DEFAULT_MODELS: Record<string, string[]> = {
    OPENAI: ['gpt-5', 'gpt-5-mini', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    CLAUDE: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-sonnet-4-5-20250514'],
    GEMINI: ['gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    // Z.ai's GLM family — reasoning + vision. IDs match the model
    // slugs on the Z.ai chat completions endpoint. Vision variants
    // (glm-4v-plus / glm-4v-flash) accept the same {type:'image'}
    // content parts as OpenAI, so visionEnabled agents work
    // transparently.
    GLM: ['glm-5.2', 'glm-5.1', 'glm-5', 'glm-5-turbo', 'glm-4.7', 'glm-4.5-air', 'glm-4v-plus', 'glm-4v-flash'],
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
    // read the list so the agent settings dropdown can populate.
    async list(_req: Request, res: Response) {
        try {
            const models = await readModels();
            return res.json({ success: true, models });
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

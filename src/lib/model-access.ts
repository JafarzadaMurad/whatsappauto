// Plan-driven model access-control. Every AI surface (agent editor,
// copilot picker, campaign drafts, oversight) asks these helpers what
// the workspace's plan is allowed to run — the actual pricing already
// lives in AiPricing; the ALLOW-LIST here is separate and admin-owned.
//
// Storage shape on Plan.allowedModels: `["OPENAI:gpt-5", "CLAUDE:claude-sonnet-5"]`.
// Empty array is the SENTINEL meaning "no restriction — every model
// in the AI Models Catalogue is fair game." That preserves the pre-
// migration behaviour for plans an admin hasn't opened yet.

import { prisma } from './prisma';

export type ProviderKey = 'OPENAI' | 'CLAUDE' | 'GEMINI' | 'GLM';

/** Normalise the provider label to the catalogue's canonical form. */
export function normaliseProvider(p: string): ProviderKey {
    const u = String(p || '').toUpperCase();
    if (u === 'ANTHROPIC') return 'CLAUDE';
    if (u === 'GOOGLE') return 'GEMINI';
    if (u === 'OPENAI' || u === 'CLAUDE' || u === 'GEMINI' || u === 'GLM') return u as ProviderKey;
    return 'OPENAI'; // conservative fallback
}

/**
 * True when this workspace's plan allows the given provider+model.
 * `allowedModels=[]` (default) means unrestricted.
 */
export function isModelAllowed(allowedModels: string[] | null | undefined, provider: string, model: string): boolean {
    if (!allowedModels || allowedModels.length === 0) return true;
    const key = `${normaliseProvider(provider)}:${model}`;
    return allowedModels.includes(key);
}

/**
 * Load the workspace's plan-scoped allow-list. Returns [] when the
 * workspace has no plan or the plan lifts the restriction.
 */
export async function loadAllowedModels(workspaceId: string): Promise<string[]> {
    const ws = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { plan: { select: { allowedModels: true } } },
    });
    if (ws?.plan?.allowedModels && ws.plan.allowedModels.length > 0) return ws.plan.allowedModels;
    // Owner fallback — same trick loadPlanAccess uses so a workspace
    // whose planId hasn't been synced from Stripe still inherits the
    // owner user's plan restrictions.
    const owner = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { owner: { select: { plan: { select: { allowedModels: true } } } } },
    });
    return owner?.owner?.plan?.allowedModels || [];
}

/**
 * Read the AI Models Catalogue from SystemConfig. Same shape the
 * `/api/admin/ai-models` endpoint exposes: { OPENAI: [], CLAUDE: [],
 * GEMINI: [], GLM: [] }. Kept here (small duplication) so the copilot
 * config endpoint and the plans editor don't have to reach into the
 * aiprovider module.
 */
const DEFAULT_CATALOG: Record<ProviderKey, string[]> = {
    OPENAI: ['gpt-5', 'gpt-5-mini', 'gpt-4o', 'gpt-4o-mini'],
    CLAUDE: ['claude-opus-4-7', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
    GEMINI: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    GLM: ['glm-5.2', 'glm-4.5-air'],
};

export async function loadCatalog(): Promise<Record<ProviderKey, string[]>> {
    const row = await prisma.systemConfig.findUnique({ where: { key: 'ai_models' } });
    if (!row?.value) return DEFAULT_CATALOG;
    try {
        const parsed = JSON.parse(row.value);
        return {
            OPENAI: Array.isArray(parsed.OPENAI) ? parsed.OPENAI : DEFAULT_CATALOG.OPENAI,
            CLAUDE: Array.isArray(parsed.CLAUDE) ? parsed.CLAUDE : DEFAULT_CATALOG.CLAUDE,
            GEMINI: Array.isArray(parsed.GEMINI) ? parsed.GEMINI : DEFAULT_CATALOG.GEMINI,
            GLM: Array.isArray(parsed.GLM) ? parsed.GLM : DEFAULT_CATALOG.GLM,
        };
    } catch {
        return DEFAULT_CATALOG;
    }
}

/**
 * Flatten the catalogue into the same "PROVIDER:model" key shape the
 * plan editor stores. Used by the frontend to render the master list
 * the admin ticks from when picking a plan's allowed models.
 */
export async function loadCatalogKeys(): Promise<{ provider: ProviderKey; model: string; key: string }[]> {
    const cat = await loadCatalog();
    const out: { provider: ProviderKey; model: string; key: string }[] = [];
    for (const p of Object.keys(cat) as ProviderKey[]) {
        for (const m of cat[p]) out.push({ provider: p, model: m, key: `${p}:${m}` });
    }
    return out;
}

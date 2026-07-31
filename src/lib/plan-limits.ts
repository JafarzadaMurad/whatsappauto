import { prisma } from './prisma';

export type LimitedResource = 'agent' | 'whatsapp' | 'instagram' | 'automation';

const LIMIT_FIELD: Record<LimitedResource, string> = {
    agent: 'maxAgents',
    whatsapp: 'maxWhatsappAccounts',
    instagram: 'maxInstagramAccounts',
    automation: 'maxAutomations',
};

const LABEL: Record<LimitedResource, string> = {
    agent: 'AI agent',
    whatsapp: 'WhatsApp account',
    instagram: 'Instagram account',
    automation: 'automation',
};

// Resources live in a workspace, so the quota has to be counted there.
// Counting by userId meant every agent a person owned anywhere counted
// against every workspace they touched: someone with five agents of
// their own hit "limit reached" trying to create the second agent in a
// colleague's workspace — a limit that workspace was nowhere near.
async function countResource(workspaceId: string, resource: LimitedResource): Promise<number> {
    switch (resource) {
        case 'agent': return prisma.agent.count({ where: { workspaceId } });
        case 'whatsapp': return prisma.instance.count({ where: { workspaceId } });
        case 'instagram': return prisma.instagramAccount.count({ where: { workspaceId } });
        case 'automation': return prisma.automation.count({ where: { workspaceId } });
    }
}

export class PlanLimitError extends Error {
    code = 'PLAN_LIMIT_REACHED';
    constructor(public planName: string, public resource: LimitedResource, public limit: number) {
        super(`Plan limit reached: this workspace's "${planName}" plan allows ${limit} ${LABEL[resource]}(s). Upgrade the plan to add more.`);
    }
}

/**
 * Throws PlanLimitError when the workspace has reached its plan's limit
 * for `resource`.
 *
 * The plan read here is the *workspace's* — the same source the feature
 * gates and the credit meter use. It falls back to the owner's user plan
 * for workspaces whose planId hasn't been synced from Stripe yet, which
 * is what loadPlanAccess does too. No plan at all means no enforcement,
 * so grandfathered accounts keep working until an admin assigns one.
 */
export async function checkPlanLimit(workspaceId: string, resource: LimitedResource): Promise<void> {
    if (!workspaceId) return;

    const ws = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
            plan: true,
            owner: { select: { plan: true } },
        },
    });
    const plan = ws?.plan ?? ws?.owner?.plan;
    if (!plan) return;

    const limit = (plan as any)[LIMIT_FIELD[resource]] as number;
    if (limit < 0) return; // unlimited

    const current = await countResource(workspaceId, resource);
    if (current >= limit) throw new PlanLimitError(plan.name, resource, limit);
}

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

async function countResource(userId: string, resource: LimitedResource): Promise<number> {
    switch (resource) {
        case 'agent': return prisma.agent.count({ where: { userId } });
        case 'whatsapp': return prisma.instance.count({ where: { userId } });
        case 'instagram': return prisma.instagramAccount.count({ where: { userId } });
        case 'automation': return prisma.automation.count({ where: { userId } });
    }
}

// Throws PlanLimitError if the user is already at/over the plan's limit
// for `resource`. Users with no plan assigned bypass enforcement (intended
// for grandfathering existing accounts until admin assigns plans).
export class PlanLimitError extends Error {
    code = 'PLAN_LIMIT_REACHED';
    constructor(public planName: string, public resource: LimitedResource, public limit: number) {
        super(`Plan limit reached: your "${planName}" plan allows ${limit} ${LABEL[resource]}(s). Upgrade your plan to add more.`);
    }
}

export async function checkPlanLimit(userId: string, resource: LimitedResource): Promise<void> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { plan: true }
    });
    if (!user?.plan) return;
    const limit = (user.plan as any)[LIMIT_FIELD[resource]] as number;
    if (limit < 0) return; // unlimited
    const current = await countResource(userId, resource);
    if (current >= limit) throw new PlanLimitError(user.plan.name, resource, limit);
}

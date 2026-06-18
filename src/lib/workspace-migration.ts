import { prisma } from './prisma';
import { logger } from '../utils/logger';
import { seedRolesForWorkspace } from './role-migration';

// One-time migration: for every user that doesn't yet own a personal
// workspace, create one and backfill `workspaceId` on every scoped row
// they own. Runs on backend boot; idempotent.
export async function ensureWorkspacesForAllUsers() {
    const users = await prisma.user.findMany({
        where: { ownedWorkspaces: { none: {} } },
        select: { id: true, name: true, email: true, planId: true, subscriptionStatus: true, subscriptionEndsAt: true, stripeCustomerId: true, stripeSubscriptionId: true },
    });

    if (users.length === 0) return;
    logger.info(`[workspace-migration] backfilling ${users.length} user(s)…`);

    for (const u of users) {
        const wsName = u.name ? `${u.name}'s workspace` : `${u.email.split('@')[0]}'s workspace`;
        const ws = await prisma.workspace.create({
            data: {
                name: wsName,
                ownerId: u.id,
                planId: u.planId,
                subscriptionStatus: u.subscriptionStatus,
                subscriptionEndsAt: u.subscriptionEndsAt,
                stripeCustomerId: u.stripeCustomerId,
                stripeSubscriptionId: u.stripeSubscriptionId,
                members: { create: { userId: u.id, role: 'OWNER' } },
            },
        });

        const wsId = ws.id;
        await seedRolesForWorkspace(wsId).catch(() => {});
        const filter = { userId: u.id, workspaceId: null };

        // Backfill every scoped table. The where clause skips rows that
        // were already migrated, so subsequent boots are no-ops.
        await Promise.all([
            prisma.instance.updateMany({ where: filter, data: { workspaceId: wsId } }),
            prisma.apiKey.updateMany({ where: filter, data: { workspaceId: wsId } }),
            prisma.webhookConfig.updateMany({ where: filter, data: { workspaceId: wsId } }),
            prisma.aiProvider.updateMany({ where: filter, data: { workspaceId: wsId } }),
            prisma.agent.updateMany({ where: filter, data: { workspaceId: wsId } }),
            prisma.customTable.updateMany({ where: filter, data: { workspaceId: wsId } }),
            prisma.client.updateMany({ where: filter, data: { workspaceId: wsId } }),
            prisma.userField.updateMany({ where: filter, data: { workspaceId: wsId } }),
            prisma.campaign.updateMany({ where: filter, data: { workspaceId: wsId } }),
            prisma.instagramAccount.updateMany({ where: filter, data: { workspaceId: wsId } }),
            prisma.automation.updateMany({ where: filter, data: { workspaceId: wsId } }),
            prisma.automationExecution.updateMany({ where: filter, data: { workspaceId: wsId } }),
            prisma.mcpClient.updateMany({ where: { userId: u.id, workspaceId: null }, data: { workspaceId: wsId } }),
            prisma.mcpOAuthToken.updateMany({ where: filter, data: { workspaceId: wsId } }),
            prisma.mcpAuthCode.updateMany({ where: filter, data: { workspaceId: wsId } }),
            prisma.mcpPermission.updateMany({ where: filter, data: { workspaceId: wsId } }),
            prisma.mcpAuditLog.updateMany({ where: filter, data: { workspaceId: wsId } }),
        ]);

        logger.info(`[workspace-migration] backfilled user ${u.email} → workspace ${wsId}`);
    }
}

// Returns the user's personal workspace id, creating one on demand.
export async function getOrCreatePersonalWorkspace(userId: string): Promise<string> {
    const owned = await prisma.workspace.findFirst({
        where: { ownerId: userId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
    });
    if (owned) return owned.id;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    const ws = await prisma.workspace.create({
        data: {
            name: user?.name ? `${user.name}'s workspace` : `${user?.email?.split('@')[0] || 'New'}'s workspace`,
            ownerId: userId,
            members: { create: { userId, role: 'OWNER' } },
        },
        select: { id: true },
    });
    await seedRolesForWorkspace(ws.id).catch(() => {});
    return ws.id;
}

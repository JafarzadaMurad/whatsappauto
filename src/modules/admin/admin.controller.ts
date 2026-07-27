import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { seedRolesForWorkspace } from '../../lib/role-migration';

const updateUserSchema = z.object({
    role: z.enum(['USER', 'ADMIN']).optional(),
    planId: z.string().nullable().optional(),
    subscriptionStatus: z.enum(['none', 'trialing', 'active', 'past_due', 'canceled']).optional(),
    subscriptionEndsAt: z.string().datetime().nullable().optional(),
    hiddenSections: z.array(z.string().max(60)).optional(),
    lockedSections: z.array(z.string().max(60)).optional(),
    unlimitedInstances: z.boolean().optional(),
});

// Resolve the workspace's "Member" role id — used when the admin
// adds someone without specifying a role (default membership) and
// when transferring ownership downgrades the outgoing owner.
async function defaultMemberRoleId(tx: any, workspaceId: string): Promise<string> {
    const r = await tx.workspaceRole.findFirst({
        where: { workspaceId, name: 'Member' },
        select: { id: true },
    });
    if (r) return r.id;
    return seedRolesForWorkspace(workspaceId);
}

const SAFE_USER_SELECT = {
    id: true, email: true, name: true, role: true,
    emailVerified: true,
    planId: true, subscriptionStatus: true, subscriptionEndsAt: true,
    stripeCustomerId: true,
    hiddenSections: true, lockedSections: true,
    unlimitedInstances: true,
    createdAt: true, updatedAt: true,
    plan: { select: { id: true, name: true, price: true, currency: true, interval: true, monthlyCredits: true, copilotEnabled: true, copilotVoiceEnabled: true } }
} as const;

// Compact usable-in-list view of every workspace the user owns —
// includes the live credit-pool numbers so the admin's user card can
// show "X / Y credits used" without a second round-trip per row.
const OWNED_WS_SELECT = {
    id: true, name: true,
    creditsUsedThisPeriod: true, creditTopUp: true, periodResetAt: true,
    subscriptionStatus: true,
    plan: { select: { id: true, name: true, monthlyCredits: true } },
} as const;

export class AdminController {
    async listUsers(_req: Request, res: Response) {
        try {
            const users = await prisma.user.findMany({
                select: {
                    ...SAFE_USER_SELECT,
                    ownedWorkspaces: {
                        select: OWNED_WS_SELECT,
                        orderBy: { createdAt: 'asc' },
                    },
                    _count: {
                        select: {
                            ownedWorkspaces: true,
                            instances: true,
                            agents: true,
                        },
                    },
                } as any,
                orderBy: { createdAt: 'desc' }
            });
            return res.json({ success: true, users });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Detailed single-user view used by the admin drawer — same shape
    // as listUsers rows but with the last 20 credit ledger entries
    // included so support can see exactly what burned through the pool.
    async getUser(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const user = await prisma.user.findUnique({
                where: { id },
                select: {
                    ...SAFE_USER_SELECT,
                    ownedWorkspaces: {
                        select: OWNED_WS_SELECT,
                        orderBy: { createdAt: 'asc' },
                    },
                } as any,
            });
            if (!user) return res.status(404).json({ success: false, message: 'User not found' });

            // Recent LLM activity across every workspace the user owns.
            const wsIds = ((user as any).ownedWorkspaces as any[]).map(w => w.id);
            const recentLedger = wsIds.length > 0 ? await prisma.creditLedger.findMany({
                where: { workspaceId: { in: wsIds } },
                orderBy: { createdAt: 'desc' },
                take: 20,
                select: {
                    id: true, workspaceId: true, cause: true, provider: true, model: true,
                    inputTokens: true, outputTokens: true, creditsUsed: true,
                    usedOwnKey: true, createdAt: true,
                    agent: { select: { id: true, name: true } },
                },
            }) : [];

            return res.json({ success: true, user, recentLedger });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Admin-flip email verification without a mail round-trip. Used
    // when a customer can't receive the verify email (typo, spam bin
    // that never clears) — flips User.emailVerified=true and wipes any
    // pending token so nothing collides later.
    async verifyEmail(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const user = await prisma.user.update({
                where: { id },
                data: {
                    emailVerified: true,
                    emailVerifyToken: null,
                    emailVerifyExpires: null,
                },
                select: SAFE_USER_SELECT,
            });
            return res.json({ success: true, user });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Full account delete. Cascades through Prisma's onDelete: Cascade
    // to every scoped row (workspaces, instances, agents, sessions…),
    // so this is a hard, irreversible wipe. UI must confirm.
    async deleteUser(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const caller = (req as any).user?.id;
            if (caller === id) return res.status(400).json({ success: false, message: 'You cannot delete your own admin account here.' });
            await prisma.user.delete({ where: { id } });
            return res.json({ success: true });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateUser(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const data = updateUserSchema.parse(req.body);
            const existing = await prisma.user.findUnique({ where: { id } });
            if (!existing) return res.status(404).json({ success: false, message: 'User not found' });

            const updateData: any = {};
            if (data.role !== undefined) updateData.role = data.role;
            if (data.planId !== undefined) updateData.planId = data.planId;
            if (data.subscriptionStatus !== undefined) updateData.subscriptionStatus = data.subscriptionStatus;
            if (data.subscriptionEndsAt !== undefined) updateData.subscriptionEndsAt = data.subscriptionEndsAt ? new Date(data.subscriptionEndsAt) : null;
            if (data.hiddenSections !== undefined) updateData.hiddenSections = data.hiddenSections;
            if (data.lockedSections !== undefined) updateData.lockedSections = data.lockedSections;
            if (data.unlimitedInstances !== undefined) updateData.unlimitedInstances = data.unlimitedInstances;

            const user = await prisma.user.update({
                where: { id },
                data: updateData,
                select: SAFE_USER_SELECT
            });
            // Propagate the plan (and its subscription bits) to every
            // workspace this user owns. Feature gates in the app
            // (copilot, cai budget, custom-key allowance) are keyed
            // off Workspace.planId, so leaving that stale means the
            // admin-toggled perks silently don't apply.
            const wsData: any = {};
            if (data.planId !== undefined) wsData.planId = data.planId;
            if (data.subscriptionStatus !== undefined) wsData.subscriptionStatus = data.subscriptionStatus;
            if (data.subscriptionEndsAt !== undefined) wsData.subscriptionEndsAt = data.subscriptionEndsAt ? new Date(data.subscriptionEndsAt) : null;
            if (Object.keys(wsData).length > 0) {
                await prisma.workspace.updateMany({
                    where: { ownerId: id },
                    data: wsData,
                });
            }
            return res.json({ success: true, user });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── User creation ─────────────────────────────────────────────
    // Admin creates a new user directly (bypasses email verification
    // by default). Optionally seeds a default workspace so support
    // doesn't have to bounce between two screens.
    async createUser(req: Request, res: Response) {
        try {
            const schema = z.object({
                email: z.string().email(),
                name: z.string().max(120).optional(),
                password: z.string().min(6).max(200),
                role: z.enum(['USER', 'ADMIN']).default('USER'),
                planId: z.string().nullable().optional(),
                emailVerified: z.boolean().default(true),
                createDefaultWorkspace: z.boolean().default(true),
                workspaceName: z.string().max(60).optional(),
            });
            const data = schema.parse(req.body);

            const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
            if (existing) return res.status(400).json({ success: false, message: 'A user with this email already exists.' });

            const hashed = await bcrypt.hash(data.password, 10);
            const user = await prisma.user.create({
                data: {
                    email: data.email.toLowerCase(),
                    name: data.name || null,
                    password: hashed,
                    role: data.role,
                    planId: data.planId ?? null,
                    emailVerified: data.emailVerified,
                    subscriptionStatus: 'none',
                },
                select: SAFE_USER_SELECT,
            });

            if (data.createDefaultWorkspace) {
                const ws = await prisma.workspace.create({
                    data: {
                        name: data.workspaceName || `${(data.name || data.email.split('@')[0])}'s Workspace`,
                        ownerId: user.id,
                        planId: data.planId ?? null,
                        members: { create: { userId: user.id, role: 'OWNER' } },
                    },
                });
                await seedRolesForWorkspace(ws.id).catch(() => {});
            }

            return res.status(201).json({ success: true, user });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── Workspaces (admin-scoped, cross-user) ─────────────────────

    // Every workspace across the system, with owner + member counts +
    // credit meter. Cheap to render on the admin-workspaces list.
    async listWorkspaces(_req: Request, res: Response) {
        try {
            const workspaces = await prisma.workspace.findMany({
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true, name: true, ownerId: true, createdAt: true,
                    creditsUsedThisPeriod: true, creditTopUp: true, periodResetAt: true,
                    subscriptionStatus: true,
                    plan: { select: { id: true, name: true, monthlyCredits: true } },
                    owner: { select: { id: true, email: true, name: true } },
                    _count: { select: { members: true, instances: true, agents: true } },
                },
            });
            return res.json({ success: true, workspaces });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Deep view of a single workspace — owner, every member with their
    // role, and pending invitations. Used by both the admin workspace
    // drawer and the user-detail Workspaces tab.
    async getWorkspace(req: Request, res: Response) {
        try {
            const wsId = req.params.id as string;
            const ws = await prisma.workspace.findUnique({
                where: { id: wsId },
                select: {
                    id: true, name: true, ownerId: true, createdAt: true,
                    creditsUsedThisPeriod: true, creditTopUp: true, periodResetAt: true,
                    subscriptionStatus: true, subscriptionEndsAt: true,
                    plan: { select: { id: true, name: true, monthlyCredits: true } },
                    owner: { select: { id: true, email: true, name: true } },
                    members: {
                        orderBy: { createdAt: 'asc' },
                        select: {
                            id: true, role: true, roleId: true, createdAt: true,
                            user: { select: { id: true, email: true, name: true } },
                            customRole: { select: { id: true, name: true } },
                        },
                    },
                    invitations: {
                        where: { acceptedAt: null },
                        orderBy: { createdAt: 'desc' },
                        select: { id: true, email: true, role: true, roleId: true, token: true, expiresAt: true, createdAt: true },
                    },
                    roles: {
                        orderBy: { name: 'asc' },
                        select: { id: true, name: true, isSystem: true },
                    },
                    _count: { select: { instances: true, agents: true, campaigns: true } },
                },
            });
            if (!ws) return res.status(404).json({ success: false, message: 'Workspace not found' });
            return res.json({ success: true, workspace: ws });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Create a workspace owned by a specific user. Same shape as the
    // user-facing POST /workspaces but the actor doesn't have to be
    // the target user.
    async createWorkspaceForUser(req: Request, res: Response) {
        try {
            const userId = req.params.id as string;
            const schema = z.object({
                name: z.string().min(1).max(60),
                planId: z.string().nullable().optional(),
            });
            const data = schema.parse(req.body);

            const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, planId: true } });
            if (!user) return res.status(404).json({ success: false, message: 'User not found' });

            const ws = await prisma.workspace.create({
                data: {
                    name: data.name,
                    ownerId: userId,
                    planId: data.planId ?? user.planId ?? null,
                    members: { create: { userId, role: 'OWNER' } },
                },
                include: { plan: { select: { id: true, name: true, monthlyCredits: true } } },
            });
            await seedRolesForWorkspace(ws.id).catch(() => {});
            return res.status(201).json({ success: true, workspace: ws });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateWorkspace(req: Request, res: Response) {
        try {
            const wsId = req.params.id as string;
            const schema = z.object({
                name: z.string().min(1).max(60).optional(),
                planId: z.string().nullable().optional(),
                subscriptionStatus: z.enum(['none', 'trialing', 'active', 'past_due', 'canceled']).optional(),
                subscriptionEndsAt: z.string().datetime().nullable().optional(),
            });
            const data = schema.parse(req.body);
            const patch: any = {};
            if (data.name !== undefined) patch.name = data.name;
            if (data.planId !== undefined) patch.planId = data.planId;
            if (data.subscriptionStatus !== undefined) patch.subscriptionStatus = data.subscriptionStatus;
            if (data.subscriptionEndsAt !== undefined) {
                patch.subscriptionEndsAt = data.subscriptionEndsAt ? new Date(data.subscriptionEndsAt) : null;
            }
            const ws = await prisma.workspace.update({ where: { id: wsId }, data: patch });
            return res.json({ success: true, workspace: ws });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async deleteWorkspace(req: Request, res: Response) {
        try {
            const wsId = req.params.id as string;
            await prisma.workspace.delete({ where: { id: wsId } });
            return res.json({ success: true });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Transfer ownership to another user. The new owner becomes an
    // OWNER member automatically; the old owner is downgraded to a
    // regular Member (unless the admin passes removeOldOwner: true).
    async transferWorkspace(req: Request, res: Response) {
        try {
            const wsId = req.params.id as string;
            const schema = z.object({
                newOwnerId: z.string().uuid(),
                removeOldOwner: z.boolean().default(false),
            });
            const { newOwnerId, removeOldOwner } = schema.parse(req.body);

            const ws = await prisma.workspace.findUnique({
                where: { id: wsId },
                select: { id: true, ownerId: true },
            });
            if (!ws) return res.status(404).json({ success: false, message: 'Workspace not found' });
            const newOwner = await prisma.user.findUnique({ where: { id: newOwnerId }, select: { id: true } });
            if (!newOwner) return res.status(404).json({ success: false, message: 'New owner user not found' });

            await prisma.$transaction(async (tx) => {
                // Downgrade old owner's OWNER membership → MEMBER (kept
                // as member unless the admin asked us to boot them).
                if (removeOldOwner) {
                    await tx.workspaceMember.deleteMany({
                        where: { workspaceId: wsId, userId: ws.ownerId },
                    });
                } else {
                    const memberRoleId = await defaultMemberRoleId(tx, wsId);
                    await tx.workspaceMember.updateMany({
                        where: { workspaceId: wsId, userId: ws.ownerId },
                        data: { role: 'MEMBER', roleId: memberRoleId },
                    });
                }
                // Ensure the new owner is a member; upgrade role to OWNER.
                await tx.workspaceMember.upsert({
                    where: { workspaceId_userId: { workspaceId: wsId, userId: newOwnerId } },
                    update: { role: 'OWNER', roleId: null },
                    create: { workspaceId: wsId, userId: newOwnerId, role: 'OWNER' },
                });
                await tx.workspace.update({
                    where: { id: wsId },
                    data: { ownerId: newOwnerId },
                });
            });

            return res.json({ success: true });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Add an existing user as a member of a workspace (no invitation
    // round-trip). Admin-only shortcut for support / provisioning.
    async addWorkspaceMember(req: Request, res: Response) {
        try {
            const wsId = req.params.id as string;
            const schema = z.object({
                userId: z.string().uuid().optional(),
                email: z.string().email().optional(),
                roleId: z.string().uuid().nullable().optional(),
            }).refine(v => !!v.userId || !!v.email, { message: 'Pass userId or email' });
            const data = schema.parse(req.body);

            let userId = data.userId;
            if (!userId && data.email) {
                const u = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() }, select: { id: true } });
                if (!u) return res.status(404).json({ success: false, message: 'No user with that email' });
                userId = u.id;
            }
            const roleId = data.roleId || await defaultMemberRoleId(prisma, wsId);
            const member = await prisma.workspaceMember.upsert({
                where: { workspaceId_userId: { workspaceId: wsId, userId: userId! } },
                update: { roleId, role: 'MEMBER' },
                create: { workspaceId: wsId, userId: userId!, roleId, role: 'MEMBER' },
                include: {
                    user: { select: { id: true, email: true, name: true } },
                    customRole: { select: { id: true, name: true } },
                },
            });
            return res.status(201).json({ success: true, member });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateWorkspaceMember(req: Request, res: Response) {
        try {
            const wsId = req.params.id as string;
            const memberId = req.params.memberId as string;
            const schema = z.object({ roleId: z.string().uuid() });
            const { roleId } = schema.parse(req.body);
            const member = await prisma.workspaceMember.update({
                where: { id: memberId },
                data: { roleId, role: 'MEMBER' },
            });
            if (member.workspaceId !== wsId) return res.status(400).json({ success: false, message: 'Member does not belong to this workspace' });
            return res.json({ success: true, member });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async removeWorkspaceMember(req: Request, res: Response) {
        try {
            const wsId = req.params.id as string;
            const memberId = req.params.memberId as string;
            const member = await prisma.workspaceMember.findUnique({ where: { id: memberId } });
            if (!member || member.workspaceId !== wsId) return res.status(404).json({ success: false, message: 'Member not found' });
            // Can't remove the OWNER via this endpoint — force a transfer first.
            const ws = await prisma.workspace.findUnique({ where: { id: wsId }, select: { ownerId: true } });
            if (ws?.ownerId === member.userId) {
                return res.status(400).json({ success: false, message: 'Cannot remove the owner. Transfer ownership first.' });
            }
            await prisma.workspaceMember.delete({ where: { id: memberId } });
            return res.json({ success: true });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // System config — used for Stripe keys and other app-wide settings
    async getConfig(_req: Request, res: Response) {
        try {
            const rows = await prisma.systemConfig.findMany();
            const cfg: Record<string, { value: string; updatedAt: Date }> = {};
            for (const r of rows) cfg[r.key] = { value: r.value, updatedAt: r.updatedAt };
            return res.json({ success: true, config: cfg });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async setConfig(req: Request, res: Response) {
        try {
            const schema = z.object({ entries: z.record(z.string(), z.string()) });
            const { entries } = schema.parse(req.body);
            const ops = Object.entries(entries).map(([key, value]) =>
                prisma.systemConfig.upsert({
                    where: { key },
                    update: { value },
                    create: { key, value }
                })
            );
            await Promise.all(ops);
            return res.json({ success: true, updated: Object.keys(entries).length });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

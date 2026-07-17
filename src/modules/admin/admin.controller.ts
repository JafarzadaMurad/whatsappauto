import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';

const updateUserSchema = z.object({
    role: z.enum(['USER', 'ADMIN']).optional(),
    planId: z.string().nullable().optional(),
    subscriptionStatus: z.enum(['none', 'trialing', 'active', 'past_due', 'canceled']).optional(),
    subscriptionEndsAt: z.string().datetime().nullable().optional(),
    hiddenSections: z.array(z.string().max(60)).optional(),
    lockedSections: z.array(z.string().max(60)).optional(),
    unlimitedInstances: z.boolean().optional(),
});

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

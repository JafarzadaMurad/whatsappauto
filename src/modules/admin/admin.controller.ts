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
    planId: true, subscriptionStatus: true, subscriptionEndsAt: true,
    stripeCustomerId: true,
    hiddenSections: true, lockedSections: true,
    unlimitedInstances: true,
    createdAt: true, updatedAt: true,
    plan: { select: { id: true, name: true, price: true, currency: true, interval: true } }
} as const;

export class AdminController {
    async listUsers(_req: Request, res: Response) {
        try {
            const users = await prisma.user.findMany({
                select: SAFE_USER_SELECT,
                orderBy: { createdAt: 'desc' }
            });
            return res.json({ success: true, users });
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

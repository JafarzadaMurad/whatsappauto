import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';

const planSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    price: z.number().min(0),
    currency: z.string().default('USD'),
    interval: z.enum(['month', 'year']).default('month'),
    maxAgents: z.number().int().default(1),
    maxWhatsappAccounts: z.number().int().default(1),
    maxInstagramAccounts: z.number().int().default(1),
    maxAutomations: z.number().int().default(1),
    monthlyMessageLimit: z.number().int().default(1000),
    isActive: z.boolean().optional(),
    stripePriceId: z.string().optional()
});

export class PlanController {
    // Authenticated — current user's plan + usage counts
    async getCurrent(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    planId: true, subscriptionStatus: true, subscriptionEndsAt: true,
                    plan: true
                }
            });
            if (!user) return res.status(404).json({ success: false, message: 'User not found' });
            const [agents, whatsapp, instagram, automations] = await Promise.all([
                prisma.agent.count({ where: { userId } }),
                prisma.instance.count({ where: { userId } }),
                prisma.instagramAccount.count({ where: { userId } }),
                prisma.automation.count({ where: { userId } })
            ]);
            return res.json({
                success: true,
                plan: user.plan,
                subscription: {
                    status: user.subscriptionStatus,
                    endsAt: user.subscriptionEndsAt
                },
                usage: { agents, whatsapp, instagram, automations }
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Public — list active plans (for the pricing/billing page)
    async listPublic(_req: Request, res: Response) {
        try {
            const plans = await prisma.plan.findMany({
                where: { isActive: true },
                orderBy: { price: 'asc' }
            });
            return res.json({ success: true, plans });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Admin — list all plans
    async list(_req: Request, res: Response) {
        try {
            const plans = await prisma.plan.findMany({
                orderBy: { price: 'asc' },
                include: { _count: { select: { users: true } } }
            });
            return res.json({ success: true, plans });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async create(req: Request, res: Response) {
        try {
            const data = planSchema.parse(req.body);
            const plan = await prisma.plan.create({ data });
            return res.status(201).json({ success: true, plan });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async update(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const data = planSchema.parse(req.body);
            const existing = await prisma.plan.findUnique({ where: { id } });
            if (!existing) return res.status(404).json({ success: false, message: 'Plan not found' });
            const plan = await prisma.plan.update({ where: { id }, data });
            return res.json({ success: true, plan });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async remove(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const existing = await prisma.plan.findUnique({
                where: { id },
                include: { _count: { select: { users: true } } }
            });
            if (!existing) return res.status(404).json({ success: false, message: 'Plan not found' });
            if (existing._count.users > 0) {
                return res.status(400).json({ success: false, message: `Cannot delete — ${existing._count.users} user(s) are on this plan` });
            }
            await prisma.plan.delete({ where: { id } });
            return res.json({ success: true, message: 'Plan deleted' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

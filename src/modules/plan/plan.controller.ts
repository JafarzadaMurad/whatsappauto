import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { getWorkspaceId } from '../../lib/workspace-context';
import { loadCatalog } from '../../lib/model-access';

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
    // cai credit system
    monthlyCredits: z.number().int().nonnegative().default(0),
    allowCustomApiKeys: z.boolean().default(false),
    overageBehavior: z.enum(['hard_block', 'top_up']).default('hard_block'),
    // in-app copilot
    copilotEnabled: z.boolean().default(false),
    copilotVoiceEnabled: z.boolean().default(false),
    copilotVoiceMultiplier: z.number().positive().default(5.0),
    // AI model access — array of "PROVIDER:model" strings the plan
    // is allowed to use across every AI surface (agents, copilot,
    // campaigns, oversight). Empty = no restriction.
    allowedModels: z.array(z.string().max(200)).max(200).default([]),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    trialDays: z.number().int().min(0).nullable().optional(),
    stripePriceId: z.string().optional()
});

export class PlanController {
    // Authenticated — current workspace's plan + usage counts
    async getCurrent(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const workspace = await prisma.workspace.findUnique({
                where: { id: workspaceId },
                select: {
                    planId: true, subscriptionStatus: true, subscriptionEndsAt: true,
                    plan: true
                }
            });
            if (!workspace) return res.status(404).json({ success: false, message: 'Workspace not found' });
            const [agents, whatsapp, instagram, automations] = await Promise.all([
                prisma.agent.count({ where: { workspaceId } }),
                prisma.instance.count({ where: { workspaceId } }),
                prisma.instagramAccount.count({ where: { workspaceId } }),
                prisma.automation.count({ where: { workspaceId } })
            ]);
            return res.json({
                success: true,
                plan: workspace.plan,
                subscription: {
                    status: workspace.subscriptionStatus,
                    endsAt: workspace.subscriptionEndsAt
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

    // Full AI Models Catalogue as flat keys so the plan editor can
    // render a grouped checkbox list without duplicating provider
    // labels client-side.
    async modelCatalog(_req: Request, res: Response) {
        try {
            const cat = await loadCatalog();
            const flat: { provider: string; model: string; key: string }[] = [];
            for (const p of Object.keys(cat) as Array<keyof typeof cat>) {
                for (const m of cat[p]) flat.push({ provider: p, model: m, key: `${p}:${m}` });
            }
            return res.json({ success: true, catalog: cat, flat });
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
            if (data.isDefault && data.price > 0) {
                return res.status(400).json({ success: false, message: 'Default plan must have price 0 (it is given to new sign-ups).' });
            }
            if (data.isDefault) {
                await prisma.plan.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
            }
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
            if (data.isDefault && data.price > 0) {
                return res.status(400).json({ success: false, message: 'Default plan must have price 0 (it is given to new sign-ups).' });
            }
            if (data.isDefault) {
                await prisma.plan.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } });
            }
            const plan = await prisma.plan.update({ where: { id }, data });
            return res.json({ success: true, plan });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Toggle isDefault on a plan directly (used by the star icon on plan cards)
    async setDefault(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const plan = await prisma.plan.findUnique({ where: { id } });
            if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
            if (plan.price > 0) {
                return res.status(400).json({ success: false, message: `"${plan.name}" costs ${plan.price} ${plan.currency} — only free plans (price 0) can be set as default.` });
            }
            await prisma.plan.updateMany({ where: { isDefault: true, NOT: { id } }, data: { isDefault: false } });
            const updated = await prisma.plan.update({ where: { id }, data: { isDefault: true } });
            return res.json({ success: true, plan: updated });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async clearDefault(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const plan = await prisma.plan.findUnique({ where: { id } });
            if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });
            const updated = await prisma.plan.update({ where: { id }, data: { isDefault: false } });
            return res.json({ success: true, plan: updated });
        } catch (error: any) {
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

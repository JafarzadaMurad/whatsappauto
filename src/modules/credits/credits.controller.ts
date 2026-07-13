// cai credit system — endpoints consumed by the User dashboard and
// by admin management screens.
//
//   GET  /api/credits/balance             — current pool + reset date (user)
//   GET  /api/credits/history?days=30     — recent ledger rows for the widget
//
//   Admin under /api/admin/ai-pricing:
//     GET    /                            — list every model rate
//     PUT    /:id                         — edit one row
//     POST   /                            — add a new model row
//     DELETE /:id                         — remove a row
//
//   Admin under /api/admin/credits:
//     POST /workspaces/:workspaceId/top-up  { amount } — grant cai
//     POST /workspaces/:workspaceId/reset               — force-reset the pool

import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { getWorkspaceId } from '../../lib/workspace-context';
import { getCreditBalance } from '../../lib/credit-guard';
import { invalidatePriceCache } from '../../lib/ai-pricing';

export class CreditsController {
    async getBalance(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace context' });
            const balance = await getCreditBalance(workspaceId);
            if (!balance) return res.status(404).json({ success: false, message: 'Workspace not found' });
            return res.json({ success: true, balance });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getHistory(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            if (!workspaceId) return res.status(400).json({ success: false, message: 'No workspace context' });
            const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
            const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
            const rows = await prisma.creditLedger.findMany({
                where: { workspaceId, createdAt: { gte: since } },
                orderBy: { createdAt: 'desc' },
                take: 500,
                select: {
                    id: true, provider: true, model: true, cause: true,
                    inputTokens: true, outputTokens: true, cachedTokens: true,
                    realCostUsd: true, creditsUsed: true, usedOwnKey: true,
                    createdAt: true,
                    user: { select: { id: true, name: true, email: true } },
                },
            });
            return res.json({ success: true, history: rows, sinceIso: since.toISOString() });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

// ─── Admin AI Pricing ──────────────────────────────────────────────
const pricingRowSchema = z.object({
    provider: z.enum(['anthropic', 'openai', 'google']),
    model: z.string().min(1),
    inputCostPer1M: z.number().nonnegative(),
    outputCostPer1M: z.number().nonnegative(),
    cachedCostPer1M: z.number().nonnegative().default(0),
    marginMultiplier: z.number().positive().default(3.0),
    isActive: z.boolean().default(true),
});
const pricingPatchSchema = pricingRowSchema.partial();

export class AiPricingController {
    async list(_req: Request, res: Response) {
        try {
            const rows = await prisma.aiPricing.findMany({
                orderBy: [{ provider: 'asc' }, { model: 'asc' }],
            });
            return res.json({ success: true, rows });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async create(req: Request, res: Response) {
        try {
            const data = pricingRowSchema.parse(req.body);
            const row = await prisma.aiPricing.create({ data });
            invalidatePriceCache(row.provider, row.model);
            return res.json({ success: true, row });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async update(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const data = pricingPatchSchema.parse(req.body);
            const row = await prisma.aiPricing.update({ where: { id }, data });
            invalidatePriceCache(row.provider, row.model);
            return res.json({ success: true, row });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async remove(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const row = await prisma.aiPricing.delete({ where: { id } });
            invalidatePriceCache(row.provider, row.model);
            return res.json({ success: true });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

// ─── Admin credit ops (per-workspace top-up / reset) ───────────────
const topUpSchema = z.object({ amount: z.number().int().positive() });

export class AdminCreditsController {
    async topUp(req: Request, res: Response) {
        try {
            const workspaceId = req.params.workspaceId as string;
            const { amount } = topUpSchema.parse(req.body);
            const ws = await prisma.workspace.update({
                where: { id: workspaceId },
                data: { creditTopUp: { increment: amount } },
                select: { id: true, creditTopUp: true, creditsUsedThisPeriod: true },
            });
            return res.json({ success: true, workspace: ws });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async reset(req: Request, res: Response) {
        try {
            const workspaceId = req.params.workspaceId as string;
            const ws = await prisma.workspace.update({
                where: { id: workspaceId },
                data: {
                    creditsUsedThisPeriod: 0,
                    creditTopUp: 0,
                    periodResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                },
                select: { id: true, creditsUsedThisPeriod: true, creditTopUp: true, periodResetAt: true },
            });
            return res.json({ success: true, workspace: ws });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async listWorkspaces(_req: Request, res: Response) {
        try {
            const rows = await prisma.workspace.findMany({
                select: {
                    id: true, name: true,
                    creditsUsedThisPeriod: true, creditTopUp: true, periodResetAt: true,
                    plan: { select: { id: true, name: true, monthlyCredits: true, allowCustomApiKeys: true } },
                    owner: { select: { id: true, email: true, name: true } },
                },
                orderBy: { createdAt: 'desc' },
            });
            return res.json({ success: true, workspaces: rows });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

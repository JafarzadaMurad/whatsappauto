// Two routers with very different audiences.
//
// `/api/lider` is the signed-in customer connecting their account.
// `/api/partner/lider` is Lider's server telling us what it charged for.
// They are kept apart so a browser session can never reach the
// partner endpoints and a partner key can never act as a user.

import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import {
    startLink, confirmLink, unlink, getLinkStatus,
    purchasePlan, purchaseCredits, describeAccount,
    assertPartnerAuth, creditsForUsd, LiderError,
} from './lider.service';

function handle(res: any, error: any) {
    if (error instanceof LiderError) {
        return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    if (error instanceof z.ZodError) {
        return res.status(400).json({ success: false, code: 'bad_request', errors: error.issues });
    }
    logger.error({ err: error?.message }, '[lider] unhandled');
    return res.status(500).json({ success: false, code: 'server_error', message: error?.message || 'Server error' });
}

// ─── Customer-facing ────────────────────────────────────────────────
const userRouter = Router();
userRouter.use(authMiddleware);

userRouter.get('/status', async (req, res) => {
    try {
        return res.json({ success: true, ...await getLinkStatus((req as any).user.id) });
    } catch (e) { return handle(res, e); }
});

userRouter.post('/connect', async (req, res) => {
    try {
        const { url, expiresAt } = await startLink((req as any).user.id);
        if (!url) {
            return res.status(503).json({
                success: false,
                code: 'not_configured',
                message: 'Lider is not set up on this platform yet. An admin needs to add the connect URL.',
            });
        }
        return res.json({ success: true, url, expiresAt });
    } catch (e) { return handle(res, e); }
});

userRouter.delete('/connect', async (req, res) => {
    try {
        await unlink((req as any).user.id);
        return res.json({ success: true });
    } catch (e) { return handle(res, e); }
});

// ─── Partner-facing (Lider's server) ────────────────────────────────
const partnerRouter = Router();

partnerRouter.use(async (req, res, next) => {
    try {
        await assertPartnerAuth(req.headers.authorization as string);
        next();
    } catch (e) { return handle(res, e); }
});

// Everything Lider needs to render a purchase screen and run its own
// affordability check. Prices are the source of truth here, so Lider
// never has to keep a copy in sync.
partnerRouter.get('/plans', async (_req, res) => {
    try {
        const plans = await prisma.plan.findMany({
            where: { isActive: true },
            orderBy: { price: 'asc' },
            select: {
                id: true, name: true, description: true,
                price: true, currency: true, interval: true, monthlyCredits: true,
                maxAgents: true, maxWhatsappAccounts: true, maxInstagramAccounts: true, maxAutomations: true,
            },
        });
        return res.json({
            success: true,
            plans,
            credits: {
                perUsd: creditsForUsd(1),
                minimumUsd: 5,
                note: 'Credits are granted at this rate. The minimum exists so small purchases are not mostly fee.',
            },
        });
    } catch (e) { return handle(res, e); }
});

partnerRouter.post('/link', async (req, res) => {
    try {
        const body = z.object({
            token: z.string().min(8),
            liderUserId: z.string().min(1).max(120),
            liderEmail: z.string().email().optional(),
        }).parse(req.body);
        const account = await confirmLink(body);
        return res.json({ success: true, userId: account.userId, liderUserId: account.liderUserId });
    } catch (e) { return handle(res, e); }
});

partnerRouter.get('/account', async (req, res) => {
    try {
        const liderUserId = String(req.query.liderUserId || '');
        if (!liderUserId) return res.status(400).json({ success: false, code: 'bad_request', message: 'liderUserId is required.' });
        return res.json({ success: true, ...await describeAccount(liderUserId) });
    } catch (e) { return handle(res, e); }
});

// Lider has already checked the balance and deducted it. We apply the
// result. `transactionId` is Lider's own id and makes the call safe to
// retry — the second attempt reports alreadyApplied and changes nothing.
partnerRouter.post('/purchase/plan', async (req, res) => {
    try {
        const body = z.object({
            liderUserId: z.string().min(1).max(120),
            planId: z.string().min(1),
            amountUsd: z.number().min(0),
            transactionId: z.string().min(1).max(200),
        }).parse(req.body);
        return res.json({ success: true, ...await purchasePlan(body) });
    } catch (e) { return handle(res, e); }
});

partnerRouter.post('/purchase/credits', async (req, res) => {
    try {
        const body = z.object({
            liderUserId: z.string().min(1).max(120),
            amountUsd: z.number().min(0.01),
            transactionId: z.string().min(1).max(200),
            workspaceId: z.string().uuid().optional(),
        }).parse(req.body);
        return res.json({ success: true, ...await purchaseCredits(body) });
    } catch (e) { return handle(res, e); }
});

export { userRouter as liderUserRouter, partnerRouter as liderPartnerRouter };

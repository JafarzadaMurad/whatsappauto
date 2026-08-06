import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';
import { prisma } from '../../lib/prisma';
import {
    getReferralSummary, loadReferralSettings, saveReferralSettings, findReferrerByCode,
    recordReferralVisit, promoteMaturedCommissions,
} from './referral.service';

const router = Router();

// Public: does this code belong to anyone? Used by the sign-up form so
// someone typing a code sees "referred by X" before they commit, and
// finds out about a typo then rather than after paying.
//
// Returns only a display name — never an email or a user id. A code is
// guessable by design; the endpoint must not turn that into a way to
// enumerate accounts.
router.get('/check/:code', async (req, res) => {
    try {
        const settings = await loadReferralSettings();
        if (!settings.enabled) return res.json({ success: true, valid: false, enabled: false });
        const referrer = await findReferrerByCode(req.params.code as string);
        return res.json({
            success: true,
            enabled: true,
            valid: !!referrer,
            referrerName: referrer?.name || (referrer ? 'a member' : null),
        });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Public: someone landed on a referral link. Recorded before any
// sign-up so a widely-shared link that converts badly is visible as
// exactly that, rather than as silence.
//
// Deliberately forgiving — an unknown code just returns valid:false. A
// visit ping that 400s would surface as a console error on a marketing
// page, which helps nobody.
router.post('/visit', async (req, res) => {
    try {
        const body = z.object({
            code: z.string().min(1).max(32),
            landingPath: z.string().max(255).optional(),
            visitorId: z.string().max(64).optional(),
        }).parse(req.body);

        const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        const result = await recordReferralVisit({
            code: body.code,
            ip: forwarded || req.socket.remoteAddress || null,
            userAgent: String(req.headers['user-agent'] || ''),
            landingPath: body.landingPath,
            visitorId: body.visitorId,
        });
        return res.json({ success: true, ...result });
    } catch {
        return res.json({ success: true, valid: false });
    }
});

// The signed-in user's own code, sign-ups and earnings.
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const userId = (req as any).user.id;
        const summary = await getReferralSummary(userId);
        return res.json({ success: true, ...summary });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ─── Admin ──────────────────────────────────────────────────────────
const adminRouter = Router();
adminRouter.use(authMiddleware, requireAdmin);

adminRouter.get('/settings', async (_req, res) => {
    try {
        return res.json({ success: true, settings: await loadReferralSettings() });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

adminRouter.put('/settings', async (req, res) => {
    try {
        const body = z.object({
            enabled: z.boolean().optional(),
            percent: z.number().min(0).max(100).optional(),
            firstPaymentOnly: z.boolean().optional(),
            minPaymentUsd: z.number().min(0).max(10000).optional(),
            holdbackDays: z.number().int().min(0).max(365).optional(),
            terms: z.string().max(4000).optional(),
        }).parse(req.body);
        return res.json({ success: true, settings: await saveReferralSettings(body) });
    } catch (error: any) {
        if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Every commission, newest first, with who earned it and who paid.
adminRouter.get('/commissions', async (req, res) => {
    try {
        await promoteMaturedCommissions().catch(() => {});
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const rows = await prisma.referralCommission.findMany({
            where: status ? { status } : {},
            orderBy: { createdAt: 'desc' },
            take: 500,
            select: {
                id: true, kind: true, paymentUsd: true, percent: true, amountUsd: true,
                status: true, paidAt: true, createdAt: true, note: true,
                referrer: { select: { id: true, name: true, email: true } },
                referral: { select: { referred: { select: { id: true, name: true, email: true } } } },
            },
        });
        // Decimal columns arrive as Decimal objects and serialise to
        // strings, which a frontend doing arithmetic on them would not
        // survive. Converted once, here at the boundary.
        const commissions = rows.map(r => ({
            ...r,
            paymentUsd: Number(r.paymentUsd.toString()),
            percent: Number(r.percent.toString()),
            amountUsd: Number(r.amountUsd.toString()),
        }));
        const totals = commissions.reduce((acc, r) => {
            acc.all += r.amountUsd;
            acc[r.status] = (acc[r.status] || 0) + r.amountUsd;
            return acc;
        }, { all: 0 } as Record<string, number>);
        return res.json({ success: true, commissions, totals });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Move one commission along. Payout itself happens outside the system —
// this records the decision, which is what makes it auditable.
adminRouter.put('/commissions/:id', async (req, res) => {
    try {
        const body = z.object({
            status: z.enum(['pending', 'approved', 'paid', 'rejected']),
            note: z.string().max(1000).optional(),
        }).parse(req.body);
        const row = await prisma.referralCommission.update({
            where: { id: req.params.id as string },
            data: {
                status: body.status,
                note: body.note,
                paidAt: body.status === 'paid' ? new Date() : null,
            },
        });
        return res.json({ success: true, commission: row });
    } catch (error: any) {
        if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
        return res.status(500).json({ success: false, message: error.message });
    }
});

export { router as referralRouter, adminRouter as adminReferralRouter };

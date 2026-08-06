// Referrals.
//
// Someone hands out a code; a person who signs up with it is tied to
// them permanently; when that person pays, the referrer earns a cut.
//
// The rules an admin controls — the percentage, and whether it applies
// to every payment or only the first — are read at the moment a
// commission is written and then SNAPSHOTTED onto the row. Changing the
// rate later must not rewrite what a referrer was already told they had
// earned; that's the difference between a settings change and a
// retroactive pay cut.
//
// Payout is deliberately not automated. Money leaving the business
// should be a decision someone makes, so commissions land as 'pending'
// and an admin moves them.

import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

// Money is stored as Decimal and comes back as a Decimal object, which
// JSON-serialises to a string. Anything crossing into an API response
// goes through here, so a frontend doing `.toFixed(2)` gets a number
// rather than a crash.
const money = (d: Prisma.Decimal | number | null | undefined): number =>
    d == null ? 0 : Number(d.toString());

export type ReferralSettings = {
    enabled: boolean;
    percent: number;
    /** true = only the referred user's first payment earns anything. */
    firstPaymentOnly: boolean;
    /** Ignore payments below this, so a $5 top-up doesn't spawn cents. */
    minPaymentUsd: number;
    /**
     * Days a commission stays provisional before it can be paid out.
     * A refund inside this window costs nothing to undo; one after a
     * payout costs a conversation and, often, the money.
     */
    holdbackDays: number;
    /** Shown to users on their referral page. */
    terms: string;
};

const DEFAULTS: ReferralSettings = {
    enabled: false,
    percent: 20,
    firstPaymentOnly: true,
    minPaymentUsd: 5,
    holdbackDays: 30,
    terms: '',
};

const CONFIG_KEY = 'REFERRAL_SETTINGS';

export async function loadReferralSettings(): Promise<ReferralSettings> {
    const row = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    if (!row?.value) return DEFAULTS;
    try {
        const parsed = JSON.parse(row.value);
        return {
            enabled: !!parsed.enabled,
            percent: clampPercent(Number(parsed.percent)),
            firstPaymentOnly: parsed.firstPaymentOnly !== false,
            minPaymentUsd: Number.isFinite(Number(parsed.minPaymentUsd)) ? Number(parsed.minPaymentUsd) : DEFAULTS.minPaymentUsd,
            holdbackDays: Number.isFinite(Number(parsed.holdbackDays)) ? Math.max(0, Number(parsed.holdbackDays)) : DEFAULTS.holdbackDays,
            terms: typeof parsed.terms === 'string' ? parsed.terms : '',
        };
    } catch {
        return DEFAULTS;
    }
}

export async function saveReferralSettings(next: Partial<ReferralSettings>): Promise<ReferralSettings> {
    const current = await loadReferralSettings();
    const merged: ReferralSettings = {
        enabled: next.enabled ?? current.enabled,
        percent: clampPercent(next.percent ?? current.percent),
        firstPaymentOnly: next.firstPaymentOnly ?? current.firstPaymentOnly,
        minPaymentUsd: Math.max(0, next.minPaymentUsd ?? current.minPaymentUsd),
        holdbackDays: Math.max(0, Math.round(next.holdbackDays ?? current.holdbackDays)),
        terms: next.terms ?? current.terms,
    };
    await prisma.systemConfig.upsert({
        where: { key: CONFIG_KEY },
        update: { value: JSON.stringify(merged) },
        create: { key: CONFIG_KEY, value: JSON.stringify(merged) },
    });
    return merged;
}

// A rate over 100% would pay out more than came in. Guarding here
// rather than trusting the form means a bad API call can't do it either.
function clampPercent(p: number): number {
    if (!Number.isFinite(p)) return DEFAULTS.percent;
    return Math.min(100, Math.max(0, p));
}

// ─── Codes ──────────────────────────────────────────────────────────

// Ambiguous characters are left out: these get read aloud, typed from
// a screenshot, and written on paper.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(len = 7): string {
    let out = '';
    for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return out;
}

/** This user's code, minted on first use. */
export async function ensureReferralCode(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
    if (user?.referralCode) return user.referralCode;

    for (let attempt = 0; attempt < 6; attempt++) {
        const code = randomCode();
        try {
            await prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
            return code;
        } catch {
            // Unique collision — try another. Six attempts over a 32^7
            // space is not a real risk, but a loop that can't end is.
        }
    }
    throw new Error('Could not allocate a referral code. Try again.');
}

export async function findReferrerByCode(code: string) {
    const cleaned = String(code || '').trim().toUpperCase();
    if (!cleaned) return null;
    return prisma.user.findFirst({
        where: { referralCode: cleaned },
        select: { id: true, name: true, email: true },
    });
}

/**
 * Tie a new sign-up to whoever referred them. Called from registration.
 * Never throws — a bad or unknown code must not stop someone creating
 * an account, so it fails quietly and the sign-up proceeds unattributed.
 */
export async function attachReferral(opts: {
    newUserId: string;
    code?: string | null;
    source?: 'code' | 'link';
}): Promise<boolean> {
    try {
        const settings = await loadReferralSettings();
        if (!settings.enabled) return false;
        if (!opts.code) return false;

        const referrer = await findReferrerByCode(opts.code);
        if (!referrer) return false;
        // Self-referral is the first thing anyone tries.
        if (referrer.id === opts.newUserId) return false;

        const existing = await prisma.referral.findUnique({ where: { referredId: opts.newUserId } });
        if (existing) return false;

        await prisma.referral.create({
            data: {
                referrerId: referrer.id,
                referredId: opts.newUserId,
                code: String(opts.code).trim().toUpperCase(),
                source: opts.source || 'code',
            },
        });
        logger.info({ referrerId: referrer.id, referredId: opts.newUserId }, '[referral] attached');
        return true;
    } catch (err: any) {
        logger.warn({ err: err.message }, '[referral] attach failed');
        return false;
    }
}

// ─── Commission ─────────────────────────────────────────────────────

/**
 * Record what a referrer earned from one payment. Idempotent on
 * `externalId`, so a webhook Stripe retries pays once.
 */
export async function recordReferralCommission(opts: {
    payerUserId: string | null;
    amountUsd: number;
    kind: 'subscription' | 'topup';
    externalId?: string | null;
}): Promise<{ recorded: boolean; reason?: string; amountUsd?: number }> {
    if (!opts.payerUserId) return { recorded: false, reason: 'no payer' };

    const settings = await loadReferralSettings();
    if (!settings.enabled) return { recorded: false, reason: 'referrals disabled' };
    if (!(opts.amountUsd > 0)) return { recorded: false, reason: 'zero payment' };
    if (opts.amountUsd < settings.minPaymentUsd) {
        return { recorded: false, reason: `below the $${settings.minPaymentUsd} minimum` };
    }

    const referral = await prisma.referral.findUnique({
        where: { referredId: opts.payerUserId },
        select: { id: true, referrerId: true },
    });
    if (!referral) return { recorded: false, reason: 'payer was not referred' };

    if (opts.externalId) {
        const seen = await prisma.referralCommission.findUnique({ where: { externalId: opts.externalId } });
        if (seen) return { recorded: false, reason: 'already recorded' };
    }

    if (settings.firstPaymentOnly) {
        const prior = await prisma.referralCommission.count({ where: { referralId: referral.id } });
        if (prior > 0) return { recorded: false, reason: 'first payment only, and it has been paid' };
    }

    // Computed in Decimal end to end. Doing the arithmetic in float and
    // rounding afterwards gets the same answer nearly always, and the
    // exceptions are exactly the ones somebody complains about.
    const payment = new Prisma.Decimal(opts.amountUsd);
    const percent = new Prisma.Decimal(settings.percent);
    const amount = payment.mul(percent).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (amount.lte(0)) return { recorded: false, reason: 'rounds to zero' };

    const availableAt = new Date(Date.now() + settings.holdbackDays * 24 * 60 * 60 * 1000);

    await prisma.referralCommission.create({
        data: {
            referralId: referral.id,
            referrerId: referral.referrerId,
            kind: opts.kind,
            paymentUsd: payment,
            // Snapshotted, not looked up later — see the note at the top.
            percent,
            amountUsd: amount,
            availableAt,
            externalId: opts.externalId || null,
            status: 'pending',
        },
    });

    logger.info(
        { referrerId: referral.referrerId, amount: amount.toString(), kind: opts.kind, paymentUsd: opts.amountUsd },
        '[referral] commission recorded',
    );
    return { recorded: true, amountUsd: money(amount) };
}

/**
 * Move commissions past their holdback from provisional to approved.
 *
 * Run lazily whenever someone looks at their earnings rather than on a
 * schedule: it is cheap, idempotent, and a cron that silently stops is
 * a class of bug this avoids entirely. The worst case is that a
 * commission matures the moment somebody checks, which is also the
 * only moment it matters.
 */
export async function promoteMaturedCommissions(referrerId?: string): Promise<number> {
    const result = await prisma.referralCommission.updateMany({
        where: {
            ...(referrerId ? { referrerId } : {}),
            status: 'pending',
            availableAt: { not: null, lte: new Date() },
        },
        data: { status: 'approved' },
    });
    if (result.count > 0) {
        logger.info({ count: result.count, referrerId: referrerId || 'all' }, '[referral] commissions matured');
    }
    return result.count;
}

/**
 * Take back a commission when the payment behind it is refunded or
 * charged back. Without this the referrer keeps a cut of money the
 * business handed back — small once, structural at volume, and exactly
 * the kind of thing nobody notices until it is a habit.
 *
 * Only pending and approved rows are reversible. One already marked
 * paid has left the building; that is a conversation, not an UPDATE.
 */
export async function reverseReferralCommission(externalId: string): Promise<{ reversed: boolean; reason?: string }> {
    if (!externalId) return { reversed: false, reason: 'no externalId' };

    const commission = await prisma.referralCommission.findUnique({
        where: { externalId },
        select: { id: true, status: true, amountUsd: true, referrerId: true },
    });
    if (!commission) return { reversed: false, reason: 'no commission for that payment' };
    if (commission.status === 'reversed') return { reversed: false, reason: 'already reversed' };
    if (commission.status === 'paid') {
        // Flagged rather than silently rewritten: somebody has to decide
        // whether to claw it back or absorb it.
        await prisma.referralCommission.update({
            where: { id: commission.id },
            data: { note: 'Payment was refunded AFTER this commission was paid out. Needs a manual decision.' },
        });
        logger.warn({ commissionId: commission.id }, '[referral] refund on an already-paid commission');
        return { reversed: false, reason: 'already paid out — flagged for review' };
    }

    await prisma.referralCommission.update({
        where: { id: commission.id },
        data: { status: 'reversed', note: 'Reversed: the payment was refunded.' },
    });
    logger.info(
        { commissionId: commission.id, referrerId: commission.referrerId, amount: commission.amountUsd.toString() },
        '[referral] commission reversed',
    );
    return { reversed: true };
}

// ─── Clicks ─────────────────────────────────────────────────────────

/**
 * Log one visit to a referral link.
 *
 * Sign-ups alone can't tell a link nobody clicked from one being shared
 * widely and converting badly, and those two problems have opposite
 * fixes. Never throws: a failed analytics write must not break the page
 * somebody landed on.
 */
export async function recordReferralVisit(opts: {
    code: string;
    ip?: string | null;
    userAgent?: string | null;
    landingPath?: string | null;
    visitorId?: string | null;
}): Promise<{ valid: boolean; referrerName?: string | null }> {
    try {
        const settings = await loadReferralSettings();
        if (!settings.enabled) return { valid: false };

        const referrer = await findReferrerByCode(opts.code);
        if (!referrer) return { valid: false };

        // The IP is hashed, not stored. The only question it answers is
        // "is this the same machine again", and a salted digest answers
        // that without keeping anything about the person.
        const salt = process.env.JWT_SECRET || 'referral-visit-salt';
        const hash = (v?: string | null) =>
            v ? crypto.createHash('sha256').update(`${v}|${salt}`).digest('hex').slice(0, 64) : null;

        await prisma.referralVisit.create({
            data: {
                code: String(opts.code).trim().toUpperCase(),
                referrerId: referrer.id,
                visitorHash: hash(opts.visitorId),
                ipHash: hash(opts.ip),
                userAgent: (opts.userAgent || '').slice(0, 255) || null,
                landingPath: (opts.landingPath || '').slice(0, 255) || null,
            },
        });

        return { valid: true, referrerName: referrer.name || 'a member' };
    } catch (err: any) {
        logger.warn({ err: err.message }, '[referral] visit not recorded');
        return { valid: false };
    }
}

/** What one user has earned, and from whom. */
export async function getReferralSummary(userId: string) {
    // Anything matured is promoted before the numbers are read, so the
    // page never shows "pending" for something whose holdback expired
    // last week.
    await promoteMaturedCommissions(userId).catch(() => {});

    const [code, settings, referrals, commissions, clicks, uniqueClicks] = await Promise.all([
        ensureReferralCode(userId),
        loadReferralSettings(),
        prisma.referral.findMany({
            where: { referrerId: userId },
            orderBy: { createdAt: 'desc' },
            take: 200,
            select: {
                id: true, createdAt: true, source: true,
                referred: { select: { id: true, name: true, email: true, createdAt: true } },
                commissions: { select: { amountUsd: true, status: true } },
            },
        }),
        prisma.referralCommission.findMany({
            where: { referrerId: userId },
            orderBy: { createdAt: 'desc' },
            take: 200,
            select: {
                id: true, kind: true, paymentUsd: true, percent: true, amountUsd: true,
                status: true, paidAt: true, availableAt: true, createdAt: true, note: true,
            },
        }),
        prisma.referralVisit.count({ where: { referrerId: userId } }),
        prisma.referralVisit.findMany({
            where: { referrerId: userId, visitorHash: { not: null } },
            distinct: ['visitorHash'],
            select: { id: true },
        }),
    ]);

    const total = (statuses?: string[]) => commissions
        .filter(c => !statuses || statuses.includes(c.status))
        .reduce((n, c) => n + money(c.amountUsd), 0);

    return {
        code,
        enabled: settings.enabled,
        percent: settings.percent,
        firstPaymentOnly: settings.firstPaymentOnly,
        holdbackDays: settings.holdbackDays,
        terms: settings.terms,

        clicks,
        uniqueClicks: uniqueClicks.length,
        signups: referrals.length,
        // Someone who signed up but never paid is the number that
        // explains "I referred ten people and earned nothing".
        paying: referrals.filter(r => r.commissions.length > 0).length,

        earnedTotalUsd: Number(total(['pending', 'approved', 'paid']).toFixed(2)),
        // Still inside the holdback — earned, but not yet payable.
        earnedHeldUsd: Number(total(['pending']).toFixed(2)),
        earnedAvailableUsd: Number(total(['approved']).toFixed(2)),
        earnedPaidUsd: Number(total(['paid']).toFixed(2)),

        referrals: referrals.map(r => ({
            ...r,
            commissions: r.commissions.map(c => ({ ...c, amountUsd: money(c.amountUsd) })),
        })),
        commissions: commissions.map(c => ({
            ...c,
            paymentUsd: money(c.paymentUsd),
            percent: money(c.percent),
            amountUsd: money(c.amountUsd),
        })),
    };
}

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

import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

export type ReferralSettings = {
    enabled: boolean;
    percent: number;
    /** true = only the referred user's first payment earns anything. */
    firstPaymentOnly: boolean;
    /** Ignore payments below this, so a $5 top-up doesn't spawn cents. */
    minPaymentUsd: number;
    /** Shown to users on their referral page. */
    terms: string;
};

const DEFAULTS: ReferralSettings = {
    enabled: false,
    percent: 20,
    firstPaymentOnly: true,
    minPaymentUsd: 5,
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

    const amount = Math.round((opts.amountUsd * settings.percent / 100) * 100) / 100;
    if (amount <= 0) return { recorded: false, reason: 'rounds to zero' };

    await prisma.referralCommission.create({
        data: {
            referralId: referral.id,
            referrerId: referral.referrerId,
            kind: opts.kind,
            paymentUsd: opts.amountUsd,
            // Snapshotted, not looked up later — see the note at the top.
            percent: settings.percent,
            amountUsd: amount,
            externalId: opts.externalId || null,
            status: 'pending',
        },
    });

    logger.info(
        { referrerId: referral.referrerId, amount, kind: opts.kind, paymentUsd: opts.amountUsd },
        '[referral] commission recorded',
    );
    return { recorded: true, amountUsd: amount };
}

/** What one user has earned, and from whom. */
export async function getReferralSummary(userId: string) {
    const [code, settings, referrals, commissions] = await Promise.all([
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
                status: true, paidAt: true, createdAt: true,
            },
        }),
    ]);

    const total = (status?: string) => commissions
        .filter(c => !status || c.status === status)
        .reduce((n, c) => n + c.amountUsd, 0);

    return {
        code,
        enabled: settings.enabled,
        percent: settings.percent,
        firstPaymentOnly: settings.firstPaymentOnly,
        terms: settings.terms,
        signups: referrals.length,
        // Someone who signed up but never paid is the number that
        // explains "I referred ten people and earned nothing".
        paying: referrals.filter(r => r.commissions.length > 0).length,
        earnedTotalUsd: Number(total().toFixed(2)),
        earnedPendingUsd: Number(total('pending').toFixed(2)),
        earnedPaidUsd: Number(total('paid').toFixed(2)),
        referrals,
        commissions,
    };
}

// Lider integration.
//
// Lider holds the customer's money and decides whether they can afford
// something. This platform never mirrors that balance — a second copy
// of someone's money is a reconciliation problem you get to discover at
// the worst moment. Lider deducts, then tells us what to apply; we
// apply it and say what we did.
//
// The connect handshake avoids implementing an OAuth server on either
// side for what is really one question: "is this chatbot user the same
// person as this Lider user?"
//
//   1. Signed-in chatbot user asks to connect → we mint a single-use,
//      short-lived token and send them to Lider carrying it.
//   2. Lider authenticates its own user however it already does, then
//      calls back server-to-server with the token plus its user id.
//   3. We bind the two accounts and burn the token.
//
// The token proves step 1 happened for that specific account, and the
// partner key proves step 2 came from Lider. Neither is enough alone.

import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { CAI_PER_USD } from '../../lib/ai-pricing';

export class LiderError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

const CONFIG_API_KEY = 'LIDER_API_KEY';
const CONFIG_CONNECT_URL = 'LIDER_CONNECT_URL';
const TOKEN_TTL_MS = 15 * 60 * 1000;

export async function loadLiderConfig() {
    const rows = await prisma.systemConfig.findMany({
        where: { key: { in: [CONFIG_API_KEY, CONFIG_CONNECT_URL] } },
    });
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return {
        apiKey: (map[CONFIG_API_KEY] || '').trim(),
        connectUrl: (map[CONFIG_CONNECT_URL] || '').trim(),
        configured: !!(map[CONFIG_API_KEY] || '').trim(),
    };
}

/**
 * Authenticate a server-to-server call from Lider. Compared in constant
 * time — a plain === leaks the key one character at a time to anyone
 * patient enough to measure.
 */
export async function assertPartnerAuth(headerValue?: string) {
    const { apiKey } = await loadLiderConfig();
    if (!apiKey) throw new LiderError('not_configured', 'Lider integration is not configured on this platform.', 503);

    const presented = String(headerValue || '').replace(/^Bearer\s+/i, '').trim();
    if (!presented) throw new LiderError('unauthorized', 'Missing API key.', 401);

    const a = Buffer.from(presented);
    const b = Buffer.from(apiKey);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw new LiderError('unauthorized', 'Invalid API key.', 401);
    }
}

// ─── Connect ────────────────────────────────────────────────────────

export async function startLink(userId: string): Promise<{ token: string; url: string | null; expiresAt: Date }> {
    const { connectUrl } = await loadLiderConfig();
    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await prisma.liderLinkToken.create({ data: { token, userId, expiresAt } });

    const back = (config.FRONTEND_URL || 'https://chatbot.tural.ai').replace(/\/$/, '');
    const url = connectUrl
        ? `${connectUrl}${connectUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}&return_url=${encodeURIComponent(`${back}/dashboard/billing?lider=connected`)}`
        : null;

    return { token, url, expiresAt };
}

export async function confirmLink(opts: {
    token: string;
    liderUserId: string;
    liderEmail?: string | null;
}) {
    const row = await prisma.liderLinkToken.findUnique({
        where: { token: opts.token },
        select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
    if (!row) throw new LiderError('bad_token', 'Unknown connect token.', 404);
    if (row.usedAt) throw new LiderError('token_used', 'That connect token has already been used.');
    if (row.expiresAt.getTime() < Date.now()) throw new LiderError('token_expired', 'That connect token has expired. Start again from the billing page.');

    const liderUserId = String(opts.liderUserId || '').trim();
    if (!liderUserId) throw new LiderError('bad_request', 'liderUserId is required.');

    // A Lider account already bound elsewhere must not be re-pointed
    // silently: that would let one person's balance pay for another
    // person's plan.
    const clash = await prisma.liderAccount.findUnique({ where: { liderUserId } });
    if (clash && clash.userId !== row.userId) {
        throw new LiderError('already_linked', 'That Lider account is already connected to a different chatbot account.', 409);
    }

    const account = await prisma.liderAccount.upsert({
        where: { userId: row.userId },
        update: { liderUserId, liderEmail: opts.liderEmail || null },
        create: { userId: row.userId, liderUserId, liderEmail: opts.liderEmail || null },
    });

    await prisma.liderLinkToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    logger.info({ userId: row.userId, liderUserId }, '[lider] account linked');
    return account;
}

export async function unlink(userId: string) {
    await prisma.liderAccount.deleteMany({ where: { userId } });
}

export async function getLinkStatus(userId: string) {
    const [account, cfg] = await Promise.all([
        prisma.liderAccount.findUnique({ where: { userId } }),
        loadLiderConfig(),
    ]);
    return {
        available: cfg.configured && !!cfg.connectUrl,
        connected: !!account,
        liderUserId: account?.liderUserId || null,
        liderEmail: account?.liderEmail || null,
        connectedAt: account?.connectedAt || null,
    };
}

// ─── Purchases reported by Lider ────────────────────────────────────

async function resolveUser(liderUserId: string) {
    const account = await prisma.liderAccount.findUnique({
        where: { liderUserId: String(liderUserId || '').trim() },
        select: { userId: true, user: { select: { id: true, email: true, name: true } } },
    });
    if (!account) throw new LiderError('not_linked', 'No chatbot account is connected to that Lider user.', 404);
    return account;
}

/**
 * Apply a plan Lider has already charged for.
 *
 * Idempotent on `transactionId`: Lider retrying — which any sane
 * payment system does — must not grant a second month or fire a second
 * referral commission.
 */
export async function purchasePlan(opts: {
    liderUserId: string;
    planId: string;
    amountUsd: number;
    transactionId: string;
}) {
    const externalId = `lider:${String(opts.transactionId || '').trim()}`;
    if (!opts.transactionId) throw new LiderError('bad_request', 'transactionId is required.');

    const existing = await prisma.liderTransaction.findUnique({ where: { externalId } });
    if (existing) {
        return { applied: false, alreadyApplied: true, userId: existing.userId, planId: existing.planId };
    }

    const account = await resolveUser(opts.liderUserId);
    const plan = await prisma.plan.findUnique({ where: { id: opts.planId } });
    if (!plan) throw new LiderError('no_plan', 'Plan not found.', 404);
    if (!plan.isActive) throw new LiderError('plan_inactive', `Plan "${plan.name}" is not available.`);

    // The user's own plan, and every workspace they own — feature gates
    // read the workspace, so updating only the user leaves the paid-for
    // perks switched off.
    await prisma.$transaction([
        prisma.user.update({
            where: { id: account.userId },
            data: { planId: plan.id, subscriptionStatus: 'active' },
        }),
        prisma.workspace.updateMany({
            where: { ownerId: account.userId },
            data: { planId: plan.id, subscriptionStatus: 'active' },
        }),
        prisma.liderTransaction.create({
            data: {
                externalId,
                userId: account.userId,
                kind: 'plan',
                amountUsd: opts.amountUsd,
                planId: plan.id,
            },
        }),
    ]);

    // Same commission rules as a card payment — where the money came
    // from is not the referrer's concern.
    const { recordReferralCommission } = await import('../referral/referral.service');
    await recordReferralCommission({
        payerUserId: account.userId,
        amountUsd: opts.amountUsd,
        kind: 'subscription',
        externalId,
    }).catch(err => logger.warn({ err: err.message }, '[lider] referral commission failed'));

    logger.info({ userId: account.userId, planId: plan.id, amountUsd: opts.amountUsd }, '[lider] plan applied');
    return {
        applied: true,
        alreadyApplied: false,
        userId: account.userId,
        plan: { id: plan.id, name: plan.name, price: plan.price, monthlyCredits: plan.monthlyCredits },
    };
}

/**
 * Add credits Lider has already charged for. Same idempotency rule.
 * The credits land on the user's first owned workspace unless one is
 * named — a customer with several would otherwise have to guess which
 * got topped up.
 */
export async function purchaseCredits(opts: {
    liderUserId: string;
    amountUsd: number;
    transactionId: string;
    workspaceId?: string | null;
}) {
    const externalId = `lider:${String(opts.transactionId || '').trim()}`;
    if (!opts.transactionId) throw new LiderError('bad_request', 'transactionId is required.');
    if (!(opts.amountUsd > 0)) throw new LiderError('bad_request', 'amountUsd must be greater than zero.');

    const existing = await prisma.liderTransaction.findUnique({ where: { externalId } });
    if (existing) {
        return { applied: false, alreadyApplied: true, userId: existing.userId, credits: existing.credits };
    }

    const account = await resolveUser(opts.liderUserId);

    const workspace = opts.workspaceId
        ? await prisma.workspace.findFirst({ where: { id: opts.workspaceId, ownerId: account.userId } })
        : await prisma.workspace.findFirst({ where: { ownerId: account.userId }, orderBy: { createdAt: 'asc' } });
    if (!workspace) throw new LiderError('no_workspace', 'That account has no workspace to credit.', 404);

    const credits = Math.round(opts.amountUsd * CAI_PER_USD);

    await prisma.$transaction([
        prisma.workspace.update({
            where: { id: workspace.id },
            data: { creditTopUp: { increment: credits } },
        }),
        // Written to the same table card purchases use, so the billing
        // page shows one history rather than two.
        prisma.creditPurchase.create({
            data: {
                workspaceId: workspace.id,
                userId: account.userId,
                amountUsd: opts.amountUsd,
                credits,
                source: 'lider',
                externalId,
                status: 'paid',
                paidAt: new Date(),
            },
        }),
        prisma.liderTransaction.create({
            data: {
                externalId,
                userId: account.userId,
                kind: 'credits',
                amountUsd: opts.amountUsd,
                credits,
            },
        }),
    ]);

    const { recordReferralCommission } = await import('../referral/referral.service');
    await recordReferralCommission({
        payerUserId: account.userId,
        amountUsd: opts.amountUsd,
        kind: 'topup',
        externalId,
    }).catch(err => logger.warn({ err: err.message }, '[lider] referral commission failed'));

    logger.info({ userId: account.userId, workspaceId: workspace.id, credits }, '[lider] credits added');
    return {
        applied: true,
        alreadyApplied: false,
        userId: account.userId,
        workspaceId: workspace.id,
        credits,
    };
}

/** What Lider shows on its own screen before charging anything. */
export async function describeAccount(liderUserId: string) {
    const account = await resolveUser(liderUserId);
    const [user, workspace] = await Promise.all([
        prisma.user.findUnique({
            where: { id: account.userId },
            select: {
                id: true, email: true, name: true, subscriptionStatus: true,
                plan: { select: { id: true, name: true, price: true, currency: true, interval: true, monthlyCredits: true } },
            },
        }),
        prisma.workspace.findFirst({ where: { ownerId: account.userId }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }),
    ]);

    const { getCreditBalance } = await import('../../lib/credit-guard');
    const balance = workspace ? await getCreditBalance(workspace.id) : null;

    return {
        user: { id: user?.id, email: user?.email, name: user?.name },
        subscriptionStatus: user?.subscriptionStatus || 'none',
        plan: user?.plan || null,
        workspace: workspace || null,
        credits: balance ? { remaining: balance.remaining, totalBudget: balance.totalBudget } : null,
    };
}

export const creditsForUsd = (usd: number) => Math.round(usd * CAI_PER_USD);

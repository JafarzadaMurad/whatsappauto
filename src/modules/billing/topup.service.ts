// Buying credits.
//
// A subscription gives a workspace a monthly allowance. When that runs
// out mid-month the only options were "wait for the reset" or "ask an
// admin to grant some by hand" — neither of which a customer at 2am
// can act on. This is the third: pay, and the credits land immediately.
//
// Two things are deliberate.
//
// A purchase gets its own row rather than only bumping the balance.
// "How much did they buy, when, and did it clear" is a question the
// balance can't answer, and a refund or a replayed webhook needs
// something to reconcile against — the Stripe session id is unique on
// the row, so crediting twice is impossible rather than merely unlikely.
//
// And credits are granted on the webhook, not on the redirect back. A
// user who closes the tab after paying still gets what they bought;
// one who edits the success URL gets nothing.

import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { CAI_PER_USD } from '../../lib/ai-pricing';
import { getStripe, getOrCreateCustomer } from './billing.service';

// Card fees make anything smaller mostly fee. Stripe's own minimum
// charge is $0.50, but at that size we'd be processing payments for
// the privilege of losing money on them.
export const MIN_TOPUP_USD = 5;
export const MAX_TOPUP_USD = 10_000;

export const creditsForUsd = (usd: number) => Math.round(usd * CAI_PER_USD);

export class TopUpError extends Error {
    code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

/**
 * Start a credit purchase. Returns the Stripe Checkout URL to send the
 * user to; nothing is charged and no credits move until the webhook
 * confirms payment.
 */
export async function createTopUpSession(opts: {
    userId: string;
    workspaceId: string;
    amountUsd: number;
}): Promise<{ url: string; purchaseId: string; credits: number }> {
    const amount = Math.round(Number(opts.amountUsd) * 100) / 100;
    if (!Number.isFinite(amount) || amount < MIN_TOPUP_USD) {
        throw new TopUpError('below_minimum', `The minimum top-up is $${MIN_TOPUP_USD}.`);
    }
    if (amount > MAX_TOPUP_USD) {
        throw new TopUpError('above_maximum', `The maximum top-up is $${MAX_TOPUP_USD.toLocaleString()}.`);
    }

    const ws = await prisma.workspace.findFirst({
        where: { id: opts.workspaceId },
        select: { id: true, name: true },
    });
    if (!ws) throw new TopUpError('no_workspace', 'Workspace not found.');

    const credits = creditsForUsd(amount);

    // Recorded before redirecting so an abandoned checkout is visible
    // as a pending row rather than as nothing at all.
    const purchase = await prisma.creditPurchase.create({
        data: {
            workspaceId: ws.id,
            userId: opts.userId,
            amountUsd: amount,
            credits,
            source: 'stripe',
            status: 'pending',
        },
    });

    const stripe = await getStripe();
    const customerId = await getOrCreateCustomer(opts.userId);
    const baseUrl = (config.FRONTEND_URL || 'https://chatbot.tural.ai').replace(/\/$/, '');

    const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer: customerId,
        // Priced inline rather than from a fixed Stripe Price, because
        // the amount is whatever the customer typed. This is why no
        // product setup is needed in the Stripe dashboard for top-ups.
        line_items: [{
            quantity: 1,
            price_data: {
                currency: 'usd',
                unit_amount: Math.round(amount * 100),
                product_data: {
                    name: `${credits.toLocaleString()} credits`,
                    description: `Credit top-up for ${ws.name}`,
                },
            },
        }],
        success_url: `${baseUrl}/dashboard/billing?topup=done`,
        cancel_url: `${baseUrl}/dashboard/billing?topup=cancelled`,
        // Read back in the webhook. `purchaseId` is what ties the
        // payment to the row we just wrote.
        metadata: {
            kind: 'credit_topup',
            purchaseId: purchase.id,
            workspaceId: ws.id,
            userId: opts.userId,
            credits: String(credits),
        },
    });

    if (!session.url) throw new TopUpError('stripe_error', 'Stripe did not return a checkout URL.');

    await prisma.creditPurchase.update({
        where: { id: purchase.id },
        data: { externalId: session.id },
    });

    return { url: session.url, purchaseId: purchase.id, credits };
}

/**
 * Credit a paid purchase. Idempotent: a row already marked paid is
 * left alone, so a webhook Stripe retries — which it will — can't
 * double-credit a workspace.
 */
export async function completeTopUp(opts: {
    purchaseId?: string | null;
    externalId?: string | null;
}): Promise<{ credited: boolean; credits: number } | null> {
    const where = opts.purchaseId
        ? { id: opts.purchaseId }
        : opts.externalId ? { externalId: opts.externalId } : null;
    if (!where) return null;

    const purchase = await prisma.creditPurchase.findFirst({ where });
    if (!purchase) {
        logger.warn({ ...opts }, '[topup] paid event for an unknown purchase');
        return null;
    }
    if (purchase.status === 'paid') {
        return { credited: false, credits: purchase.credits };
    }

    // One transaction so a crash between the two writes can't leave a
    // purchase marked paid with the credits never added.
    await prisma.$transaction([
        prisma.creditPurchase.update({
            where: { id: purchase.id },
            data: { status: 'paid', paidAt: new Date() },
        }),
        prisma.workspace.update({
            where: { id: purchase.workspaceId },
            data: { creditTopUp: { increment: purchase.credits } },
        }),
    ]);

    logger.info(
        { purchaseId: purchase.id, workspaceId: purchase.workspaceId, credits: purchase.credits, amountUsd: purchase.amountUsd },
        '[topup] credits added',
    );
    return { credited: true, credits: purchase.credits };
}

/** Purchase history for the billing page. */
export async function listPurchases(workspaceId: string, take = 50) {
    const rows = await prisma.creditPurchase.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
            id: true, amountUsd: true, credits: true, currency: true,
            source: true, status: true, paidAt: true, createdAt: true,
            user: { select: { id: true, name: true, email: true } },
        },
    });
    // Decimal serialises to a string; the page does arithmetic on this.
    return rows.map(r => ({ ...r, amountUsd: Number(r.amountUsd.toString()) }));
}

/**
 * Undo a credit purchase whose payment came back.
 *
 * The credits may already be spent, which is why the balance is floored
 * at zero rather than allowed to go negative: a workspace that used
 * what it paid for and then charged back has taken the service, and
 * chasing that through a negative balance would break every unrelated
 * call they make afterwards. The purchase row records what happened;
 * the recovery is a business conversation, not a subtraction.
 */
export async function reverseTopUp(externalId: string): Promise<{ reversed: boolean; reason?: string }> {
    const purchase = await prisma.creditPurchase.findUnique({ where: { externalId } });
    if (!purchase) return { reversed: false, reason: 'not a credit purchase' };
    if (purchase.status === 'refunded') return { reversed: false, reason: 'already reversed' };
    if (purchase.status !== 'paid') {
        await prisma.creditPurchase.update({ where: { id: purchase.id }, data: { status: 'refunded' } });
        return { reversed: true };
    }

    const ws = await prisma.workspace.findUnique({
        where: { id: purchase.workspaceId },
        select: { creditTopUp: true },
    });
    const take = Math.min(purchase.credits, ws?.creditTopUp ?? 0);

    await prisma.$transaction([
        prisma.creditPurchase.update({
            where: { id: purchase.id },
            data: { status: 'refunded' },
        }),
        prisma.workspace.update({
            where: { id: purchase.workspaceId },
            data: { creditTopUp: { decrement: take } },
        }),
    ]);

    logger.info(
        { purchaseId: purchase.id, workspaceId: purchase.workspaceId, credits: purchase.credits, clawedBack: take },
        '[topup] purchase refunded',
    );
    return { reversed: true };
}

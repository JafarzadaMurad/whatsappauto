import Stripe from 'stripe';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { config } from '../../config';

// Lazy Stripe client. Keys live in SystemConfig so admins can set them
// at runtime via the Payment Integration page.
let cachedClient: { key: string; stripe: any } | null = null;

async function getStripeKeys() {
    const rows = await prisma.systemConfig.findMany({
        where: { key: { in: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] } }
    });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return {
        secret: map.STRIPE_SECRET_KEY || '',
        webhookSecret: map.STRIPE_WEBHOOK_SECRET || ''
    };
}

export async function getStripe(): Promise<any> {
    const { secret } = await getStripeKeys();
    if (!secret) throw new Error('Stripe is not configured. Set the Stripe Secret Key in Admin → Payments.');
    if (cachedClient?.key === secret) return cachedClient.stripe;
    const stripe = new Stripe(secret);
    cachedClient = { key: secret, stripe };
    return stripe;
}

export async function getOrCreateCustomer(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');
    if (user.stripeCustomerId) return user.stripeCustomerId;

    const stripe = await getStripe();
    const customer = await stripe.customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: { userId: user.id }
    });
    await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } });
    return customer.id;
}

export async function createCheckoutSession(userId: string, planId: string): Promise<string> {
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new Error('Plan not found');
    if (!plan.stripePriceId) throw new Error(`Plan "${plan.name}" has no Stripe Price ID. Admin must set it on the plan.`);
    if (!plan.isActive) throw new Error('Plan is not active');

    const customerId = await getOrCreateCustomer(userId);
    const stripe = await getStripe();
    const baseUrl = config.FRONTEND_URL || 'https://chatbot.tural.ai';

    const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: plan.stripePriceId, quantity: 1 }],
        success_url: `${baseUrl}/dashboard/billing?status=success`,
        cancel_url: `${baseUrl}/dashboard/billing?status=cancel`,
        metadata: { userId, planId },
        subscription_data: { metadata: { userId, planId } }
    });

    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    return session.url;
}

export async function createPortalSession(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.stripeCustomerId) throw new Error('No active subscription — subscribe first.');
    const stripe = await getStripe();
    const baseUrl = config.FRONTEND_URL || 'https://chatbot.tural.ai';
    const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${baseUrl}/dashboard/billing`
    });
    return session.url;
}

export async function constructWebhookEvent(rawBody: Buffer | string, signature: string): Promise<any> {
    const { webhookSecret } = await getStripeKeys();
    if (!webhookSecret) throw new Error('Stripe webhook secret not configured');
    const stripe = await getStripe();
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

function strCustomer(c: any): string | null {
    if (!c) return null;
    return typeof c === 'string' ? c : c.id;
}

export async function handleWebhookEvent(event: any): Promise<void> {
    logger.info({ type: event.type, id: event.id }, '[Stripe] webhook event');

    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            const userId = session.metadata?.userId;
            const planId = session.metadata?.planId;

            // A one-off credit purchase rides the same event as a
            // subscription. Branch on the metadata we set at creation
            // rather than on the session mode, so a future one-off of
            // some other kind can't be mistaken for credits.
            if (session.metadata?.kind === 'credit_topup') {
                const { completeTopUp } = await import('./topup.service');
                await completeTopUp({
                    purchaseId: session.metadata?.purchaseId || null,
                    externalId: session.id,
                });
                // Referral commission, if this payer was referred.
                const { recordReferralCommission } = await import('../referral/referral.service');
                await recordReferralCommission({
                    payerUserId: userId || null,
                    amountUsd: (session.amount_total || 0) / 100,
                    kind: 'topup',
                    externalId: session.id,
                }).catch(err => logger.warn({ err: err.message }, '[referral] commission failed'));
                return;
            }

            if (!userId) return;
            const customerId = strCustomer(session.customer as any);
            const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
            await prisma.user.update({
                where: { id: userId },
                data: {
                    ...(planId ? { planId } : {}),
                    ...(customerId ? { stripeCustomerId: customerId } : {}),
                    ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
                    subscriptionStatus: 'active'
                }
            });
            // Propagate the new plan to every workspace the user owns.
            // Feature gates (copilot, monthlyCredits, allowCustomApiKeys)
            // are keyed off Workspace.planId — leaving that stale means
            // the paid-for perks silently stay off until manual sync.
            if (planId) {
                await prisma.workspace.updateMany({
                    where: { ownerId: userId },
                    data: { planId, subscriptionStatus: 'active' },
                });
            }

            {
                const { recordReferralCommission } = await import('../referral/referral.service');
                await recordReferralCommission({
                    payerUserId: userId,
                    amountUsd: (session.amount_total || 0) / 100,
                    kind: 'subscription',
                    externalId: session.id,
                }).catch(err => logger.warn({ err: err.message }, '[referral] commission failed'));
            }
            break;
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
            const sub = event.data.object;
            const customerId = strCustomer(sub.customer as any);
            const user = await prisma.user.findFirst({
                where: {
                    OR: [
                        { stripeSubscriptionId: sub.id },
                        ...(customerId ? [{ stripeCustomerId: customerId }] : [])
                    ]
                }
            });
            if (!user) return;
            const status = sub.status; // active | canceled | past_due | trialing | incomplete | ...
            const periodEnd = (sub as any).current_period_end as number | null | undefined;
            const endsAt = periodEnd ? new Date(periodEnd * 1000) : null;
            const priceId = sub.items.data[0]?.price?.id;
            const plan = priceId ? await prisma.plan.findFirst({ where: { stripePriceId: priceId } }) : null;
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    subscriptionStatus: status,
                    subscriptionEndsAt: endsAt,
                    stripeSubscriptionId: sub.id,
                    ...(plan ? { planId: plan.id } : {})
                }
            });
            // Sync every workspace the user owns so feature gates
            // (copilot, cai budget, custom-key allowance) pick up the
            // new plan immediately — otherwise loadPlanAccess()-style
            // checks stay on the stale row.
            await prisma.workspace.updateMany({
                where: { ownerId: user.id },
                data: {
                    subscriptionStatus: status,
                    subscriptionEndsAt: endsAt,
                    stripeSubscriptionId: sub.id,
                    ...(plan ? { planId: plan.id } : {}),
                },
            });
            break;
        }

        case 'invoice.paid':
        case 'invoice.payment_failed': {
            const inv = event.data.object;
            const customerId = strCustomer(inv.customer as any);
            if (!customerId) return;
            const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
            if (!user) return;
            await prisma.user.update({
                where: { id: user.id },
                data: { subscriptionStatus: event.type === 'invoice.paid' ? 'active' : 'past_due' }
            });
            // ─── cai monthly reset ───
            // On a successful invoice, refill every workspace this user
            // owns: creditsUsedThisPeriod=0 and periodResetAt bumped to
            // the invoice's period_end (falling back to now + 30d).
            // Manual top-ups are consumed too so they don't stack forever.
            if (event.type === 'invoice.paid') {
                const periodEnd = (inv as any).lines?.data?.[0]?.period?.end
                    || (inv as any).period_end
                    || null;
                const resetAt = periodEnd
                    ? new Date(Number(periodEnd) * 1000)
                    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
                await prisma.workspace.updateMany({
                    where: { ownerId: user.id },
                    data: {
                        creditsUsedThisPeriod: 0,
                        creditTopUp: 0,
                        periodResetAt: resetAt,
                    },
                });
            }
            break;
        }
    }
}

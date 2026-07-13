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

async function getOrCreateCustomer(userId: string): Promise<string> {
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

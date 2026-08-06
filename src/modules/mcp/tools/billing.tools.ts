// Plan, balance and usage tools.
//
// MCP could create agents, send messages and manage tables, but it
// couldn't answer the two questions a customer asks most often: what am
// I paying for, and how much have I got left. So an assistant could
// burn a workspace's credits building things and had no way to notice
// the pool was nearly empty, or to explain the 402 when it hit one.
//
// All read-only. Buying a plan or topping up moves real money, and that
// belongs behind a checkout page the person actually looks at — not
// behind a tool an assistant can decide to call. `get_topup_link` and
// `get_plan_checkout_link` therefore return a URL to open rather than
// performing the purchase.

import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { ok, fail, type RegisterToolFn } from '../mcp.server';
import { getCreditBalance } from '../../../lib/credit-guard';
import { config } from '../../../config';

const baseUrl = () => (config.FRONTEND_URL || 'https://chatbot.tural.ai').replace(/\/$/, '');

export function registerBillingTools(reg: RegisterToolFn) {
    reg(
        'get_current_plan',
        'Returns the plan the active workspace is on: its name, price, what it includes, and the resource limits it imposes (agents, WhatsApp accounts, automations, monthly credits). Call this before creating resources so you know whether the workspace is allowed another one.',
        {},
        async (_args, ctx) => {
            const ws = await prisma.workspace.findUnique({
                where: { id: ctx.workspaceId },
                select: {
                    id: true, name: true, subscriptionStatus: true,
                    plan: true,
                    owner: { select: { id: true, email: true, subscriptionStatus: true } },
                },
            });
            if (!ws) return fail('Workspace not found.');
            if (!ws.plan) {
                return ok({
                    workspace: ws.name,
                    plan: null,
                    note: 'This workspace has no plan assigned. Platform LLM calls will be refused until it does.',
                });
            }
            const p = ws.plan;
            return ok({
                workspace: ws.name,
                subscriptionStatus: ws.subscriptionStatus || ws.owner?.subscriptionStatus || 'none',
                plan: {
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    price: p.price,
                    currency: p.currency,
                    interval: p.interval,
                    monthlyCredits: p.monthlyCredits,
                    limits: {
                        agents: p.maxAgents,
                        whatsappAccounts: p.maxWhatsappAccounts,
                        instagramAccounts: p.maxInstagramAccounts,
                        automations: p.maxAutomations,
                        monthlyMessages: p.monthlyMessageLimit,
                    },
                    features: {
                        ownApiKeys: p.allowCustomApiKeys,
                        copilot: p.copilotEnabled,
                        copilotVoice: p.copilotVoiceEnabled,
                        whenCreditsRunOut: p.overageBehavior,
                    },
                },
                note: '-1 on a limit means unlimited.',
            });
        },
    );

    reg(
        'list_plans',
        'Lists every plan available to buy, with price and what each includes. Use it to answer "what plans do you have" or to compare the current plan against an upgrade.',
        {},
        async (_args, ctx) => {
            const [plans, ws] = await Promise.all([
                prisma.plan.findMany({
                    where: { isActive: true },
                    orderBy: { price: 'asc' },
                }),
                prisma.workspace.findUnique({ where: { id: ctx.workspaceId }, select: { planId: true } }),
            ]);
            return ok({
                current: ws?.planId || null,
                plans: plans.map(p => ({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    price: p.price,
                    currency: p.currency,
                    interval: p.interval,
                    monthlyCredits: p.monthlyCredits,
                    isCurrent: p.id === ws?.planId,
                    limits: {
                        agents: p.maxAgents,
                        whatsappAccounts: p.maxWhatsappAccounts,
                        instagramAccounts: p.maxInstagramAccounts,
                        automations: p.maxAutomations,
                    },
                    purchasable: !!p.stripePriceId,
                })),
            });
        },
    );

    reg(
        'get_credit_balance',
        'Returns the active workspace\'s credit position: monthly allowance, purchased top-up, how much has been spent this period, what remains, and when the pool resets. Call this when the user asks about credits, or when a tool fails because the workspace ran out.',
        {},
        async (_args, ctx) => {
            const balance = await getCreditBalance(ctx.workspaceId);
            if (!balance) return fail('Workspace not found.');
            return ok({
                ...balance,
                // The rate is the thing that makes the number mean
                // anything — quoting "9 credits" alone tells nobody
                // whether that was expensive.
                creditValueUsd: 0.0001,
                remainingUsd: Number((balance.remaining * 0.0001).toFixed(2)),
            });
        },
    );

    reg(
        'get_usage',
        'Breaks down what the active workspace has spent credits on. Groups by model and by cause (agent replies, campaigns, copilot, voice calls). Use it to answer "where are my credits going" or "which agent costs the most".',
        {
            days: z.number().int().min(1).max(90).optional()
                .describe('How far back to look. Defaults to 30 days.'),
        },
        async ({ days }, ctx) => {
            const window = days || 30;
            const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);
            const rows = await prisma.creditLedger.findMany({
                where: { workspaceId: ctx.workspaceId, createdAt: { gte: since } },
                select: {
                    provider: true, model: true, cause: true, creditsUsed: true,
                    realCostUsd: true, usedOwnKey: true, createdAt: true,
                    agent: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: 5000,
            });

            const sum = <K extends string>(key: (r: typeof rows[number]) => K) => {
                const out: Record<string, { credits: number; calls: number }> = {};
                for (const r of rows) {
                    const k = key(r) || 'unknown';
                    out[k] = out[k] || { credits: 0, calls: 0 };
                    out[k].credits += r.creditsUsed || 0;
                    out[k].calls += 1;
                }
                return Object.entries(out)
                    .map(([name, v]) => ({ name, ...v }))
                    .sort((a, b) => b.credits - a.credits);
            };

            const total = rows.reduce((n, r) => n + (r.creditsUsed || 0), 0);
            // Calls on the workspace's own API key cost them nothing
            // here — separating them stops "spend" reading as higher
            // than it was.
            const ownKeyCalls = rows.filter(r => r.usedOwnKey).length;

            return ok({
                sinceIso: since.toISOString(),
                days: window,
                totalCredits: total,
                totalUsd: Number((total * 0.0001).toFixed(4)),
                calls: rows.length,
                callsOnOwnKey: ownKeyCalls,
                byCause: sum(r => r.cause as any),
                byModel: sum(r => `${r.provider}/${r.model}` as any),
                byAgent: sum(r => (r.agent?.name || 'no agent') as any),
            });
        },
    );

    reg(
        'get_topup_link',
        'Returns a link the user opens to buy more credits. Does NOT charge anything — buying happens on the page, where the person can see the amount before paying. Use this when the workspace is low on credits or the user asks to buy some.',
        {
            amountUsd: z.number().min(5).max(10000).optional()
                .describe('Preselect an amount in USD. Minimum 5. Omit to let the user choose.'),
        },
        async ({ amountUsd }) => {
            const url = amountUsd
                ? `${baseUrl()}/dashboard/billing?topup=${Math.round(amountUsd)}`
                : `${baseUrl()}/dashboard/billing?topup=1`;
            return ok({
                url,
                minimumUsd: 5,
                note: 'Open this link to complete the purchase. Nothing has been charged.',
            });
        },
    );

    reg(
        'get_plan_checkout_link',
        'Returns a link the user opens to subscribe to a plan. Does NOT charge anything. Use after list_plans when the user picks one.',
        {
            planId: z.string().min(1).describe('Plan id from list_plans.'),
        },
        async ({ planId }) => {
            const plan = await prisma.plan.findUnique({ where: { id: planId } });
            if (!plan) return fail('Plan not found.');
            if (!plan.isActive) return fail(`Plan "${plan.name}" is not available.`);
            return ok({
                url: `${baseUrl()}/dashboard/billing?plan=${plan.id}`,
                plan: { id: plan.id, name: plan.name, price: plan.price, currency: plan.currency, interval: plan.interval },
                note: 'Open this link to complete the subscription. Nothing has been charged.',
            });
        },
    );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CreditCard, Loader2, Check, ExternalLink, Coins, ArrowUpRight } from "lucide-react";
import api from "@/lib/api";
import { useSearchParams } from "next/navigation";

type Plan = {
    id: string; name: string; description?: string;
    price: number; currency: string; interval: string;
    maxAgents: number; maxWhatsappAccounts: number; maxInstagramAccounts: number;
    maxAutomations: number; monthlyMessageLimit: number;
    monthlyCredits?: number;
    allowCustomApiKeys?: boolean;
    copilotEnabled?: boolean;
    copilotVoiceEnabled?: boolean;
};

type Current = {
    plan: Plan | null;
    subscription: { status: string; endsAt: string | null };
    usage: { agents: number; whatsapp: number; instagram: number; automations: number };
};

type TopUpOptions = {
    minimumUsd: number;
    maximumUsd: number;
    creditsPerUsd: number;
    presets: { usd: number; credits: number }[];
    purchases: {
        id: string; amountUsd: number; credits: number; source: string;
        status: string; paidAt: string | null; createdAt: string;
        user?: { name?: string | null; email: string } | null;
    }[];
};

type LiderStatus = {
    available: boolean;
    connected: boolean;
    liderUserId: string | null;
    liderEmail: string | null;
    connectedAt: string | null;
};

type Balance = {
    monthlyCredits: number;
    topUp: number;
    totalBudget: number;
    used: number;
    remaining: number;
    periodResetAt: string | null;
};


export default function BillingPage() {
    const searchParams = useSearchParams();
    const [current, setCurrent] = useState<Current | null>(null);
    const [plans, setPlans] = useState<Plan[]>([]);
    const [balance, setBalance] = useState<Balance | null>(null);
    const [loading, setLoading] = useState(true);
    const [subscribing, setSubscribing] = useState<string | null>(null);
    const [managing, setManaging] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [topup, setTopup] = useState<TopUpOptions | null>(null);
    const [topupAmount, setTopupAmount] = useState<string>("10");
    const [buying, setBuying] = useState(false);
    const [lider, setLider] = useState<LiderStatus | null>(null);
    const [linking, setLinking] = useState(false);

    const subscribe = async (planId: string) => {
        setSubscribing(planId);
        setActionError(null);
        try {
            const res = await api.post('/billing/checkout', { planId });
            if (res.data.success && res.data.url) window.location.href = res.data.url;
            else setActionError(res.data.message || 'Failed to start checkout');
        } catch (err: any) {
            setActionError(err.response?.data?.message || err.message);
        } finally { setSubscribing(null); }
    };

    const buyCredits = async () => {
        const amountUsd = Number(topupAmount);
        setBuying(true);
        setActionError(null);
        try {
            const res = await api.post('/billing/topup', { amountUsd });
            if (res.data.success && res.data.url) window.location.href = res.data.url;
            else setActionError(res.data.message || 'Could not start the purchase');
        } catch (err: any) {
            setActionError(err.response?.data?.message || err.message);
        } finally { setBuying(false); }
    };

    const connectLider = async () => {
        setLinking(true);
        setActionError(null);
        try {
            const res = await api.post('/lider/connect', {});
            if (res.data.success && res.data.url) window.location.href = res.data.url;
            else setActionError(res.data.message || 'Could not start the connection');
        } catch (err: any) {
            setActionError(err.response?.data?.message || err.message);
        } finally { setLinking(false); }
    };

    const disconnectLider = async () => {
        if (!confirm('Disconnect your Lider account? You can reconnect at any time; nothing already bought is affected.')) return;
        try {
            await api.delete('/lider/connect');
            await load();
        } catch (err: any) {
            setActionError(err.response?.data?.message || err.message);
        }
    };

    const manageSubscription = async () => {
        setManaging(true);
        setActionError(null);
        try {
            const res = await api.post('/billing/portal', {});
            if (res.data.success && res.data.url) window.location.href = res.data.url;
            else setActionError(res.data.message || 'Failed to open billing portal');
        } catch (err: any) {
            setActionError(err.response?.data?.message || err.message);
        } finally { setManaging(false); }
    };

    const load = async () => {
        try {
            const [me, pub, bal, top, lid] = await Promise.all([
                api.get('/plans/me'),
                api.get('/plans/public'),
                api.get('/credits/balance').catch(() => null),
                api.get('/billing/topup').catch(() => null),
                api.get('/lider/status').catch(() => null),
            ]);
            if (me.data.success) setCurrent({ plan: me.data.plan, subscription: me.data.subscription, usage: me.data.usage });
            if (pub.data.success) setPlans(pub.data.plans);
            if (bal?.data?.success) setBalance(bal.data.balance);
            if (top?.data?.success) setTopup(top.data);
            if (lid?.data?.success) setLider(lid.data);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };
    useEffect(() => {
        load();
        // Same auto-refresh treatment as the Usage page — 15s poll plus
        // an on-focus refresh so the "credits remaining" card stays live
        // while the user chats with the copilot in another tab.
        const timer = setInterval(() => {
            api.get('/credits/balance').then(r => {
                if (r.data.success) setBalance(r.data.balance);
            }).catch(() => {});
        }, 15_000);
        const onFocus = () => {
            api.get('/credits/balance').then(r => {
                if (r.data.success) setBalance(r.data.balance);
            }).catch(() => {});
        };
        window.addEventListener('focus', onFocus);
        return () => {
            clearInterval(timer);
            window.removeEventListener('focus', onFocus);
        };
    }, []);

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    const fmt = (n: number) => n < 0 ? '∞' : n.toString();
    const usage = current?.usage;
    const used = (n: number, limit: number) => limit < 0 ? `${n}` : `${n} / ${limit}`;

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-3">
                    <div className="p-2 bg-primary/10 text-primary rounded-xl"><CreditCard className="w-6 h-6" /></div>
                    Billing
                </h1>
                <p className="text-sm text-muted-foreground mt-1">Your subscription and available plans.</p>
            </div>

            {searchParams.get('status') === 'success' && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl px-4 py-3 text-sm">
                    Subscription started — it can take a few seconds for the new plan to appear here.
                </div>
            )}
            {searchParams.get('status') === 'cancel' && (
                <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl px-4 py-3 text-sm">
                    Checkout cancelled. You can try again any time.
                </div>
            )}
            {actionError && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm">{actionError}</div>
            )}

            {/* Current plan */}
            <div className="bg-card border border-border rounded-2xl p-5">
                <h2 className="font-semibold mb-3">Current plan</h2>
                {current?.plan ? (
                    <div className="space-y-3">
                        <div className="flex items-baseline gap-2">
                            <span className="text-xl font-bold">{current.plan.name}</span>
                            <span className="text-muted-foreground">{current.plan.price} {current.plan.currency}/{current.plan.interval}</span>
                            <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${current.subscription.status === 'active' || current.subscription.status === 'trialing' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-secondary text-muted-foreground'}`}>
                                {current.subscription.status}
                            </span>
                        </div>
                        {balance && (
                            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-amber-500/15 text-amber-400"><Coins className="w-5 h-5" /></div>
                                    <div>
                                        <div className="text-xs text-muted-foreground">Credits remaining this period</div>
                                        <div className="text-xl font-bold">
                                            {balance.remaining.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">/ {balance.totalBudget.toLocaleString()}</span>
                                        </div>
                                        {balance.periodResetAt && (
                                            <div className="text-[11px] text-muted-foreground">Resets on {new Date(balance.periodResetAt).toLocaleDateString()}</div>
                                        )}
                                    </div>
                                </div>
                                <Link href="/dashboard/usage"
                                    className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                                    View usage <ArrowUpRight className="w-3 h-3" />
                                </Link>
                            </div>
                        )}

                        {lider?.available && (
                            <LiderCard
                                status={lider}
                                linking={linking}
                                onConnect={connectLider}
                                onDisconnect={disconnectLider}
                            />
                        )}

                        {topup && (
                            <TopUpCard
                                options={topup}
                                amount={topupAmount}
                                onAmount={setTopupAmount}
                                buying={buying}
                                onBuy={buyCredits}
                            />
                        )}
                        {usage && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                                <div className="bg-secondary/30 rounded-xl p-3"><div className="text-xs text-muted-foreground">AI agents</div><div className="font-semibold">{used(usage.agents, current.plan.maxAgents)}</div></div>
                                <div className="bg-secondary/30 rounded-xl p-3"><div className="text-xs text-muted-foreground">WhatsApp</div><div className="font-semibold">{used(usage.whatsapp, current.plan.maxWhatsappAccounts)}</div></div>
                                <div className="bg-secondary/30 rounded-xl p-3"><div className="text-xs text-muted-foreground">Instagram</div><div className="font-semibold">{used(usage.instagram, current.plan.maxInstagramAccounts)}</div></div>
                                <div className="bg-secondary/30 rounded-xl p-3"><div className="text-xs text-muted-foreground">Automations</div><div className="font-semibold">{used(usage.automations, current.plan.maxAutomations)}</div></div>
                            </div>
                        )}
                        <div className="pt-2">
                            <button onClick={manageSubscription} disabled={managing}
                                className="bg-secondary/50 border border-border hover:bg-secondary text-foreground rounded-xl px-4 py-2 text-sm font-medium flex items-center gap-2 transition-all disabled:opacity-60">
                                {managing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                                Manage subscription
                            </button>
                        </div>
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">You don't have a plan yet — all features are available without limits.</p>
                )}
            </div>

            {/* Available plans */}
            <div>
                <h2 className="font-semibold mb-3">Available plans</h2>
                {plans.length === 0 ? (
                    <div className="bg-card border border-dashed border-border rounded-2xl p-8 text-center text-sm text-muted-foreground">No plans published yet.</div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {plans.map(p => {
                            const isCurrent = current?.plan?.id === p.id;
                            return (
                                <div key={p.id} className={`bg-card border rounded-2xl p-5 space-y-3 ${isCurrent ? 'border-primary' : 'border-border'}`}>
                                    <div className="flex items-center justify-between">
                                        <h3 className="font-semibold">{p.name}</h3>
                                        {isCurrent && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Current</span>}
                                    </div>
                                    <div className="text-2xl font-bold">{p.price} <span className="text-sm font-normal text-muted-foreground">{p.currency}/{p.interval}</span></div>
                                    {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                                    <ul className="text-xs space-y-1.5">
                                        <li className="flex items-center gap-2">
                                            <Coins className="w-3.5 h-3.5 text-amber-400" />
                                            <span className="font-semibold">{(p.monthlyCredits || 0).toLocaleString()} credits / month</span>
                                        </li>
                                        <li className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-400" /> {fmt(p.maxAgents)} AI agents</li>
                                        <li className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-400" /> {fmt(p.maxWhatsappAccounts)} WhatsApp accounts</li>
                                        <li className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-400" /> {fmt(p.maxInstagramAccounts)} Instagram accounts</li>
                                        <li className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-400" /> {fmt(p.maxAutomations)} automations</li>
                                        <li className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-400" /> {fmt(p.monthlyMessageLimit)} messages/month</li>
                                        {p.copilotEnabled && (
                                            <li className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-400" /> In-app copilot{p.copilotVoiceEnabled && <span className="text-muted-foreground">· voice</span>}</li>
                                        )}
                                        {p.allowCustomApiKeys && (
                                            <li className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-400" /> Bring your own API keys</li>
                                        )}
                                    </ul>
                                    <button
                                        onClick={() => !isCurrent && subscribe(p.id)}
                                        disabled={isCurrent || subscribing === p.id}
                                        className={`w-full rounded-xl px-4 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-60 ${isCurrent ? 'bg-secondary/50 border border-border text-muted-foreground cursor-not-allowed' : 'bg-primary hover:bg-primary/90 text-primary-foreground'}`}>
                                        {subscribing === p.id && <Loader2 className="w-4 h-4 animate-spin" />}
                                        {isCurrent ? 'Active' : (subscribing === p.id ? 'Redirecting…' : 'Subscribe')}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

// Credits run out mid-month, and "wait for the reset" is not an answer
// at 2am. The amount is free-form rather than fixed packages, because
// people top up to cover a specific shortfall, not to buy a tier.
function TopUpCard({ options, amount, onAmount, buying, onBuy }: {
    options: TopUpOptions;
    amount: string;
    onAmount: (v: string) => void;
    buying: boolean;
    onBuy: () => void;
}) {
    const value = Number(amount);
    const valid = Number.isFinite(value) && value >= options.minimumUsd && value <= options.maximumUsd;
    const credits = valid ? Math.round(value * options.creditsPerUsd) : 0;
    const paid = options.purchases.filter(p => p.status === 'paid');

    return (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div>
                <h3 className="font-semibold text-sm">Buy credits</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                    Added to your balance as soon as the payment clears, and they don&apos;t expire at the end of the
                    month — a top-up carries over.
                </p>
            </div>

            <div className="flex flex-wrap gap-1.5">
                {options.presets.map(p => (
                    <button key={p.usd} onClick={() => onAmount(String(p.usd))}
                        className={`text-xs font-medium rounded-lg px-3 py-1.5 border transition-all ${
                            Number(amount) === p.usd
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-secondary/40 border-border hover:bg-secondary'
                        }`}>
                        ${p.usd}
                    </button>
                ))}
            </div>

            <div className="flex flex-wrap items-end gap-2">
                <div>
                    <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Amount (USD)</label>
                    <div className="relative mt-1">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                        <input type="number" min={options.minimumUsd} max={options.maximumUsd} step="1"
                            value={amount} onChange={e => onAmount(e.target.value)}
                            className="w-32 bg-secondary/50 border border-border rounded-lg pl-6 pr-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
                    </div>
                </div>
                <div className="text-xs text-muted-foreground pb-2">
                    {valid
                        ? <>= <span className="text-amber-400 font-semibold">{credits.toLocaleString()}</span> credits</>
                        : <span className="text-amber-400">Minimum ${options.minimumUsd}</span>}
                </div>
                <button onClick={onBuy} disabled={!valid || buying}
                    className="ml-auto bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50">
                    {buying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Coins className="w-4 h-4" />}
                    Buy credits
                </button>
            </div>

            {paid.length > 0 && (
                <div className="pt-2 border-t border-border">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Past purchases</div>
                    <div className="space-y-1">
                        {paid.slice(0, 5).map(p => (
                            <div key={p.id} className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">
                                    {new Date(p.paidAt || p.createdAt).toLocaleDateString()}
                                    {p.source !== 'stripe' && <span className="ml-1.5 opacity-60">via {p.source}</span>}
                                </span>
                                <span className="font-mono">
                                    ${p.amountUsd.toFixed(2)} → <span className="text-amber-400">{p.credits.toLocaleString()}</span>
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// Paying from a Lider balance. The purchase itself happens on Lider —
// it holds the money and decides what the customer can afford — so this
// card only reports whether the two accounts are linked and sends them
// there. Hidden entirely until an admin has configured the integration,
// because a Connect button that leads nowhere is worse than no button.
function LiderCard({ status, linking, onConnect, onDisconnect }: {
    status: LiderStatus;
    linking: boolean;
    onConnect: () => void;
    onDisconnect: () => void;
}) {
    if (status.connected) {
        return (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <div className="text-sm font-medium text-emerald-300 flex items-center gap-1.5">
                        <Check className="w-4 h-4" /> Lider account connected
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                        You can buy a plan or credits from your Lider balance. Purchases show up here within seconds.
                        {status.liderEmail && <> Linked to <span className="font-mono text-foreground/80">{status.liderEmail}</span>.</>}
                    </p>
                </div>
                <button onClick={onDisconnect}
                    className="text-xs text-muted-foreground hover:text-red-400 whitespace-nowrap">
                    Disconnect
                </button>
            </div>
        );
    }

    return (
        <div className="bg-card border border-border rounded-xl p-4 flex items-start justify-between gap-3 flex-wrap">
            <div>
                <div className="text-sm font-medium">Pay with your Lider balance</div>
                <p className="text-xs text-muted-foreground mt-1">
                    Connect your Lider account and buy plans or credits from the balance you already hold there —
                    no card needed.
                </p>
            </div>
            <button onClick={onConnect} disabled={linking}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50">
                {linking ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                Connect Lider
            </button>
        </div>
    );
}

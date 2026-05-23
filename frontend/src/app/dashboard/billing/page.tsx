"use client";

import { useEffect, useState } from "react";
import { CreditCard, Loader2, Check, ExternalLink } from "lucide-react";
import api from "@/lib/api";
import { useSearchParams } from "next/navigation";

type Plan = {
    id: string; name: string; description?: string;
    price: number; currency: string; interval: string;
    maxAgents: number; maxWhatsappAccounts: number; maxInstagramAccounts: number;
    maxAutomations: number; monthlyMessageLimit: number;
};

type Current = {
    plan: Plan | null;
    subscription: { status: string; endsAt: string | null };
    usage: { agents: number; whatsapp: number; instagram: number; automations: number };
};

export default function BillingPage() {
    const searchParams = useSearchParams();
    const [current, setCurrent] = useState<Current | null>(null);
    const [plans, setPlans] = useState<Plan[]>([]);
    const [loading, setLoading] = useState(true);
    const [subscribing, setSubscribing] = useState<string | null>(null);
    const [managing, setManaging] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);

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
            const [me, pub] = await Promise.all([api.get('/plans/me'), api.get('/plans/public')]);
            if (me.data.success) setCurrent({ plan: me.data.plan, subscription: me.data.subscription, usage: me.data.usage });
            if (pub.data.success) setPlans(pub.data.plans);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

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
                                        <li className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-400" /> {fmt(p.maxAgents)} AI agents</li>
                                        <li className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-400" /> {fmt(p.maxWhatsappAccounts)} WhatsApp accounts</li>
                                        <li className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-400" /> {fmt(p.maxInstagramAccounts)} Instagram accounts</li>
                                        <li className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-400" /> {fmt(p.maxAutomations)} automations</li>
                                        <li className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-400" /> {fmt(p.monthlyMessageLimit)} messages/month</li>
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

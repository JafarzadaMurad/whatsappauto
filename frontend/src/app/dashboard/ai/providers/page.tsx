"use client";

// AI Providers connection screen.
//
// Two flavours based on the workspace's current plan:
//   - allowCustomApiKeys=false  → BYOK entirely disabled. Show an
//     upgrade CTA listing every plan that unlocks it and hide the
//     key inputs so the user can't paste a key that would be
//     ignored server-side.
//   - allowCustomApiKeys=true   → the classic per-provider form,
//     with a "Use my key" toggle that switches billing off cai.

import { useEffect, useState } from "react";
import { Key, Loader2, Save, Trash2, CheckCircle2, Zap, Coins, Lock, ArrowUpRight, Sparkles } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";

type ProviderType = 'OPENAI' | 'CLAUDE' | 'GEMINI' | 'GLM';

interface Provider {
    id?: string;
    provider: ProviderType;
    apiKey: string;
    useOwnKey?: boolean;
    isSaved?: boolean;
}

type PlanSummary = {
    id: string;
    name: string;
    price: number;
    currency: string;
    interval: string;
    allowCustomApiKeys?: boolean;
};

const PROVIDER_LABELS: Record<ProviderType, string> = {
    OPENAI: 'OpenAI',
    CLAUDE: 'Anthropic (Claude)',
    GEMINI: 'Google Gemini',
    GLM: 'Z.ai (GLM)',
};

export default function AiProvidersPage() {
    const [providers, setProviders] = useState<Provider[]>([
        { provider: 'OPENAI', apiKey: '', useOwnKey: false },
        { provider: 'CLAUDE', apiKey: '', useOwnKey: false },
        { provider: 'GEMINI', apiKey: '', useOwnKey: false },
        { provider: 'GLM', apiKey: '', useOwnKey: false },
    ]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<ProviderType | null>(null);
    const [allowOwn, setAllowOwn] = useState<boolean>(false);
    const [byokPlans, setByokPlans] = useState<PlanSummary[]>([]);

    useEffect(() => {
        (async () => {
            try {
                const [providersRes, balanceRes, plansRes] = await Promise.all([
                    api.get('/ai-providers'),
                    api.get('/credits/balance').catch(() => null),
                    api.get('/plans').catch(() => null),
                ]);
                if (providersRes.data.success) {
                    const savedList = providersRes.data.providers;
                    setProviders(prev => prev.map(p => {
                        const saved = savedList.find((s: any) => s.provider === p.provider);
                        if (saved) {
                            return { ...p, id: saved.id, apiKey: saved.apiKey, useOwnKey: !!saved.useOwnKey, isSaved: true };
                        }
                        return p;
                    }));
                }
                if (balanceRes?.data?.success) setAllowOwn(!!balanceRes.data.balance?.allowCustomApiKeys);
                if (plansRes?.data?.success) {
                    const plans: PlanSummary[] = (plansRes.data.plans || [])
                        .filter((p: any) => p.allowCustomApiKeys && p.price > 0)
                        .sort((a: PlanSummary, b: PlanSummary) => a.price - b.price);
                    setByokPlans(plans);
                }
            } catch (err) {
                console.error("Failed to load AI providers", err);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const handleSave = async (provider: ProviderType, apiKey: string, useOwnKey: boolean) => {
        if (!apiKey) return;
        setSaving(provider);
        try {
            await api.post('/ai-providers', { provider, apiKey, useOwnKey });
            setProviders(prev => prev.map(p => p.provider === provider ? { ...p, apiKey, useOwnKey, isSaved: true } : p));
        } catch (err: any) {
            console.error("Failed to save provider", err);
            alert(err.response?.data?.message || "Error saving API key");
        } finally {
            setSaving(null);
        }
    };

    const handleDelete = async (id: string, provider: ProviderType) => {
        if (!confirm(`Are you sure you want to remove the API key for ${provider}?`)) return;
        setSaving(provider);
        try {
            await api.delete(`/ai-providers/${id}`);
            setProviders(prev => prev.map(p => p.provider === provider ? { provider: p.provider, apiKey: '', isSaved: false } : p));
        } catch (err) {
            console.error("Failed to delete provider", err);
        } finally {
            setSaving(null);
        }
    };

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto flex h-64 items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    // ── Plan does not allow BYOK — show upgrade CTA instead of the form ──
    if (!allowOwn) {
        return (
            <div className="max-w-3xl mx-auto space-y-6">
                <div>
                    <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
                        AI Providers
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Your workspace uses platform-shared API keys. Every AI call is billed against your credit balance —
                        see <Link href="/dashboard/usage" className="text-primary hover:underline">Usage</Link>.
                    </p>
                </div>

                <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/30 rounded-2xl p-8 text-center space-y-4">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/15 text-primary mx-auto">
                        <Lock className="w-7 h-7" />
                    </div>
                    <div>
                        <h2 className="text-xl font-semibold">Bring your own API keys</h2>
                        <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">
                            Connect your own Anthropic, OpenAI, Google or Z.ai key and calls made through it won't
                            consume any credits — they're billed directly to your provider account.
                        </p>
                    </div>

                    {byokPlans.length > 0 ? (
                        <div className="pt-2">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
                                Available on
                            </p>
                            <div className="flex flex-wrap gap-2 justify-center">
                                {byokPlans.map(plan => (
                                    <div key={plan.id}
                                        className="inline-flex items-center gap-2 bg-card border border-border rounded-xl px-4 py-2 text-sm">
                                        <Sparkles className="w-4 h-4 text-primary" />
                                        <span className="font-semibold">{plan.name}</span>
                                        <span className="text-muted-foreground">
                                            {plan.price} {plan.currency}/{plan.interval}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <p className="text-xs text-muted-foreground pt-2">
                            No plans with this feature are currently offered — please contact support.
                        </p>
                    )}

                    <Link href="/dashboard/billing"
                        className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-5 py-2.5 text-sm transition-all mt-3">
                        Upgrade plan <ArrowUpRight className="w-4 h-4" />
                    </Link>
                </div>

                <div className="bg-card border border-border rounded-2xl p-5 text-sm text-muted-foreground space-y-2">
                    <h3 className="font-semibold text-foreground flex items-center gap-2">
                        <Coins className="w-4 h-4 text-primary" /> While on your current plan
                    </h3>
                    <p>
                        Every AI conversation, campaign draft, oversight review and MCP tool call is metered in
                        credits. You can watch the pool draining and see per-source breakdowns on the{' '}
                        <Link href="/dashboard/usage" className="text-primary hover:underline">Usage</Link> page.
                        Your quota resets on your billing anniversary.
                    </p>
                </div>
            </div>
        );
    }

    // ── Plan allows BYOK — show the full connection form ──
    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div>
                <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
                    AI Providers
                </h1>
                <p className="text-muted-foreground mt-1">
                    Connect AI models. Toggle <span className="text-foreground font-medium">Use my key</span> per
                    provider — calls made through your own key bypass the credit meter and are billed directly to
                    your provider account.
                </p>
            </div>

            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-4 flex items-start gap-3 text-sm">
                <Zap className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                    <span className="font-semibold text-emerald-400">Bring-your-own-key is enabled on your plan. </span>
                    <span className="text-muted-foreground">
                        Enter a provider key below and switch on <span className="text-foreground">Use my key</span> —
                        that provider's calls will stop consuming credits.
                    </span>
                </div>
            </div>

            <div className="space-y-6">
                {providers.map((p) => (
                    <div key={p.provider} className="bg-card border border-border p-6 rounded-2xl shadow-sm hover:border-primary/30 transition-colors">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                            <div className="flex items-center gap-3">
                                <div className="p-3 bg-secondary rounded-xl">
                                    <Key className="w-6 h-6 text-primary" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold">{PROVIDER_LABELS[p.provider]}</h2>
                                    <div className="flex items-center gap-2 mt-1">
                                        {p.isSaved ? (
                                            <span className="flex items-center text-xs font-medium text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                                                <CheckCircle2 className="w-3 h-3 mr-1" /> Connected
                                            </span>
                                        ) : (
                                            <span className="text-xs font-medium text-muted-foreground bg-secondary px-2 py-0.5 rounded-full border border-border">
                                                Not Connected
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <input
                                type="text"
                                placeholder={p.isSaved ? "Saved key (masked)" : `Enter ${p.provider} API Key`}
                                value={p.apiKey}
                                onChange={(e) => {
                                    const newVal = e.target.value;
                                    setProviders(prev => prev.map(prov => prov.provider === p.provider ? { ...prov, apiKey: newVal, isSaved: prov.isSaved && newVal.includes('***') } : prov));
                                }}
                                className="flex-1 bg-secondary/50 border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm font-mono"
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleSave(p.provider, p.apiKey, p.useOwnKey || false)}
                                    disabled={saving === p.provider || !p.apiKey || p.apiKey.includes('***')}
                                    className="bg-primary text-primary-foreground px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 hover:bg-primary/90 transition-all active:scale-[0.98] disabled:opacity-50"
                                >
                                    {saving === p.provider ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                                    Save
                                </button>
                                {p.isSaved && p.id && (
                                    <button
                                        onClick={() => handleDelete(p.id!, p.provider)}
                                        disabled={saving === p.provider}
                                        className="p-2.5 text-destructive bg-destructive/5 hover:bg-destructive/15 border border-destructive/20 rounded-xl transition-colors disabled:opacity-50"
                                    >
                                        <Trash2 className="w-5 h-5" />
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="mt-4 flex items-center gap-3">
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" checked={!!p.useOwnKey}
                                    onChange={e => {
                                        const v = e.target.checked;
                                        setProviders(prev => prev.map(prov => prov.provider === p.provider ? { ...prov, useOwnKey: v } : prov));
                                    }}
                                    className="w-4 h-4 accent-primary rounded" />
                                <span>Use my key (bypass credit meter)</span>
                            </label>
                            {p.useOwnKey ? (
                                <span className="text-xs text-emerald-400">BYOK — no credits charged</span>
                            ) : (
                                <span className="text-xs text-muted-foreground">Platform key — credits charged</span>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

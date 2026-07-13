"use client";

import { useEffect, useState } from "react";
import { Key, Loader2, Save, Trash2, CheckCircle2, Zap, Coins } from "lucide-react";
import api from "@/lib/api";

type ProviderType = 'OPENAI' | 'CLAUDE' | 'GEMINI' | 'GLM';

interface Provider {
    id?: string;
    provider: ProviderType;
    apiKey: string;
    useOwnKey?: boolean;
    isSaved?: boolean;
}

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

    useEffect(() => {
        const fetchProviders = async () => {
            try {
                const [providersRes, balanceRes] = await Promise.all([
                    api.get('/ai-providers'),
                    api.get('/credits/balance').catch(() => null),
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
            } catch (err) {
                console.error("Failed to load AI providers", err);
            } finally {
                setLoading(false);
            }
        };

        fetchProviders();
    }, []);

    const handleSave = async (provider: ProviderType, apiKey: string, useOwnKey: boolean) => {
        if (!apiKey) return;
        setSaving(provider);
        try {
            await api.post('/ai-providers', { provider, apiKey, useOwnKey });
            // Update local state to reflect it's saved
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

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div>
                <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
                    AI Providers
                </h1>
                <p className="text-muted-foreground mt-1">Connect AI models. By default all workspaces use platform-shared keys and pay in cai — Pro+ plans can toggle "Use my key" per provider to bypass the meter.</p>
            </div>

            {!loading && (
                <div className={`border rounded-2xl p-4 flex items-start gap-3 text-sm ${allowOwn ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-secondary/30 border-border'}`}>
                    {allowOwn ? (
                        <>
                            <Zap className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                            <div>
                                <span className="font-semibold text-emerald-400">Bring-your-own-key aktivdir. </span>
                                <span className="text-muted-foreground">Aşağıdakı "Use my key" toggle-ini yandırsan, həmin provider üzərindən çağırışlar cai yeməyəcək — birbaşa öz hesabından gedəcək.</span>
                            </div>
                        </>
                    ) : (
                        <>
                            <Coins className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                            <div>
                                <span className="font-semibold">Platform keys aktivdir. </span>
                                <span className="text-muted-foreground">Sənin planın öz açar əlavə etməyə icazə vermir — bütün AI çağırışları platform açarları üzərindən gedir və <a className="text-primary underline" href="/dashboard/usage">cai balansından</a> çıxılır. Pro plana yüksəldib öz açarını qoya bilərsən.</span>
                            </div>
                        </>
                    )}
                </div>
            )}

            {loading ? (
                <div className="flex h-32 items-center justify-center border border-border border-dashed rounded-2xl">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
            ) : (
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
                                <label className={`flex items-center gap-2 text-sm ${allowOwn ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                                    <input type="checkbox" checked={!!p.useOwnKey} disabled={!allowOwn}
                                        onChange={e => {
                                            const v = e.target.checked;
                                            setProviders(prev => prev.map(prov => prov.provider === p.provider ? { ...prov, useOwnKey: v } : prov));
                                        }}
                                        className="w-4 h-4 accent-primary rounded" />
                                    <span>Use my key (bypass cai meter)</span>
                                </label>
                                {p.useOwnKey ? (
                                    <span className="text-xs text-emerald-400">BYOK — cai yemir</span>
                                ) : (
                                    <span className="text-xs text-muted-foreground">Platform key — cai istifadə olunur</span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

"use client";

import { useEffect, useState } from "react";
import { CreditCard, Loader2, Plus, Trash2, Pencil, X, Star } from "lucide-react";
import api from "@/lib/api";

type Plan = {
    id?: string;
    name: string;
    description?: string;
    price: number;
    currency: string;
    interval: "month" | "year";
    maxAgents: number;
    maxWhatsappAccounts: number;
    maxInstagramAccounts: number;
    maxAutomations: number;
    monthlyMessageLimit: number;
    monthlyCredits: number;
    allowCustomApiKeys: boolean;
    overageBehavior: "hard_block" | "top_up";
    isActive: boolean;
    isDefault?: boolean;
    trialDays?: number | null;
    stripePriceId?: string;
    _count?: { users: number };
};

const emptyPlan = (): Plan => ({
    name: "", description: "", price: 0, currency: "USD", interval: "month",
    maxAgents: 1, maxWhatsappAccounts: 1, maxInstagramAccounts: 1, maxAutomations: 1,
    monthlyMessageLimit: 1000,
    monthlyCredits: 10000, allowCustomApiKeys: false, overageBehavior: "hard_block",
    isActive: true, isDefault: false, trialDays: 14, stripePriceId: ""
});

export default function AdminPlansPage() {
    const [plans, setPlans] = useState<Plan[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<Plan | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        try {
            const res = await api.get('/plans');
            if (res.data.success) setPlans(res.data.plans);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const save = async () => {
        if (!editing) return;
        setSaving(true);
        setError(null);
        try {
            const payload = { ...editing };
            delete (payload as any)._count;
            if (editing.id) await api.put(`/plans/${editing.id}`, payload);
            else await api.post('/plans', payload);
            setEditing(null);
            load();
        } catch (err: any) {
            setError(err.response?.data?.message || err.message);
        } finally { setSaving(false); }
    };

    const toggleDefault = async (p: Plan, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!p.id) return;
        if (!p.isDefault && p.price > 0) {
            alert(`"${p.name}" has a price of ${p.price} ${p.currency}. Only free plans (price 0) can be set as default — the default plan is given to new sign-ups automatically.`);
            return;
        }
        try {
            if (p.isDefault) {
                await api.delete(`/plans/${p.id}/default`);
            } else {
                await api.post(`/plans/${p.id}/default`, {});
            }
            load();
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        }
    };

    const remove = async (p: Plan) => {
        if (!p.id || !confirm(`Delete plan "${p.name}"?`)) return;
        try {
            await api.delete(`/plans/${p.id}`);
            load();
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        }
    };

    const num = (label: string, key: keyof Plan, hint?: string) => (
        <div>
            <label className="text-xs font-medium text-muted-foreground">{label}</label>
            <input type="number" value={editing![key] as number}
                onChange={e => setEditing({ ...editing!, [key]: Number(e.target.value) })}
                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
        </div>
    );

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-xl"><CreditCard className="w-6 h-6" /></div>
                        Subscription Plans
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">Create and manage the plans users can subscribe to.</p>
                </div>
                <button onClick={() => { setEditing(emptyPlan()); setError(null); }}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-4 py-2.5 flex items-center gap-2 transition-all">
                    <Plus className="w-5 h-5" /> New Plan
                </button>
            </div>

            {plans.length === 0 ? (
                <div className="bg-card border border-dashed border-border rounded-2xl p-12 text-center text-muted-foreground">
                    No plans yet. Create your first plan.
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {plans.map(p => (
                        <div key={p.id} className={`bg-card border rounded-2xl p-5 space-y-3 ${p.isDefault ? 'border-amber-400/60' : 'border-border'}`}>
                            <div className="flex items-start justify-between">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="font-semibold">{p.name}</h3>
                                        {p.isDefault && (
                                            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-400 border border-amber-400/30">Default</span>
                                        )}
                                    </div>
                                    <div className="text-2xl font-bold mt-1">
                                        {p.price} <span className="text-sm font-normal text-muted-foreground">{p.currency}/{p.interval}</span>
                                    </div>
                                    {p.price === 0 && p.trialDays != null && p.trialDays > 0 && (
                                        <div className="text-xs text-muted-foreground mt-0.5">expires after {p.trialDays} days</div>
                                    )}
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-secondary text-muted-foreground'}`}>
                                        {p.isActive ? 'Active' : 'Hidden'}
                                    </span>
                                    <button
                                        onClick={(e) => toggleDefault(p, e)}
                                        title={p.isDefault ? 'Default plan — click to remove' : (p.price > 0 ? 'Only free plans can be default' : 'Set as default for new sign-ups')}
                                        className={`p-1.5 rounded-lg transition-colors ${p.isDefault ? 'text-amber-400 bg-amber-400/10' : p.price > 0 ? 'text-muted-foreground/40 cursor-not-allowed' : 'text-muted-foreground hover:text-amber-400 hover:bg-amber-400/10'}`}>
                                        <Star className={`w-4 h-4 ${p.isDefault ? 'fill-current' : ''}`} />
                                    </button>
                                </div>
                            </div>
                            {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                            <ul className="text-xs text-muted-foreground space-y-1">
                                <li>Agents: {p.maxAgents < 0 ? '∞' : p.maxAgents}</li>
                                <li>WhatsApp accounts: {p.maxWhatsappAccounts < 0 ? '∞' : p.maxWhatsappAccounts}</li>
                                <li>Instagram accounts: {p.maxInstagramAccounts < 0 ? '∞' : p.maxInstagramAccounts}</li>
                                <li>Automations: {p.maxAutomations < 0 ? '∞' : p.maxAutomations}</li>
                                <li>Messages/month: {p.monthlyMessageLimit < 0 ? '∞' : p.monthlyMessageLimit}</li>
                                <li className="text-primary/80 font-semibold">cai/month: {p.monthlyCredits?.toLocaleString?.() || 0}{p.allowCustomApiKeys && <span className="text-emerald-400 font-normal"> · own-key OK</span>}</li>
                            </ul>
                            <div className="flex items-center justify-between pt-2 border-t border-border">
                                <span className="text-xs text-muted-foreground">{p._count?.users || 0} subscriber(s)</span>
                                <div className="flex gap-1">
                                    <button onClick={() => { setEditing(p); setError(null); }}
                                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors">
                                        <Pencil className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => remove(p)}
                                        className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Editor modal */}
            {editing && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
                    <div className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-border">
                            <h3 className="font-semibold">{editing.id ? 'Edit Plan' : 'New Plan'}</h3>
                            <button onClick={() => setEditing(null)} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-4 space-y-3">
                            {error && <div className="text-xs text-red-400">{error}</div>}
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Name</label>
                                <input type="text" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                                    placeholder="Pro" className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Description</label>
                                <textarea value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} rows={2}
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                {num('Price', 'price')}
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Currency</label>
                                    <input type="text" value={editing.currency} onChange={e => setEditing({ ...editing, currency: e.target.value })}
                                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Interval</label>
                                    <select value={editing.interval} onChange={e => setEditing({ ...editing, interval: e.target.value as any })}
                                        className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                                        <option value="month" className="bg-card">month</option>
                                        <option value="year" className="bg-card">year</option>
                                    </select>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground pt-1">Limits — use <code className="bg-secondary px-1 rounded">-1</code> for unlimited.</p>
                            <div className="grid grid-cols-2 gap-3">
                                {num('Max agents', 'maxAgents')}
                                {num('Max automations', 'maxAutomations')}
                                {num('Max WhatsApp accounts', 'maxWhatsappAccounts')}
                                {num('Max Instagram accounts', 'maxInstagramAccounts')}
                            </div>
                            {num('Monthly message limit', 'monthlyMessageLimit')}
                            <div className="pt-3 mt-3 border-t border-border space-y-3">
                                <p className="text-xs font-semibold text-primary">cai credits</p>
                                {num('Monthly cai', 'monthlyCredits', 'Monthly cai budget. Every AI call is drawn from this pool.')}
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={editing.allowCustomApiKeys}
                                        onChange={e => setEditing({ ...editing, allowCustomApiKeys: e.target.checked })}
                                        className="w-4 h-4 accent-primary rounded" />
                                    <span className="text-sm">Allow bring-your-own API keys</span>
                                    <span className="text-[10px] text-muted-foreground">— Pro+ only</span>
                                </label>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">When cai runs out</label>
                                    <select value={editing.overageBehavior}
                                        onChange={e => setEditing({ ...editing, overageBehavior: e.target.value as any })}
                                        className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                                        <option value="hard_block" className="bg-card">Hard block (return 402)</option>
                                        <option value="top_up" className="bg-card">Allow past zero (admin tops up manually)</option>
                                    </select>
                                </div>
                            </div>
                            {editing.price === 0 && (
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Trial / free period (days, blank = no expiry)</label>
                                    <input type="number" min={0}
                                        value={editing.trialDays ?? ''}
                                        onChange={e => setEditing({ ...editing, trialDays: e.target.value === '' ? null : Number(e.target.value) })}
                                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>
                            )}
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={!!editing.isDefault}
                                    disabled={editing.price > 0}
                                    onChange={e => {
                                        if (e.target.checked && editing.price > 0) {
                                            alert(`Default plan must have price 0. This plan costs ${editing.price} ${editing.currency}.`);
                                            return;
                                        }
                                        setEditing({ ...editing, isDefault: e.target.checked });
                                    }}
                                    className="w-4 h-4 accent-primary rounded disabled:opacity-50" />
                                <span className={`text-sm ${editing.price > 0 ? 'text-muted-foreground' : ''}`}>
                                    Default plan (auto-assigned to new sign-ups)
                                    {editing.price > 0 && <span className="text-xs"> — only free plans</span>}
                                </span>
                            </label>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Stripe Price ID (optional)</label>
                                <input type="text" value={editing.stripePriceId || ''} onChange={e => setEditing({ ...editing, stripePriceId: e.target.value })}
                                    placeholder="price_..." className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" />
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={editing.isActive} onChange={e => setEditing({ ...editing, isActive: e.target.checked })}
                                    className="w-4 h-4 accent-primary rounded" />
                                <span className="text-sm">Active (visible to users)</span>
                            </label>
                        </div>
                        <div className="p-4 border-t border-border flex justify-end gap-2">
                            <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-secondary/50">Cancel</button>
                            <button onClick={save} disabled={saving || !editing.name.trim()}
                                className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-5 py-2 flex items-center gap-2 text-sm transition-all disabled:opacity-60">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Plan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

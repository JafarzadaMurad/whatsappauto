"use client";

// Admin AI Pricing — the table that decides how many credits an LLM call
// costs. Each row's inputCostPer1M / outputCostPer1M is the raw
// provider USD price per 1M tokens (source of truth: the provider's
// pricing page). `marginMultiplier` is applied on top to yield the
// credits charged to workspaces. Editing a row invalidates the in-memory
// cache in the backend so the next LLM completion picks up the new
// numbers within a second, no restart required.

import { useEffect, useState } from "react";
import { Coins, Loader2, Plus, Trash2, Save, X, DollarSign } from "lucide-react";
import api from "@/lib/api";

type Row = {
    id?: string;
    provider: "anthropic" | "openai" | "google";
    model: string;
    inputCostPer1M: number;
    outputCostPer1M: number;
    cachedCostPer1M: number;
    marginMultiplier: number;
    isActive: boolean;
};

const emptyRow = (): Row => ({
    provider: "anthropic", model: "",
    inputCostPer1M: 0, outputCostPer1M: 0, cachedCostPer1M: 0,
    marginMultiplier: 3.0, isActive: true,
});

// 1 credit = $0.0001. Small helper for the preview column.
const previewCredits = (r: Row, tokens: number) => {
    const usd = (tokens / 1_000_000) * r.outputCostPer1M;
    return Math.ceil(usd * r.marginMultiplier * 10_000);
};

export default function AdminAiPricingPage() {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [editing, setEditing] = useState<Row | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        try {
            const res = await api.get('/admin/ai-pricing');
            if (res.data.success) setRows(res.data.rows);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const patch = async (row: Row, patch: Partial<Row>) => {
        if (!row.id) return;
        setSaving(row.id);
        try {
            const res = await api.put(`/admin/ai-pricing/${row.id}`, patch);
            if (res.data.success) {
                setRows(rows.map(r => r.id === row.id ? res.data.row : r));
            }
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        } finally { setSaving(null); }
    };

    const create = async () => {
        if (!editing) return;
        setError(null);
        try {
            const res = await api.post('/admin/ai-pricing', editing);
            if (res.data.success) {
                setRows([...rows, res.data.row]);
                setEditing(null);
            }
        } catch (err: any) {
            setError(err.response?.data?.message || err.message);
        }
    };

    const remove = async (r: Row) => {
        if (!r.id || !confirm(`Delete ${r.provider}/${r.model}?`)) return;
        try {
            await api.delete(`/admin/ai-pricing/${r.id}`);
            setRows(rows.filter(x => x.id !== r.id));
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-xl"><Coins className="w-6 h-6" /></div>
                        AI Pricing
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Real provider $/1M-token cost × margin multiplier = credits charged. Edits go live immediately, no restart needed.
                        <span className="ml-2 text-primary/80">1 credit = $0.0001</span>
                    </p>
                </div>
                <button onClick={() => { setEditing(emptyRow()); setError(null); }}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-4 py-2.5 flex items-center gap-2 transition-all">
                    <Plus className="w-5 h-5" /> Add Model
                </button>
            </div>

            <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-secondary/50 text-xs uppercase text-muted-foreground">
                            <tr>
                                <th className="px-4 py-3 text-left">Provider</th>
                                <th className="px-4 py-3 text-left">Model</th>
                                <th className="px-4 py-3 text-right">Input $/1M</th>
                                <th className="px-4 py-3 text-right">Output $/1M</th>
                                <th className="px-4 py-3 text-right">Cached $/1M</th>
                                <th className="px-4 py-3 text-right">Margin ×</th>
                                <th className="px-4 py-3 text-right">1K out ≈ credits</th>
                                <th className="px-4 py-3 text-center">Active</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => (
                                <tr key={r.id} className="border-t border-border">
                                    <td className="px-4 py-2">
                                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded ${
                                            r.provider === 'anthropic' ? 'bg-amber-500/10 text-amber-400' :
                                            r.provider === 'openai' ? 'bg-emerald-500/10 text-emerald-400' :
                                            'bg-blue-500/10 text-blue-400'
                                        }`}>{r.provider}</span>
                                    </td>
                                    <td className="px-4 py-2 font-mono text-xs">{r.model}</td>
                                    <td className="px-4 py-2 text-right">
                                        <input type="number" step="0.001" value={r.inputCostPer1M}
                                            onChange={e => setRows(rows.map(x => x.id === r.id ? { ...x, inputCostPer1M: Number(e.target.value) } : x))}
                                            onBlur={() => patch(r, { inputCostPer1M: r.inputCostPer1M })}
                                            className="w-24 bg-secondary/30 border border-border rounded px-2 py-1 text-right text-xs font-mono" />
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                        <input type="number" step="0.001" value={r.outputCostPer1M}
                                            onChange={e => setRows(rows.map(x => x.id === r.id ? { ...x, outputCostPer1M: Number(e.target.value) } : x))}
                                            onBlur={() => patch(r, { outputCostPer1M: r.outputCostPer1M })}
                                            className="w-24 bg-secondary/30 border border-border rounded px-2 py-1 text-right text-xs font-mono" />
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                        <input type="number" step="0.001" value={r.cachedCostPer1M}
                                            onChange={e => setRows(rows.map(x => x.id === r.id ? { ...x, cachedCostPer1M: Number(e.target.value) } : x))}
                                            onBlur={() => patch(r, { cachedCostPer1M: r.cachedCostPer1M })}
                                            className="w-24 bg-secondary/30 border border-border rounded px-2 py-1 text-right text-xs font-mono" />
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                        <input type="number" step="0.1" value={r.marginMultiplier}
                                            onChange={e => setRows(rows.map(x => x.id === r.id ? { ...x, marginMultiplier: Number(e.target.value) } : x))}
                                            onBlur={() => patch(r, { marginMultiplier: r.marginMultiplier })}
                                            className="w-20 bg-secondary/30 border border-border rounded px-2 py-1 text-right text-xs font-mono" />
                                    </td>
                                    <td className="px-4 py-2 text-right text-xs text-primary font-mono">{previewCredits(r, 1000)}</td>
                                    <td className="px-4 py-2 text-center">
                                        <input type="checkbox" checked={r.isActive}
                                            onChange={e => patch(r, { isActive: e.target.checked })}
                                            className="w-4 h-4 accent-primary" />
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                        {saving === r.id ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : (
                                            <button onClick={() => remove(r)} className="p-1 rounded text-muted-foreground hover:text-red-400">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {rows.length === 0 && (
                                <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                                    No pricing rows yet. The server will seed defaults on next boot, or add one manually.
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="bg-card border border-border rounded-2xl p-5 text-sm text-muted-foreground">
                <h2 className="font-semibold text-foreground mb-2 flex items-center gap-2"><DollarSign className="w-4 h-4" /> How the credit formula works</h2>
                <div className="space-y-1 text-xs">
                    <p><code className="bg-secondary px-1.5 py-0.5 rounded">cost_usd = (input_tokens × input$/1M + cached_tokens × cached$/1M + output_tokens × output$/1M) / 1,000,000</code></p>
                    <p><code className="bg-secondary px-1.5 py-0.5 rounded">credits_charged = ceil(cost_usd × margin × 10,000)</code></p>
                    <p>1 credit = $0.0001. A 3× margin means we charge 3× the raw provider cost — ~66% margin.</p>
                </div>
            </div>

            {editing && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
                    <div className="bg-card border border-border rounded-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-border">
                            <h3 className="font-semibold">New Model</h3>
                            <button onClick={() => setEditing(null)} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-4 space-y-3">
                            {error && <div className="text-xs text-red-400">{error}</div>}
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Provider</label>
                                <select value={editing.provider} onChange={e => setEditing({ ...editing, provider: e.target.value as any })}
                                    className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm">
                                    <option value="anthropic" className="bg-card">anthropic</option>
                                    <option value="openai" className="bg-card">openai</option>
                                    <option value="google" className="bg-card">google</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Model ID</label>
                                <input type="text" value={editing.model}
                                    onChange={e => setEditing({ ...editing, model: e.target.value })}
                                    placeholder="claude-opus-4-8"
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-mono" />
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Input $/1M</label>
                                    <input type="number" step="0.001" value={editing.inputCostPer1M}
                                        onChange={e => setEditing({ ...editing, inputCostPer1M: Number(e.target.value) })}
                                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-mono" />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Output $/1M</label>
                                    <input type="number" step="0.001" value={editing.outputCostPer1M}
                                        onChange={e => setEditing({ ...editing, outputCostPer1M: Number(e.target.value) })}
                                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-mono" />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Cached $/1M</label>
                                    <input type="number" step="0.001" value={editing.cachedCostPer1M}
                                        onChange={e => setEditing({ ...editing, cachedCostPer1M: Number(e.target.value) })}
                                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-mono" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Margin multiplier</label>
                                <input type="number" step="0.1" value={editing.marginMultiplier}
                                    onChange={e => setEditing({ ...editing, marginMultiplier: Number(e.target.value) })}
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-mono" />
                                <p className="text-[10px] text-muted-foreground mt-0.5">3.0 = charge 3× the raw provider cost</p>
                            </div>
                        </div>
                        <div className="p-4 border-t border-border flex justify-end gap-2">
                            <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-secondary/50">Cancel</button>
                            <button onClick={create} disabled={!editing.model.trim()}
                                className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-5 py-2 flex items-center gap-2 text-sm transition-all disabled:opacity-60">
                                <Save className="w-4 h-4" /> Save Model
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

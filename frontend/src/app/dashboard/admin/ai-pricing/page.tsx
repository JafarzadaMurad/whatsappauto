"use client";

// Admin AI Pricing — the table that decides how many credits an LLM call
// costs. Each row's inputCostPer1M / outputCostPer1M is the raw
// provider USD price per 1M tokens (source of truth: the provider's
// pricing page). `marginMultiplier` is applied on top to yield the
// credits charged to workspaces. Editing a row invalidates the in-memory
// cache in the backend so the next LLM completion picks up the new
// numbers within a second, no restart required.

import { useEffect, useState } from "react";
import { Coins, Loader2, Plus, Trash2, Save, X, DollarSign, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import UnsavedChangesBar from "@/components/UnsavedChangesBar";

// Not every model bills the same way. A chat or speech-to-speech model
// bills per token; a transcriber bills per minute of audio; a TTS voice
// bills per million characters spoken. `kind` says which of the two
// rate shapes below is the live one for that row.
type Kind = "token" | "stt_minute" | "tts_chars";

type Row = {
    id?: string;
    provider: string;
    model: string;
    kind: Kind;
    unitCostUsd: number;
    inputCostPer1M: number;
    outputCostPer1M: number;
    cachedCostPer1M: number;
    marginMultiplier: number;
    isActive: boolean;
};

const KINDS: { value: Kind; label: string; unit: string }[] = [
    { value: "token", label: "Token", unit: "$/1M tokens" },
    { value: "stt_minute", label: "Transcriber", unit: "$ per audio minute" },
    { value: "tts_chars", label: "Voice (TTS)", unit: "$ per 1M characters" },
];

const emptyRow = (): Row => ({
    provider: "anthropic", model: "", kind: "token", unitCostUsd: 0,
    inputCostPer1M: 0, outputCostPer1M: 0, cachedCostPer1M: 0,
    marginMultiplier: 3.0, isActive: true,
});

// 1 credit = $0.0001. The preview column answers "what does one
// representative unit of this model cost a workspace?" — 1K output
// tokens, one minute of audio, or 1K spoken characters.
const previewCredits = (r: Row) => {
    const usd =
        r.kind === "stt_minute" ? r.unitCostUsd :
        r.kind === "tts_chars" ? (1_000 / 1_000_000) * r.unitCostUsd :
        (1_000 / 1_000_000) * r.outputCostPer1M;
    return Math.ceil(usd * r.marginMultiplier * 10_000);
};
const previewLabel = (k: Kind) =>
    k === "stt_minute" ? "1 min" : k === "tts_chars" ? "1K chars" : "1K out";

export default function AdminAiPricingPage() {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<Row | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Editing rates is deliberate work — saving on blur meant a stray
    // keystroke changed what customers are billed with no confirmation
    // and no way back. Edits stay local until saved.
    const [baseline, setBaseline] = useState<Row[]>([]);
    const [savingAll, setSavingAll] = useState(false);
    const changedRows = rows.filter(r => {
        const b = baseline.find(x => x.id === r.id);
        if (!b) return false;
        return b.inputCostPer1M !== r.inputCostPer1M
            || b.outputCostPer1M !== r.outputCostPer1M
            || b.cachedCostPer1M !== r.cachedCostPer1M
            || b.unitCostUsd !== r.unitCostUsd
            || b.marginMultiplier !== r.marginMultiplier
            || b.isActive !== r.isActive;
    });

    // The table now carries the whole voice catalogue on top of the
    // text models, so it needs a way to get to one row quickly.
    const [kindFilter, setKindFilter] = useState<Kind | "all">("all");
    const [search, setSearch] = useState("");
    const visible = rows.filter(r =>
        (kindFilter === "all" || r.kind === kindFilter) &&
        (search.trim() === "" || `${r.provider}/${r.model}`.toLowerCase().includes(search.trim().toLowerCase()))
    );

    const load = async () => {
        try {
            const res = await api.get('/admin/ai-pricing');
            if (res.data.success) { setRows(res.data.rows); setBaseline(res.data.rows); }
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const saveAll = async () => {
        if (changedRows.length === 0) return;
        setSavingAll(true);
        setError(null);
        try {
            for (const r of changedRows) {
                if (!r.id) continue;
                await api.put(`/admin/ai-pricing/${r.id}`, {
                    inputCostPer1M: r.inputCostPer1M,
                    outputCostPer1M: r.outputCostPer1M,
                    cachedCostPer1M: r.cachedCostPer1M,
                    unitCostUsd: r.unitCostUsd,
                    marginMultiplier: r.marginMultiplier,
                    isActive: r.isActive,
                });
            }
            await load();
        } catch (err: any) {
            setError(err.response?.data?.message || err.message);
        } finally { setSavingAll(false); }
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
                        Real provider $/1M-token cost × margin multiplier = credits charged. Edit the rates, then save — changes apply to both billing and the voice pipeline's quoted prices, no restart needed.
                        <span className="ml-2 text-primary/80">1 credit = $0.0001</span>
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={async () => {
                        if (!confirm('Sync every catalog row to the current provider prices? Your margin multipliers and Active toggles are kept — only the raw input/output/cached $ per 1M columns are overwritten.')) return;
                        try {
                            const res = await api.post('/admin/ai-pricing/refresh-from-catalog');
                            if (res.data.success) {
                                alert(`Refreshed. Updated ${res.data.updated}, inserted ${res.data.inserted}, unchanged ${res.data.unchanged}.`);
                                load();
                            }
                        } catch (err: any) {
                            alert(err.response?.data?.message || err.message);
                        }
                    }}
                        className="bg-secondary/70 hover:bg-secondary border border-border rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm font-medium transition-all">
                        <RefreshCw className="w-4 h-4" /> Refresh from catalog
                    </button>
                    <button onClick={() => { setEditing(emptyRow()); setError(null); }}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-4 py-2.5 flex items-center gap-2 transition-all">
                        <Plus className="w-5 h-5" /> Add Model
                    </button>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {([{ value: 'all', label: 'All' }, ...KINDS] as { value: Kind | 'all'; label: string }[]).map(k => (
                    <button key={k.value} onClick={() => setKindFilter(k.value)}
                        className={`text-xs font-medium rounded-lg px-3 py-1.5 border transition-all ${
                            kindFilter === k.value
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-secondary/40 border-border hover:bg-secondary'
                        }`}>
                        {k.label}
                        <span className="ml-1.5 opacity-60">
                            {k.value === 'all' ? rows.length : rows.filter(r => r.kind === k.value).length}
                        </span>
                    </button>
                ))}
                <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search provider or model…"
                    className="ml-auto w-64 bg-secondary/30 border border-border rounded-lg px-3 py-1.5 text-xs" />
            </div>

            <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-secondary/50 text-xs uppercase text-muted-foreground">
                            <tr>
                                <th className="px-4 py-3 text-left">Provider</th>
                                <th className="px-4 py-3 text-left">Model</th>
                                <th className="px-4 py-3 text-left">Bills by</th>
                                <th className="px-4 py-3 text-right">Input $/1M</th>
                                <th className="px-4 py-3 text-right">Output $/1M</th>
                                <th className="px-4 py-3 text-right">Cached $/1M</th>
                                <th className="px-4 py-3 text-right">Unit $</th>
                                <th className="px-4 py-3 text-right">Margin ×</th>
                                <th className="px-4 py-3 text-right">≈ credits</th>
                                <th className="px-4 py-3 text-center">Active</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map(r => (
                                <tr key={r.id} className="border-t border-border">
                                    <td className="px-4 py-2">
                                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded ${
                                            r.provider === 'anthropic' ? 'bg-amber-500/10 text-amber-400' :
                                            r.provider === 'openai' ? 'bg-emerald-500/10 text-emerald-400' :
                                            r.provider === 'google' ? 'bg-blue-500/10 text-blue-400' :
                                            'bg-purple-500/10 text-purple-400'
                                        }`}>{r.provider}</span>
                                    </td>
                                    <td className="px-4 py-2 font-mono text-xs">{r.model}</td>
                                    <td className="px-4 py-2 text-xs text-muted-foreground">
                                        {KINDS.find(k => k.value === r.kind)?.label ?? r.kind}
                                    </td>
                                    {/* Only the columns that actually bill this row are
                                        editable — the rest are dashed out, so nobody
                                        types a token price into a transcriber. */}
                                    {r.kind === 'token' ? (
                                        <>
                                            <td className="px-4 py-2 text-right">
                                                <input type="number" step="0.001" value={r.inputCostPer1M}
                                                    onChange={e => setRows(rows.map(x => x.id === r.id ? { ...x, inputCostPer1M: Number(e.target.value) } : x))}
                                                    className="w-24 bg-secondary/30 border border-border rounded px-2 py-1 text-right text-xs font-mono" />
                                            </td>
                                            <td className="px-4 py-2 text-right">
                                                <input type="number" step="0.001" value={r.outputCostPer1M}
                                                    onChange={e => setRows(rows.map(x => x.id === r.id ? { ...x, outputCostPer1M: Number(e.target.value) } : x))}
                                                    className="w-24 bg-secondary/30 border border-border rounded px-2 py-1 text-right text-xs font-mono" />
                                            </td>
                                            <td className="px-4 py-2 text-right">
                                                <input type="number" step="0.001" value={r.cachedCostPer1M}
                                                    onChange={e => setRows(rows.map(x => x.id === r.id ? { ...x, cachedCostPer1M: Number(e.target.value) } : x))}
                                                    className="w-24 bg-secondary/30 border border-border rounded px-2 py-1 text-right text-xs font-mono" />
                                            </td>
                                            <td className="px-4 py-2 text-right text-xs text-muted-foreground/40">—</td>
                                        </>
                                    ) : (
                                        <>
                                            <td colSpan={3} className="px-4 py-2 text-right text-xs text-muted-foreground/40">—</td>
                                            <td className="px-4 py-2 text-right">
                                                <input type="number" step="0.0001" value={r.unitCostUsd}
                                                    onChange={e => setRows(rows.map(x => x.id === r.id ? { ...x, unitCostUsd: Number(e.target.value) } : x))}
                                                    title={KINDS.find(k => k.value === r.kind)?.unit}
                                                    className="w-24 bg-secondary/30 border border-border rounded px-2 py-1 text-right text-xs font-mono" />
                                            </td>
                                        </>
                                    )}
                                    <td className="px-4 py-2 text-right">
                                        <input type="number" step="0.1" value={r.marginMultiplier}
                                            onChange={e => setRows(rows.map(x => x.id === r.id ? { ...x, marginMultiplier: Number(e.target.value) } : x))}
                                            className="w-20 bg-secondary/30 border border-border rounded px-2 py-1 text-right text-xs font-mono" />
                                    </td>
                                    <td className="px-4 py-2 text-right text-xs text-primary font-mono whitespace-nowrap">
                                        {previewCredits(r)} <span className="text-muted-foreground">/ {previewLabel(r.kind)}</span>
                                    </td>
                                    <td className="px-4 py-2 text-center">
                                        <input type="checkbox" checked={r.isActive}
                                            onChange={e => setRows(rows.map(x => x.id === r.id ? { ...x, isActive: e.target.checked } : x))}
                                            className="w-4 h-4 accent-primary" />
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                        <button onClick={() => remove(r)} className="p-1 rounded text-muted-foreground hover:text-red-400">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {visible.length === 0 && (
                                <tr><td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">
                                    {rows.length === 0
                                        ? 'No pricing rows yet. The server will seed defaults on next boot, or add one manually.'
                                        : 'No rows match this filter.'}
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
                    <p>Transcribers bill <code className="bg-secondary px-1.5 py-0.5 rounded">minutes × unit$</code> and TTS voices bill <code className="bg-secondary px-1.5 py-0.5 rounded">chars / 1M × unit$</code> — same margin, same credit conversion.</p>
                    <p>1 credit = $0.0001. A 3× margin means we charge 3× the raw provider cost — ~66% margin.</p>
                    <p>Every model in the voice catalogue gets a row here automatically on boot — adding a new transcriber, LLM or voice to the catalogue is enough for it to show up.</p>
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
                                <input type="text" value={editing.provider}
                                    onChange={e => setEditing({ ...editing, provider: e.target.value })}
                                    list="ai-pricing-providers"
                                    placeholder="anthropic"
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-mono" />
                                <datalist id="ai-pricing-providers">
                                    {Array.from(new Set(rows.map(r => r.provider))).sort().map(p => <option key={p} value={p} />)}
                                </datalist>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Bills by</label>
                                <select value={editing.kind} onChange={e => setEditing({ ...editing, kind: e.target.value as Kind })}
                                    className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm">
                                    {KINDS.map(k => <option key={k.value} value={k.value} className="bg-card">{k.label} — {k.unit}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Model ID</label>
                                <input type="text" value={editing.model}
                                    onChange={e => setEditing({ ...editing, model: e.target.value })}
                                    placeholder="claude-opus-4-8"
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-mono" />
                            </div>
                            {editing.kind !== 'token' ? (
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">
                                        {KINDS.find(k => k.value === editing.kind)?.unit}
                                    </label>
                                    <input type="number" step="0.0001" value={editing.unitCostUsd}
                                        onChange={e => setEditing({ ...editing, unitCostUsd: Number(e.target.value) })}
                                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-mono" />
                                </div>
                            ) : (
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
                            )}
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

            <UnsavedChangesBar
                dirty={changedRows.length > 0}
                saving={savingAll}
                onSave={saveAll}
                onDiscard={() => setRows(baseline)}
                label={`${changedRows.length} model${changedRows.length === 1 ? '' : 's'} edited`}
            />
        </div>
    );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import {
    Brain, Loader2, Plus, Trash2, Play, CheckCircle2, XCircle, AlertTriangle,
    Activity, Settings, Clock, ChevronDown, ChevronRight, RefreshCw, Sparkles, Info
} from "lucide-react";
import api from "@/lib/api";

type Watch = { agentId: string; agent: { id: string; name: string } };
type Oversight = {
    id: string;
    name: string;
    description: string | null;
    providerId: string;
    provider?: { provider: string };
    model: string;
    systemPrompt: string | null;
    intervalDays: number;
    runHour: number;
    lookbackDays: number;
    isActive: boolean;
    lastRunAt: string | null;
    nextRunAt: string | null;
    watches: Watch[];
    pendingCount?: number;
    unreadCount?: number;
    _count?: { suggestions: number; runs: number };
};

type Suggestion = {
    id: string;
    type: string;
    title: string;
    description: string;
    applicable: boolean;
    status: string;
    payload: any;
    createdAt: string;
    readAt: string | null;
    appliedAt: string | null;
    applyError: string | null;
    oversightAgent: { id: string; name: string };
    targetAgent: { id: string; name: string };
};

type Provider = { id: string; provider: string };
type AgentLite = { id: string; name: string };

const TYPE_BADGES: Record<string, { label: string; cls: string }> = {
    prompt_append: { label: 'Prompt + append', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
    prompt_replace: { label: 'Prompt replace', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
    add_http_tool: { label: 'New HTTP tool', cls: 'bg-blue-500/10 text-blue-300 border-blue-500/30' },
    add_table_row: { label: 'Add table row', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
    enable_skill: { label: 'Enable skill', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
    disable_skill: { label: 'Disable skill', cls: 'bg-orange-500/10 text-orange-300 border-orange-500/30' },
    info_note: { label: 'Insight', cls: 'bg-secondary/40 text-muted-foreground border-border' },
};

export default function OversightPage() {
    const [oversights, setOversights] = useState<Oversight[]>([]);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [statusFilter, setStatusFilter] = useState<'pending' | 'applied' | 'rejected' | 'all'>('pending');
    const [loading, setLoading] = useState(true);
    const [providers, setProviders] = useState<Provider[]>([]);
    const [agents, setAgents] = useState<AgentLite[]>([]);
    const [aiModels, setAiModels] = useState<Record<string, string[]>>({});

    const [editing, setEditing] = useState<Oversight | null>(null);
    const [formOpen, setFormOpen] = useState(false);

    const [expandedSuggestion, setExpandedSuggestion] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [over, sug, prov, ag, mod] = await Promise.all([
                api.get('/oversight'),
                api.get(`/oversight/suggestions?status=${statusFilter}`),
                api.get('/ai-providers'),
                api.get('/agents'),
                api.get('/ai-providers/models').catch(() => ({ data: { success: false } })),
            ]);
            if (over.data?.success) setOversights(over.data.items);
            if (sug.data?.success) setSuggestions(sug.data.items);
            if (prov.data?.success) setProviders(prov.data.providers);
            if (ag.data?.success) setAgents(ag.data.agents);
            if (mod.data?.success) setAiModels(mod.data.models || {});

            // Mark loaded suggestions as read (only matters for unread counter)
            const unreadIds = (sug.data?.items || []).filter((s: Suggestion) => !s.readAt).map((s: Suggestion) => s.id);
            if (unreadIds.length > 0) {
                api.post('/oversight/suggestions/mark-read', { ids: unreadIds }).catch(() => {});
            }
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, [statusFilter]);
    useEffect(() => { load(); }, [load]);

    const openCreate = () => {
        setEditing({
            id: '', name: '', description: '', providerId: '', model: '', systemPrompt: '',
            intervalDays: 3, runHour: 9, lookbackDays: 3, isActive: true, lastRunAt: null, nextRunAt: null,
            watches: [],
        });
        setFormOpen(true);
    };
    const openEdit = (o: Oversight) => { setEditing({ ...o }); setFormOpen(true); };
    const closeForm = () => { setFormOpen(false); setEditing(null); };

    const save = async () => {
        if (!editing) return;
        try {
            const payload = {
                name: editing.name,
                description: editing.description || null,
                providerId: editing.providerId,
                model: editing.model,
                systemPrompt: editing.systemPrompt || null,
                intervalDays: editing.intervalDays,
                runHour: editing.runHour,
                lookbackDays: editing.lookbackDays,
                isActive: editing.isActive,
                watchedAgentIds: editing.watches.map(w => w.agentId),
            };
            const r = editing.id
                ? await api.put(`/oversight/${editing.id}`, payload)
                : await api.post('/oversight', payload);
            if (r.data?.success) { closeForm(); load(); }
            else alert(r.data?.message || 'Save failed');
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        }
    };

    const remove = async (o: Oversight) => {
        if (!confirm(`Delete oversight "${o.name}"?`)) return;
        try { await api.delete(`/oversight/${o.id}`); load(); }
        catch (e: any) { alert(e.response?.data?.message || e.message); }
    };

    const runNow = async (o: Oversight) => {
        setBusy(o.id);
        try {
            const r = await api.post(`/oversight/${o.id}/run`);
            if (r.data?.success) load();
            else alert(r.data?.message || r.data?.error || 'Run failed');
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        } finally { setBusy(null); }
    };

    const approve = async (s: Suggestion) => {
        setBusy(s.id);
        try {
            const r = await api.post(`/oversight/suggestions/${s.id}/approve`);
            if (r.data?.success) load();
            else alert(r.data?.message || 'Apply failed');
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        } finally { setBusy(null); }
    };
    const reject = async (s: Suggestion) => {
        setBusy(s.id);
        try { await api.post(`/oversight/suggestions/${s.id}/reject`); load(); }
        catch (e: any) { alert(e.response?.data?.message || e.message); }
        finally { setBusy(null); }
    };

    const modelsForProvider = (providerId: string) => {
        const p = providers.find(p => p.id === providerId)?.provider;
        if (!p) return [];
        return aiModels[p] || [];
    };

    if (loading) return (
        <div className="flex justify-center items-center h-96">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
    );

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-xl"><Brain className="w-6 h-6" /></div>
                        Oversight
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Meta-agents that review your production agents' conversations on a schedule and propose improvements.
                    </p>
                </div>
                <button onClick={openCreate}
                    className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                    <Plus className="w-4 h-4" /> New oversight
                </button>
            </div>

            {/* Oversight agents */}
            <div className="grid gap-4">
                {oversights.length === 0 ? (
                    <div className="bg-card border border-dashed border-border rounded-2xl p-10 text-center text-muted-foreground">
                        <Brain className="w-8 h-8 mx-auto mb-3 opacity-50" />
                        <p className="text-sm">No oversight agents yet.</p>
                        <p className="text-xs mt-1">Create one to start receiving improvement suggestions.</p>
                    </div>
                ) : oversights.map(o => (
                    <div key={o.id} className="bg-card border border-border rounded-2xl p-4 sm:p-5">
                        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h3 className="font-semibold text-base">{o.name}</h3>
                                    {!o.isActive && (
                                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-secondary/40 text-muted-foreground border border-border">paused</span>
                                    )}
                                    {(o.pendingCount || 0) > 0 && (
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                            {o.pendingCount} pending
                                        </span>
                                    )}
                                </div>
                                {o.description && (
                                    <p className="text-xs text-muted-foreground mt-0.5">{o.description}</p>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5">
                                <button onClick={() => runNow(o)} disabled={busy === o.id}
                                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50">
                                    {busy === o.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                                    Run now
                                </button>
                                <button onClick={() => openEdit(o)}
                                    className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-secondary/40 hover:text-foreground">
                                    <Settings className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => remove(o)}
                                    className="p-1.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            <Info2 label="Model" value={`${o.provider?.provider || '?'} · ${o.model}`} />
                            <Info2 label="Watches" value={`${o.watches.length} agent${o.watches.length === 1 ? '' : 's'}`} />
                            <Info2 label="Schedule" value={`Every ${o.intervalDays}d @ ${String(o.runHour).padStart(2, '0')}:00 UTC`} />
                            <Info2 label="Lookback" value={`Last ${o.lookbackDays} day${o.lookbackDays === 1 ? '' : 's'}`} />
                            <Info2 label="Last run" value={o.lastRunAt ? new Date(o.lastRunAt).toLocaleString() : 'never'} />
                            <Info2 label="Next run" value={o.nextRunAt ? new Date(o.nextRunAt).toLocaleString() : '—'} />
                            <Info2 label="Total runs" value={String(o._count?.runs ?? 0)} />
                            <Info2 label="Suggestions" value={String(o._count?.suggestions ?? 0)} />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                            {o.watches.map(w => (
                                <span key={w.agentId} className="text-[10px] px-2 py-0.5 rounded-md bg-secondary/40 border border-border text-muted-foreground">
                                    🤖 {w.agent.name}
                                </span>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {/* Suggestions */}
            <div className="bg-card border border-border rounded-2xl p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                    <h2 className="font-semibold flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary" /> Suggestions
                    </h2>
                    <div className="flex items-center gap-1.5 text-xs">
                        {(['pending', 'applied', 'rejected', 'all'] as const).map(s => (
                            <button key={s} onClick={() => setStatusFilter(s)}
                                className={`px-2.5 py-1 rounded-lg border transition-colors ${statusFilter === s
                                    ? 'bg-primary/10 border-primary/30 text-foreground'
                                    : 'bg-card border-border text-muted-foreground hover:text-foreground'}`}>
                                {s}
                            </button>
                        ))}
                        <button onClick={load}
                            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground">
                            <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
                {suggestions.length === 0 ? (
                    <div className="text-center text-sm text-muted-foreground py-8">
                        No {statusFilter === 'all' ? '' : statusFilter} suggestions.
                    </div>
                ) : (
                    <div className="space-y-2">
                        {suggestions.map(s => {
                            const exp = expandedSuggestion === s.id;
                            const badge = TYPE_BADGES[s.type] || TYPE_BADGES.info_note;
                            const isApplied = s.status === 'applied';
                            const isFailed = s.status === 'apply_failed';
                            const isRejected = s.status === 'rejected';
                            return (
                                <div key={s.id} className={`border rounded-xl overflow-hidden ${isApplied ? 'border-emerald-500/30 bg-emerald-500/5'
                                    : isFailed ? 'border-red-500/30 bg-red-500/5'
                                    : isRejected ? 'border-border bg-secondary/10 opacity-70'
                                    : 'border-border bg-secondary/10'}`}>
                                    <button onClick={() => setExpandedSuggestion(exp ? null : s.id)}
                                        className="w-full p-3 flex items-start gap-3 text-left hover:bg-secondary/30 transition-colors">
                                        {exp ? <ChevronDown className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                                             : <ChevronRight className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />}
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border ${badge.cls}`}>{badge.label}</span>
                                                <span className="text-[11px] text-muted-foreground">→ {s.targetAgent.name}</span>
                                                {isApplied && (
                                                    <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                                        <CheckCircle2 className="w-3 h-3" /> Applied
                                                    </span>
                                                )}
                                                {isFailed && (
                                                    <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-500/15 text-red-300 border border-red-500/30">
                                                        <AlertTriangle className="w-3 h-3" /> Apply failed
                                                    </span>
                                                )}
                                                {isRejected && (
                                                    <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-secondary/40 text-muted-foreground border border-border">
                                                        Rejected
                                                    </span>
                                                )}
                                                {!s.applicable && s.status === 'pending' && (
                                                    <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-300 border border-blue-500/30">
                                                        <Info className="w-3 h-3" /> Info only
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-sm font-medium">{s.title}</div>
                                            <div className="text-xs text-muted-foreground mt-0.5">
                                                {s.oversightAgent.name} · {new Date(s.createdAt).toLocaleString()}
                                            </div>
                                        </div>
                                    </button>
                                    {exp && (
                                        <div className="border-t border-border p-4 space-y-3">
                                            <p className="text-sm whitespace-pre-wrap">{s.description}</p>
                                            {s.applyError && (
                                                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 text-xs text-red-300">
                                                    <strong>Apply error:</strong> {s.applyError}
                                                </div>
                                            )}
                                            {s.payload && (
                                                <details className="bg-background/50 border border-border rounded-lg">
                                                    <summary className="px-3 py-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                                                        Payload (technical)
                                                    </summary>
                                                    <pre className="p-3 text-[11px] overflow-auto max-h-64 whitespace-pre-wrap break-all">
{JSON.stringify(s.payload, null, 2)}
                                                    </pre>
                                                </details>
                                            )}
                                            {s.status === 'pending' && (
                                                <div className="flex gap-2 justify-end">
                                                    <button onClick={() => reject(s)} disabled={busy === s.id}
                                                        className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-secondary/40 hover:text-foreground disabled:opacity-50">
                                                        Reject
                                                    </button>
                                                    {s.applicable && (
                                                        <button onClick={() => approve(s)} disabled={busy === s.id}
                                                            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-500/90 disabled:opacity-50">
                                                            {busy === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                                            Approve + apply
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Form modal */}
            {formOpen && editing && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={closeForm}>
                    <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
                        onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-border flex items-center justify-between">
                            <h2 className="font-semibold">{editing.id ? 'Edit oversight' : 'New oversight agent'}</h2>
                            <button onClick={closeForm} className="text-muted-foreground hover:text-foreground">
                                <XCircle className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <Field label="Name">
                                <input type="text" value={editing.name}
                                    onChange={e => setEditing({ ...editing!, name: e.target.value })}
                                    placeholder="Daily quality watcher"
                                    className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                            </Field>
                            <Field label="Description (optional)">
                                <textarea value={editing.description || ''} rows={2}
                                    onChange={e => setEditing({ ...editing!, description: e.target.value })}
                                    className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm resize-none" />
                            </Field>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <Field label="Provider">
                                    <select value={editing.providerId}
                                        onChange={e => setEditing({ ...editing!, providerId: e.target.value, model: '' })}
                                        className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm">
                                        <option value="">Select…</option>
                                        {providers.map(p => <option key={p.id} value={p.id}>{p.provider}</option>)}
                                    </select>
                                </Field>
                                <Field label="Model">
                                    <select value={editing.model}
                                        onChange={e => setEditing({ ...editing!, model: e.target.value })}
                                        disabled={!editing.providerId}
                                        className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm disabled:opacity-50">
                                        <option value="">Select…</option>
                                        {modelsForProvider(editing.providerId).map(m => <option key={m} value={m}>{m}</option>)}
                                        {editing.model && !modelsForProvider(editing.providerId).includes(editing.model) && (
                                            <option value={editing.model}>{editing.model} (legacy)</option>
                                        )}
                                    </select>
                                </Field>
                            </div>
                            <Field label="Watched agents (1+)">
                                <div className="bg-secondary/30 border border-border rounded-lg p-2 space-y-1 max-h-[180px] overflow-y-auto">
                                    {agents.length === 0 ? (
                                        <div className="text-xs text-muted-foreground text-center py-2">No agents yet.</div>
                                    ) : agents.map(a => {
                                        const checked = editing.watches.some(w => w.agentId === a.id);
                                        return (
                                            <label key={a.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-secondary/30 cursor-pointer text-sm">
                                                <input type="checkbox" checked={checked}
                                                    onChange={() => setEditing({
                                                        ...editing!,
                                                        watches: checked
                                                            ? editing.watches.filter(w => w.agentId !== a.id)
                                                            : [...editing.watches, { agentId: a.id, agent: { id: a.id, name: a.name } }],
                                                    })}
                                                    className="accent-primary" />
                                                {a.name}
                                            </label>
                                        );
                                    })}
                                </div>
                            </Field>
                            <div className="grid grid-cols-3 gap-3">
                                <Field label="Every N days">
                                    <input type="number" min={1} max={60} value={editing.intervalDays}
                                        onChange={e => setEditing({ ...editing!, intervalDays: Number(e.target.value) || 1 })}
                                        className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                                </Field>
                                <Field label="At hour (UTC)">
                                    <input type="number" min={0} max={23} value={editing.runHour}
                                        onChange={e => setEditing({ ...editing!, runHour: Number(e.target.value) || 0 })}
                                        className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                                </Field>
                                <Field label="Look back N days">
                                    <input type="number" min={1} max={30} value={editing.lookbackDays}
                                        onChange={e => setEditing({ ...editing!, lookbackDays: Number(e.target.value) || 1 })}
                                        className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                                </Field>
                            </div>
                            <Field label="Custom instructions (optional, appended to the analysis prompt)">
                                <textarea value={editing.systemPrompt || ''} rows={5}
                                    placeholder="e.g. Focus on questions the agent failed to answer."
                                    onChange={e => setEditing({ ...editing!, systemPrompt: e.target.value })}
                                    className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm resize-none" />
                            </Field>
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" checked={editing.isActive}
                                    onChange={e => setEditing({ ...editing!, isActive: e.target.checked })}
                                    className="accent-primary" />
                                Active (the scheduler will run this oversight)
                            </label>
                        </div>
                        <div className="p-5 border-t border-border flex justify-end gap-2">
                            <button onClick={closeForm}
                                className="text-sm px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40">
                                Cancel
                            </button>
                            <button onClick={save}
                                className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
            {children}
        </div>
    );
}
function Info2({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="text-xs mt-0.5 truncate">{value}</div>
        </div>
    );
}

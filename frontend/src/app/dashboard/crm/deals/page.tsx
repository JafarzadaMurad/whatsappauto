"use client";

import { useEffect, useMemo, useState } from "react";
import {
    Briefcase, Loader2, Plus, LayoutGrid, Table as TableIcon, X,
    Search, Trash2, Save, DollarSign, Calendar, User as UserIcon, Tag,
    MessageSquare, Camera, ChevronDown, MoreHorizontal,
} from "lucide-react";
import api from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────
type StageColor = 'slate' | 'blue' | 'violet' | 'amber' | 'emerald' | 'red' | 'pink' | 'cyan' | 'orange' | string;
type Stage = { id: string; name: string; order: number; color: StageColor | null; isWon: boolean; isLost: boolean; probability: number | null };
type Pipeline = {
    id: string; name: string; description: string | null; color: string | null;
    currency: string; isDefault: boolean; order: number;
    stages: Stage[];
    _count?: { deals: number };
};
type ClientSummary = { id: string; phone: string; name: string | null; channel: string | null; profilePicUrl?: string | null; status?: string };
type Deal = {
    id: string; title: string; description: string | null;
    pipelineId: string; stageId: string; clientId: string | null;
    value: string | null; expectedCloseAt: string | null;
    order: number; tags: string[]; assignedUserId: string | null;
    client: ClientSummary | null; stage: { id: string; name: string; color: string | null; isWon: boolean; isLost: boolean };
    createdAt: string; updatedAt: string;
};

const STAGE_TINTS: Record<string, { bg: string; border: string; text: string; ring: string }> = {
    slate:   { bg: 'bg-slate-500/10',   border: 'border-slate-500/40',   text: 'text-slate-300',   ring: 'ring-slate-500/30' },
    blue:    { bg: 'bg-blue-500/10',    border: 'border-blue-500/40',    text: 'text-blue-300',    ring: 'ring-blue-500/30' },
    violet:  { bg: 'bg-violet-500/10',  border: 'border-violet-500/40',  text: 'text-violet-300',  ring: 'ring-violet-500/30' },
    amber:   { bg: 'bg-amber-500/10',   border: 'border-amber-500/40',   text: 'text-amber-300',   ring: 'ring-amber-500/30' },
    emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/40', text: 'text-emerald-300', ring: 'ring-emerald-500/30' },
    red:     { bg: 'bg-red-500/10',     border: 'border-red-500/40',     text: 'text-red-300',     ring: 'ring-red-500/30' },
    pink:    { bg: 'bg-pink-500/10',    border: 'border-pink-500/40',    text: 'text-pink-300',    ring: 'ring-pink-500/30' },
    cyan:    { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/40',    text: 'text-cyan-300',    ring: 'ring-cyan-500/30' },
    orange:  { bg: 'bg-orange-500/10',  border: 'border-orange-500/40',  text: 'text-orange-300',  ring: 'ring-orange-500/30' },
};
const tintFor = (c?: string | null) => STAGE_TINTS[c || 'slate'] || STAGE_TINTS.slate;

const formatMoney = (v: string | number | null | undefined, currency = 'USD') => {
    if (v == null || v === '') return null;
    const num = typeof v === 'string' ? Number(v) : v;
    if (!isFinite(num)) return null;
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(num);
    } catch { return `${num} ${currency}`; }
};

export default function DealsPage() {
    const [loading, setLoading] = useState(true);
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
    const [deals, setDeals] = useState<Deal[]>([]);
    const [view, setView] = useState<'kanban' | 'table'>('kanban');
    const [dealsLoading, setDealsLoading] = useState(false);
    const [newPipelineOpen, setNewPipelineOpen] = useState(false);
    const [newDealOpen, setNewDealOpen] = useState(false);
    const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
    const [query, setQuery] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [dragging, setDragging] = useState<Deal | null>(null);

    const activePipeline = useMemo(() => pipelines.find(p => p.id === activePipelineId) || null, [pipelines, activePipelineId]);

    // Load pipelines on mount
    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const r = await api.get('/crm/pipelines');
                if (r.data?.success) {
                    const list: Pipeline[] = r.data.pipelines;
                    setPipelines(list);
                    const preferred = list.find(p => p.isDefault) || list[0];
                    if (preferred) setActivePipelineId(preferred.id);
                }
            } catch (e: any) { setError(e.response?.data?.message || e.message); }
            finally { setLoading(false); }
        })();
    }, []);

    // Load deals whenever active pipeline changes
    useEffect(() => {
        if (!activePipelineId) return;
        (async () => {
            setDealsLoading(true);
            try {
                const r = await api.get('/crm/deals', { params: { pipelineId: activePipelineId } });
                if (r.data?.success) setDeals(r.data.deals);
            } catch (e: any) { setError(e.response?.data?.message || e.message); }
            finally { setDealsLoading(false); }
        })();
    }, [activePipelineId]);

    // ── Filters ─────────────────────────────────────────────
    const filteredDeals = useMemo(() => {
        if (!query.trim()) return deals;
        const q = query.trim().toLowerCase();
        return deals.filter(d =>
            d.title.toLowerCase().includes(q)
            || (d.description || '').toLowerCase().includes(q)
            || (d.client?.name || '').toLowerCase().includes(q)
            || (d.client?.phone || '').toLowerCase().includes(q)
            || d.tags.some(t => t.toLowerCase().includes(q))
        );
    }, [deals, query]);

    const totals = useMemo(() => {
        let sum = 0;
        for (const d of deals) {
            const v = Number(d.value);
            if (isFinite(v)) sum += v;
        }
        return { count: deals.length, sum };
    }, [deals]);

    // ── Drag & drop between columns ─────────────────────────
    const handleDrop = async (dealId: string, targetStageId: string) => {
        setDragging(null);
        const deal = deals.find(d => d.id === dealId);
        if (!deal || deal.stageId === targetStageId) return;
        // Optimistic update
        const targetOrder = deals.filter(d => d.stageId === targetStageId).length;
        setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stageId: targetStageId, order: targetOrder } : d));
        try {
            const r = await api.patch(`/crm/deals/${dealId}`, { stageId: targetStageId, order: targetOrder });
            if (r.data?.success) {
                const updated = r.data.deal as Deal;
                setDeals(prev => prev.map(d => d.id === updated.id ? updated : d));
            }
        } catch (e: any) {
            setError(e.response?.data?.message || 'Could not move deal');
            // Roll back — refetch
            const r = await api.get('/crm/deals', { params: { pipelineId: activePipelineId } });
            if (r.data?.success) setDeals(r.data.deals);
        }
    };

    // ── New pipeline ────────────────────────────────────────
    const createPipeline = async (name: string, currency: string) => {
        try {
            const r = await api.post('/crm/pipelines', { name, currency });
            if (r.data?.success) {
                const p = r.data.pipeline as Pipeline;
                setPipelines(prev => [...prev, p]);
                setActivePipelineId(p.id);
                setNewPipelineOpen(false);
            }
        } catch (e: any) { setError(e.response?.data?.message || e.message); }
    };

    // ── New deal ────────────────────────────────────────────
    const createDeal = async (payload: any) => {
        try {
            const r = await api.post('/crm/deals', payload);
            if (r.data?.success) {
                setDeals(prev => [...prev, r.data.deal as Deal]);
                setNewDealOpen(false);
            }
        } catch (e: any) { setError(e.response?.data?.message || 'Could not create deal'); }
    };

    // ── Delete deal ────────────────────────────────────────
    const deleteDeal = async (id: string) => {
        if (!confirm('Delete this deal? This cannot be undone.')) return;
        try {
            await api.delete(`/crm/deals/${id}`);
            setDeals(prev => prev.filter(d => d.id !== id));
            setSelectedDeal(null);
        } catch (e: any) { setError(e.response?.data?.message || e.message); }
    };

    // ── Update deal ────────────────────────────────────────
    const updateDeal = async (id: string, patch: any) => {
        try {
            const r = await api.patch(`/crm/deals/${id}`, patch);
            if (r.data?.success) {
                const updated = r.data.deal as Deal;
                setDeals(prev => prev.map(d => d.id === updated.id ? updated : d));
                setSelectedDeal(updated);
            }
        } catch (e: any) { setError(e.response?.data?.message || e.message); }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-96">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
    );

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-xl"><Briefcase className="w-6 h-6" /></div>
                        Deals
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Sales pipelines with drag-and-drop stages. Move customers through your funnel and track revenue in real time.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setNewPipelineOpen(true)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-border hover:bg-secondary/40">
                        <Plus className="w-3.5 h-3.5" /> New pipeline
                    </button>
                    {activePipeline && (
                        <button onClick={() => setNewDealOpen(true)}
                            className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
                            <Plus className="w-4 h-4" /> New deal
                        </button>
                    )}
                </div>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded-lg flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="hover:opacity-70"><X className="w-3.5 h-3.5" /></button>
                </div>
            )}

            {/* Pipeline picker + toolbar */}
            {pipelines.length === 0 ? (
                <EmptyPipelines onCreate={() => setNewPipelineOpen(true)} />
            ) : (
                <>
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            {pipelines.map(p => (
                                <button key={p.id} onClick={() => setActivePipelineId(p.id)}
                                    className={`text-sm font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                                        p.id === activePipelineId
                                            ? 'bg-primary text-primary-foreground border-primary'
                                            : 'bg-card border-border text-muted-foreground hover:text-foreground'
                                    }`}>
                                    {p.name}
                                    {p._count?.deals != null && (
                                        <span className={`ml-1.5 text-[10px] opacity-70`}>{p._count.deals}</span>
                                    )}
                                </button>
                            ))}
                        </div>
                        <div className="flex-1" />
                        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-secondary/50 border border-border w-full md:w-64">
                            <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <input value={query} onChange={e => setQuery(e.target.value)}
                                placeholder="Search deals…"
                                className="flex-1 bg-transparent outline-none text-sm min-w-0" />
                        </div>
                        <div className="inline-flex rounded-lg border border-border overflow-hidden">
                            <button onClick={() => setView('kanban')}
                                className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium ${view === 'kanban' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                                <LayoutGrid className="w-3.5 h-3.5" /> Kanban
                            </button>
                            <button onClick={() => setView('table')}
                                className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium ${view === 'table' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                                <TableIcon className="w-3.5 h-3.5" /> Table
                            </button>
                        </div>
                    </div>

                    {activePipeline && (
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span><strong className="text-foreground">{totals.count}</strong> deal{totals.count === 1 ? '' : 's'}</span>
                            {totals.sum > 0 && (
                                <span>Total: <strong className="text-foreground">{formatMoney(totals.sum, activePipeline.currency)}</strong></span>
                            )}
                        </div>
                    )}

                    {/* Content */}
                    {dealsLoading ? (
                        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                    ) : activePipeline && view === 'kanban' ? (
                        <KanbanBoard
                            pipeline={activePipeline}
                            deals={filteredDeals}
                            onCardClick={setSelectedDeal}
                            onDrop={handleDrop}
                            dragging={dragging}
                            setDragging={setDragging}
                        />
                    ) : activePipeline && view === 'table' ? (
                        <DealsTable
                            pipeline={activePipeline}
                            deals={filteredDeals}
                            onRowClick={setSelectedDeal}
                        />
                    ) : null}
                </>
            )}

            {/* Modals */}
            {newPipelineOpen && (
                <NewPipelineModal onCreate={createPipeline} onClose={() => setNewPipelineOpen(false)} />
            )}
            {newDealOpen && activePipeline && (
                <NewDealModal pipeline={activePipeline} onCreate={createDeal} onClose={() => setNewDealOpen(false)} />
            )}
            {selectedDeal && (
                <DealDrawer
                    deal={selectedDeal}
                    pipeline={pipelines.find(p => p.id === selectedDeal.pipelineId) || activePipeline!}
                    onClose={() => setSelectedDeal(null)}
                    onUpdate={patch => updateDeal(selectedDeal.id, patch)}
                    onDelete={() => deleteDeal(selectedDeal.id)}
                />
            )}
        </div>
    );
}

// ─── Kanban Board ─────────────────────────────────────────────────
function KanbanBoard({ pipeline, deals, onCardClick, onDrop, dragging, setDragging }: {
    pipeline: Pipeline;
    deals: Deal[];
    onCardClick: (deal: Deal) => void;
    onDrop: (dealId: string, targetStageId: string) => void;
    dragging: Deal | null;
    setDragging: (d: Deal | null) => void;
}) {
    return (
        <div className="overflow-x-auto -mx-2 px-2 pb-2">
            <div className="flex gap-3 min-h-[60vh]">
                {pipeline.stages.map(stage => {
                    const tint = tintFor(stage.color);
                    const stageDeals = deals.filter(d => d.stageId === stage.id).sort((a, b) => a.order - b.order);
                    const sum = stageDeals.reduce((acc, d) => acc + (Number(d.value) || 0), 0);
                    return (
                        <div key={stage.id}
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => { e.preventDefault(); if (dragging) onDrop(dragging.id, stage.id); }}
                            className={`w-72 flex-shrink-0 rounded-2xl border ${tint.border} ${tint.bg} flex flex-col ${dragging && dragging.stageId !== stage.id ? `ring-2 ${tint.ring}` : ''}`}>
                            <div className={`px-3 py-2 border-b ${tint.border} flex items-center justify-between gap-2`}>
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className={`w-2 h-2 rounded-full ${tint.bg.replace('/10', '/60')}`} />
                                    <span className={`text-xs font-semibold uppercase tracking-widest ${tint.text} truncate`}>{stage.name}</span>
                                </div>
                                <span className="text-[10px] text-muted-foreground bg-secondary/40 rounded px-1.5 py-0.5">{stageDeals.length}</span>
                            </div>
                            {sum > 0 && (
                                <div className={`px-3 py-1.5 text-[10px] ${tint.text} border-b ${tint.border} bg-black/10`}>
                                    {formatMoney(sum, pipeline.currency)}
                                </div>
                            )}
                            <div className="p-2 space-y-2 flex-1 min-h-[100px]">
                                {stageDeals.map(deal => (
                                    <div key={deal.id}
                                        draggable
                                        onDragStart={() => setDragging(deal)}
                                        onDragEnd={() => setDragging(null)}
                                        onClick={() => onCardClick(deal)}
                                        className={`rounded-xl border border-border bg-card p-3 hover:border-primary/40 cursor-grab active:cursor-grabbing transition-colors ${dragging?.id === deal.id ? 'opacity-40' : ''}`}>
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="text-sm font-medium truncate flex-1">{deal.title}</div>
                                        </div>
                                        {deal.value && (
                                            <div className={`text-xs font-semibold ${tint.text} mt-1`}>{formatMoney(deal.value, pipeline.currency)}</div>
                                        )}
                                        {deal.client && (
                                            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground truncate">
                                                {deal.client.channel === 'instagram' ? (
                                                    <Camera className="w-3 h-3 text-pink-400 flex-shrink-0" />
                                                ) : (
                                                    <MessageSquare className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                                                )}
                                                <span className="truncate">{deal.client.name || deal.client.phone}</span>
                                            </div>
                                        )}
                                        {deal.tags.length > 0 && (
                                            <div className="mt-2 flex gap-1 flex-wrap">
                                                {deal.tags.slice(0, 3).map(t => (
                                                    <span key={t} className="text-[9px] uppercase tracking-widest bg-secondary/60 border border-border rounded px-1.5 py-0.5">{t}</span>
                                                ))}
                                            </div>
                                        )}
                                        {deal.expectedCloseAt && (
                                            <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                                                <Calendar className="w-3 h-3" /> {new Date(deal.expectedCloseAt).toLocaleDateString()}
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {stageDeals.length === 0 && (
                                    <div className="text-[11px] text-muted-foreground/50 italic text-center py-3 border border-dashed border-border/50 rounded-lg">
                                        Drop deals here
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Table view ─────────────────────────────────────────────────
function DealsTable({ pipeline, deals, onRowClick }: { pipeline: Pipeline; deals: Deal[]; onRowClick: (d: Deal) => void }) {
    return (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-xs uppercase tracking-widest text-muted-foreground">
                    <tr>
                        <th className="text-left px-4 py-2.5 font-semibold">Deal</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Stage</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Contact</th>
                        <th className="text-right px-4 py-2.5 font-semibold">Value</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Expected close</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Tags</th>
                    </tr>
                </thead>
                <tbody>
                    {deals.length === 0 && (
                        <tr><td colSpan={6} className="text-center py-8 text-muted-foreground italic text-xs">No deals yet.</td></tr>
                    )}
                    {deals.map(d => {
                        const tint = tintFor(d.stage.color);
                        return (
                            <tr key={d.id} onClick={() => onRowClick(d)}
                                className="border-t border-border/60 hover:bg-secondary/30 transition-colors cursor-pointer">
                                <td className="px-4 py-2.5 font-medium">{d.title}</td>
                                <td className="px-4 py-2.5">
                                    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md border ${tint.border} ${tint.bg} ${tint.text}`}>
                                        {d.stage.name}
                                    </span>
                                </td>
                                <td className="px-4 py-2.5">
                                    {d.client ? (
                                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                            {d.client.channel === 'instagram'
                                                ? <Camera className="w-3 h-3 text-pink-400" />
                                                : <MessageSquare className="w-3 h-3 text-emerald-400" />}
                                            <span className="truncate">{d.client.name || d.client.phone}</span>
                                        </div>
                                    ) : <span className="text-xs text-muted-foreground/60">—</span>}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono text-xs">
                                    {d.value ? formatMoney(d.value, pipeline.currency) : <span className="text-muted-foreground/60">—</span>}
                                </td>
                                <td className="px-4 py-2.5 text-xs">
                                    {d.expectedCloseAt ? new Date(d.expectedCloseAt).toLocaleDateString() : <span className="text-muted-foreground/60">—</span>}
                                </td>
                                <td className="px-4 py-2.5">
                                    <div className="flex flex-wrap gap-1">
                                        {d.tags.slice(0, 3).map(t => (
                                            <span key={t} className="text-[9px] uppercase tracking-widest bg-secondary/60 border border-border rounded px-1.5 py-0.5">{t}</span>
                                        ))}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ─── Empty state ────────────────────────────────────────────────
function EmptyPipelines({ onCreate }: { onCreate: () => void }) {
    return (
        <div className="rounded-3xl border border-dashed border-border bg-card/40 p-14 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                <Briefcase className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-semibold">Create your first pipeline</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                A pipeline is a Kanban board with stages your deals move through. We&apos;ll pre-fill it with a standard 6-stage sales funnel — you can rename or reshape it later.
            </p>
            <button onClick={onCreate}
                className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-4 h-4" /> Create pipeline
            </button>
        </div>
    );
}

// ─── New pipeline modal ─────────────────────────────────────────
function NewPipelineModal({ onCreate, onClose }: { onCreate: (name: string, currency: string) => void; onClose: () => void }) {
    const [name, setName] = useState("Sales");
    const [currency, setCurrency] = useState("USD");
    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">New pipeline</h2>
                    <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
                </div>
                <div className="space-y-3">
                    <div>
                        <label className="text-xs text-muted-foreground">Name</label>
                        <input value={name} onChange={e => setName(e.target.value)} autoFocus
                            className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Currency</label>
                        <select value={currency} onChange={e => setCurrency(e.target.value)}
                            className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm">
                            {['USD','EUR','AZN','TRY','RUB','GBP'].map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                        Pre-fills 6 default stages (New → Contacted → Qualified → Proposal → Won / Lost). You can edit them any time.
                    </p>
                </div>
                <div className="flex justify-end gap-2 mt-5">
                    <button onClick={onClose} className="text-xs px-3 py-2 rounded-lg border border-border">Cancel</button>
                    <button onClick={() => name.trim() && onCreate(name.trim(), currency)}
                        className="text-xs font-medium px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
                        Create
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── New deal modal ────────────────────────────────────────────
function NewDealModal({ pipeline, onCreate, onClose }: { pipeline: Pipeline; onCreate: (payload: any) => void; onClose: () => void }) {
    const [title, setTitle] = useState("");
    const [stageId, setStageId] = useState(pipeline.stages[0]?.id || "");
    const [value, setValue] = useState("");
    const [expectedCloseAt, setExpectedCloseAt] = useState("");
    const [clientId, setClientId] = useState<string>("");
    const [tags, setTags] = useState<string>("");
    const [clients, setClients] = useState<ClientSummary[]>([]);
    const [clientQuery, setClientQuery] = useState("");
    const [clientPickerOpen, setClientPickerOpen] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const r = await api.get('/clients');
                if (r.data?.success) setClients(r.data.clients as ClientSummary[]);
            } catch { /* soft-fail */ }
        })();
    }, []);

    const filteredClients = useMemo(() => {
        if (!clientQuery.trim()) return clients.slice(0, 12);
        const q = clientQuery.trim().toLowerCase();
        return clients.filter(c => (c.name || '').toLowerCase().includes(q) || c.phone.toLowerCase().includes(q)).slice(0, 20);
    }, [clients, clientQuery]);

    const selectedClient = clients.find(c => c.id === clientId);

    const submit = () => {
        if (!title.trim()) return;
        onCreate({
            pipelineId: pipeline.id,
            stageId: stageId || undefined,
            title: title.trim(),
            value: value ? Number(value) : null,
            expectedCloseAt: expectedCloseAt ? new Date(expectedCloseAt).toISOString() : null,
            clientId: clientId || null,
            tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        });
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-lg p-5 my-8" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">New deal</h2>
                    <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
                </div>
                <div className="space-y-3">
                    <div>
                        <label className="text-xs text-muted-foreground">Title *</label>
                        <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
                            placeholder="e.g. Ali Novruzov — consultation package"
                            className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-muted-foreground">Stage</label>
                            <select value={stageId} onChange={e => setStageId(e.target.value)}
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm">
                                {pipeline.stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground">Value ({pipeline.currency})</label>
                            <input value={value} onChange={e => setValue(e.target.value.replace(/[^0-9.]/g, ''))}
                                placeholder="0"
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Contact (optional)</label>
                        <div className="mt-1 relative">
                            <button type="button" onClick={() => setClientPickerOpen(!clientPickerOpen)}
                                className="w-full text-left bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm flex items-center justify-between">
                                {selectedClient ? (
                                    <span className="flex items-center gap-1.5 text-foreground">
                                        {selectedClient.channel === 'instagram'
                                            ? <Camera className="w-3 h-3 text-pink-400" />
                                            : <MessageSquare className="w-3 h-3 text-emerald-400" />}
                                        {selectedClient.name || selectedClient.phone}
                                    </span>
                                ) : <span className="text-muted-foreground">Link an existing contact…</span>}
                                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                            </button>
                            {clientPickerOpen && (
                                <div className="absolute z-10 top-full left-0 right-0 mt-1 rounded-lg border border-border bg-card shadow-xl max-h-56 overflow-y-auto">
                                    <div className="p-2 border-b border-border">
                                        <input value={clientQuery} onChange={e => setClientQuery(e.target.value)}
                                            placeholder="Search…"
                                            className="w-full bg-secondary/50 border border-border rounded-md px-2 py-1 text-xs" autoFocus />
                                    </div>
                                    <button onClick={() => { setClientId(""); setClientPickerOpen(false); }}
                                        className="w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary/40 italic">
                                        No contact (create deal only)
                                    </button>
                                    {filteredClients.map(c => (
                                        <button key={c.id} onClick={() => { setClientId(c.id); setClientPickerOpen(false); }}
                                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-secondary/40 flex items-center gap-1.5">
                                            {c.channel === 'instagram'
                                                ? <Camera className="w-3 h-3 text-pink-400" />
                                                : <MessageSquare className="w-3 h-3 text-emerald-400" />}
                                            <span className="flex-1 truncate">{c.name || c.phone}</span>
                                            <span className="text-[10px] text-muted-foreground/60 font-mono">{c.phone.slice(-6)}</span>
                                        </button>
                                    ))}
                                    {filteredClients.length === 0 && (
                                        <div className="px-3 py-3 text-xs text-muted-foreground italic text-center">No matching contacts.</div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-muted-foreground">Expected close</label>
                            <input type="date" value={expectedCloseAt} onChange={e => setExpectedCloseAt(e.target.value)}
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground">Tags (comma-separated)</label>
                            <input value={tags} onChange={e => setTags(e.target.value)}
                                placeholder="hot, ad, upsell"
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                        </div>
                    </div>
                </div>
                <div className="flex justify-end gap-2 mt-5">
                    <button onClick={onClose} className="text-xs px-3 py-2 rounded-lg border border-border">Cancel</button>
                    <button onClick={submit} disabled={!title.trim()}
                        className="text-xs font-medium px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                        Create deal
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Deal drawer ────────────────────────────────────────────────
function DealDrawer({ deal, pipeline, onClose, onUpdate, onDelete }: {
    deal: Deal;
    pipeline: Pipeline;
    onClose: () => void;
    onUpdate: (patch: any) => void;
    onDelete: () => void;
}) {
    const [title, setTitle] = useState(deal.title);
    const [description, setDescription] = useState(deal.description || "");
    const [value, setValue] = useState(deal.value || "");
    const [stageId, setStageId] = useState(deal.stageId);
    const [expectedCloseAt, setExpectedCloseAt] = useState(deal.expectedCloseAt ? deal.expectedCloseAt.slice(0, 10) : "");
    const [tags, setTags] = useState(deal.tags.join(', '));
    const dirty = title !== deal.title
        || (description || '') !== (deal.description || '')
        || String(value || '') !== String(deal.value || '')
        || stageId !== deal.stageId
        || (expectedCloseAt || '') !== (deal.expectedCloseAt ? deal.expectedCloseAt.slice(0, 10) : '')
        || tags !== deal.tags.join(', ');

    const save = () => {
        onUpdate({
            title,
            description: description || null,
            value: value ? Number(value) : null,
            stageId,
            expectedCloseAt: expectedCloseAt ? new Date(expectedCloseAt).toISOString() : null,
            tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        });
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex justify-end" onClick={onClose}>
            <div className="bg-card border-l border-border w-full max-w-xl h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-border flex items-center justify-between sticky top-0 bg-card z-10">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-primary/10 text-primary rounded-lg"><Briefcase className="w-4 h-4" /></div>
                        <div>
                            <div className="text-xs uppercase tracking-widest text-muted-foreground">{pipeline.name}</div>
                            <div className="text-sm font-semibold">{deal.title}</div>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-secondary/40 rounded-lg"><X className="w-4 h-4" /></button>
                </div>
                <div className="p-5 space-y-4">
                    <div>
                        <label className="text-xs text-muted-foreground">Title</label>
                        <input value={title} onChange={e => setTitle(e.target.value)}
                            className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-muted-foreground flex items-center gap-1"><Tag className="w-3 h-3" /> Stage</label>
                            <select value={stageId} onChange={e => setStageId(e.target.value)}
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm">
                                {pipeline.stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" /> Value ({pipeline.currency})</label>
                            <input value={value} onChange={e => setValue(e.target.value.replace(/[^0-9.]/g, ''))}
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" /> Expected close</label>
                        <input type="date" value={expectedCloseAt} onChange={e => setExpectedCloseAt(e.target.value)}
                            className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Tags</label>
                        <input value={tags} onChange={e => setTags(e.target.value)}
                            placeholder="hot, ad, upsell"
                            className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Notes</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={5}
                            placeholder="Notes about this deal…"
                            className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm resize-y" />
                    </div>
                    {deal.client && (
                        <div className="rounded-xl border border-border bg-secondary/30 p-3">
                            <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold mb-2 flex items-center gap-1">
                                <UserIcon className="w-3 h-3" /> Linked contact
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                                {deal.client.channel === 'instagram'
                                    ? <Camera className="w-4 h-4 text-pink-400" />
                                    : <MessageSquare className="w-4 h-4 text-emerald-400" />}
                                <span className="font-medium">{deal.client.name || deal.client.phone}</span>
                                <span className="text-[10px] text-muted-foreground/60 font-mono ml-auto">{deal.client.phone}</span>
                            </div>
                            {deal.client.status && <div className="mt-1.5 text-[10px] text-muted-foreground">Status: {deal.client.status}</div>}
                        </div>
                    )}
                    <div className="text-[10px] text-muted-foreground/60">
                        Created {new Date(deal.createdAt).toLocaleString()} · Updated {new Date(deal.updatedAt).toLocaleString()}
                    </div>
                </div>
                <div className="p-4 border-t border-border sticky bottom-0 bg-card flex items-center justify-between">
                    <button onClick={onDelete} className="text-xs text-red-400 hover:underline inline-flex items-center gap-1">
                        <Trash2 className="w-3 h-3" /> Delete deal
                    </button>
                    <button onClick={save} disabled={!dirty}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                        <Save className="w-3.5 h-3.5" /> Save
                    </button>
                </div>
            </div>
        </div>
    );
}

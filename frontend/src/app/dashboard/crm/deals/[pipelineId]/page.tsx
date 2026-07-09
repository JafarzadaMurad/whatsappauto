"use client";

import { useEffect, useMemo, useRef, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    ArrowLeft, Loader2, Plus, LayoutGrid, Table as TableIcon, X,
    Search, Trash2, Save, DollarSign, Calendar, User as UserIcon, Tag,
    MessageSquare, Camera, ChevronDown, Check, MoreHorizontal, Workflow,
} from "lucide-react";
import api from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────
type Stage = { id: string; name: string; order: number; color: string | null; isWon: boolean; isLost: boolean; probability: number | null };
type Pipeline = {
    id: string; name: string; description: string | null; color: string | null;
    currency: string; isDefault: boolean; order: number;
    stages: Stage[];
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

const STAGE_COLORS = ['slate', 'blue', 'violet', 'amber', 'emerald', 'red', 'pink', 'cyan', 'orange'] as const;

const STAGE_TINTS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
    slate:   { bg: 'bg-slate-500',   text: 'text-white', border: 'border-slate-500',   dot: 'bg-slate-400' },
    blue:    { bg: 'bg-blue-500',    text: 'text-white', border: 'border-blue-500',    dot: 'bg-blue-400' },
    violet:  { bg: 'bg-violet-500',  text: 'text-white', border: 'border-violet-500',  dot: 'bg-violet-400' },
    amber:   { bg: 'bg-amber-500',   text: 'text-white', border: 'border-amber-500',   dot: 'bg-amber-400' },
    emerald: { bg: 'bg-emerald-500', text: 'text-white', border: 'border-emerald-500', dot: 'bg-emerald-400' },
    red:     { bg: 'bg-red-500',     text: 'text-white', border: 'border-red-500',     dot: 'bg-red-400' },
    pink:    { bg: 'bg-pink-500',    text: 'text-white', border: 'border-pink-500',    dot: 'bg-pink-400' },
    cyan:    { bg: 'bg-cyan-500',    text: 'text-white', border: 'border-cyan-500',    dot: 'bg-cyan-400' },
    orange:  { bg: 'bg-orange-500',  text: 'text-white', border: 'border-orange-500',  dot: 'bg-orange-400' },
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

export default function PipelineDetailPage({ params }: { params: Promise<{ pipelineId: string }> }) {
    const { pipelineId } = use(params);
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [pipeline, setPipeline] = useState<Pipeline | null>(null);
    const [deals, setDeals] = useState<Deal[]>([]);
    const [view, setView] = useState<'kanban' | 'table'>('kanban');
    const [error, setError] = useState<string | null>(null);
    const [newDealOpen, setNewDealOpen] = useState(false);
    const [newDealDefaultStage, setNewDealDefaultStage] = useState<string | undefined>();
    const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
    const [query, setQuery] = useState("");
    const [dragging, setDragging] = useState<Deal | null>(null);
    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState("");

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const [pRes, dRes] = await Promise.all([
                    api.get('/crm/pipelines'),
                    api.get('/crm/deals', { params: { pipelineId } }),
                ]);
                if (pRes.data?.success) {
                    const p: Pipeline | undefined = (pRes.data.pipelines as Pipeline[]).find(x => x.id === pipelineId);
                    if (!p) { router.replace('/dashboard/crm/deals'); return; }
                    setPipeline(p);
                    setNameDraft(p.name);
                }
                if (dRes.data?.success) setDeals(dRes.data.deals as Deal[]);
            } catch (e: any) { setError(e.response?.data?.message || e.message); }
            finally { setLoading(false); }
        })();
    }, [pipelineId, router]);

    const filtered = useMemo(() => {
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

    // ── Pipeline actions ───────────────────────────────────
    const saveName = async () => {
        if (!pipeline || !nameDraft.trim() || nameDraft.trim() === pipeline.name) {
            setEditingName(false);
            setNameDraft(pipeline?.name || "");
            return;
        }
        try {
            const r = await api.patch(`/crm/pipelines/${pipeline.id}`, { name: nameDraft.trim() });
            if (r.data?.success) setPipeline(r.data.pipeline);
        } catch (e: any) { setError(e.response?.data?.message || e.message); }
        finally { setEditingName(false); }
    };

    // ── Stage actions ──────────────────────────────────────
    const addStage = async (afterStageId?: string, color: string = 'slate') => {
        if (!pipeline) return;
        try {
            const r = await api.post(`/crm/pipelines/${pipeline.id}/stages`, {
                name: 'New Stage', color, afterStageId,
            });
            if (r.data?.success) {
                // Refresh the whole pipeline to pick up reordered stages.
                const pRes = await api.get('/crm/pipelines');
                if (pRes.data?.success) {
                    const p = (pRes.data.pipelines as Pipeline[]).find(x => x.id === pipeline.id);
                    if (p) setPipeline(p);
                }
            }
        } catch (e: any) { setError(e.response?.data?.message || e.message); }
    };

    const updateStage = async (stageId: string, patch: Partial<Stage>) => {
        if (!pipeline) return;
        try {
            const r = await api.patch(`/crm/pipelines/${pipeline.id}/stages/${stageId}`, patch);
            if (r.data?.success) {
                setPipeline(p => p ? { ...p, stages: p.stages.map(s => s.id === stageId ? r.data.stage : s) } : p);
            }
        } catch (e: any) { setError(e.response?.data?.message || e.message); }
    };

    const reorderStages = async (ids: string[]) => {
        if (!pipeline) return;
        // Optimistic — reorder in-place, then persist.
        const map = new Map(pipeline.stages.map(s => [s.id, s]));
        const nextStages = ids.map((id, i) => ({ ...(map.get(id) as Stage), order: i }));
        setPipeline(p => p ? { ...p, stages: nextStages } : p);
        try {
            await api.put(`/crm/pipelines/${pipeline.id}/stages/reorder`, { stageIds: ids });
        } catch (e: any) {
            setError(e.response?.data?.message || e.message);
            // Roll back by refetching
            const r = await api.get('/crm/pipelines');
            if (r.data?.success) {
                const p = (r.data.pipelines as Pipeline[]).find(x => x.id === pipeline.id);
                if (p) setPipeline(p);
            }
        }
    };

    const deleteStage = async (stageId: string) => {
        if (!pipeline) return;
        const stage = pipeline.stages.find(s => s.id === stageId);
        const stageDealCount = deals.filter(d => d.stageId === stageId).length;
        if (stageDealCount > 0) {
            alert(`This stage has ${stageDealCount} deal${stageDealCount === 1 ? '' : 's'}. Move them out first, then delete the stage.`);
            return;
        }
        if (!confirm(`Delete stage "${stage?.name}"?`)) return;
        try {
            await api.delete(`/crm/pipelines/${pipeline.id}/stages/${stageId}`);
            setPipeline(p => p ? { ...p, stages: p.stages.filter(s => s.id !== stageId) } : p);
        } catch (e: any) { setError(e.response?.data?.message || e.message); }
    };

    // ── Deal actions ───────────────────────────────────────
    const handleDrop = async (dealId: string, targetStageId: string) => {
        setDragging(null);
        const deal = deals.find(d => d.id === dealId);
        if (!deal || deal.stageId === targetStageId) return;
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
            const r2 = await api.get('/crm/deals', { params: { pipelineId } });
            if (r2.data?.success) setDeals(r2.data.deals);
        }
    };

    const createDeal = async (payload: any) => {
        try {
            const r = await api.post('/crm/deals', payload);
            if (r.data?.success) {
                setDeals(prev => [...prev, r.data.deal as Deal]);
                setNewDealOpen(false);
                setNewDealDefaultStage(undefined);
            }
        } catch (e: any) { setError(e.response?.data?.message || 'Could not create deal'); }
    };

    const updateDeal = async (id: string, patch: any) => {
        try {
            const r = await api.patch(`/crm/deals/${id}`, patch);
            if (r.data?.success) {
                setDeals(prev => prev.map(d => d.id === id ? r.data.deal : d));
                setSelectedDeal(r.data.deal);
            }
        } catch (e: any) { setError(e.response?.data?.message || e.message); }
    };

    const deleteDeal = async (id: string) => {
        if (!confirm('Delete this deal? This cannot be undone.')) return;
        try {
            await api.delete(`/crm/deals/${id}`);
            setDeals(prev => prev.filter(d => d.id !== id));
            setSelectedDeal(null);
        } catch (e: any) { setError(e.response?.data?.message || e.message); }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );
    if (!pipeline) return null;

    const totalValue = deals.reduce((acc, d) => acc + (Number(d.value) || 0), 0);

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                    <Link href="/dashboard/crm/deals"
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-2">
                        <ArrowLeft className="w-3.5 h-3.5" /> All pipelines
                    </Link>
                    {editingName ? (
                        <input value={nameDraft} onChange={e => setNameDraft(e.target.value)}
                            onBlur={saveName}
                            onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setEditingName(false); setNameDraft(pipeline.name); } }}
                            autoFocus
                            className="text-2xl font-bold bg-transparent border-b border-primary/50 focus:outline-none px-1 -mx-1" />
                    ) : (
                        <h1 onClick={() => setEditingName(true)}
                            className="text-2xl font-bold cursor-text hover:bg-secondary/30 rounded px-1 -mx-1 inline-block"
                            title="Click to rename">
                            {pipeline.name}
                        </h1>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                        <strong>{deals.length}</strong> deal{deals.length === 1 ? '' : 's'} · <strong>{pipeline.stages.length}</strong> stage{pipeline.stages.length === 1 ? '' : 's'} · {pipeline.currency}
                        {totalValue > 0 && <> · Total: <strong className="text-foreground">{formatMoney(totalValue, pipeline.currency)}</strong></>}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-secondary/50 border border-border w-56">
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
                    <Link href={`/dashboard/crm/deals/${pipeline.id}/automation`}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20">
                        <Workflow className="w-3.5 h-3.5" /> Automation
                    </Link>
                    <button onClick={() => { setNewDealDefaultStage(undefined); setNewDealOpen(true); }}
                        className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
                        <Plus className="w-4 h-4" /> New deal
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded-lg flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="hover:opacity-70"><X className="w-3.5 h-3.5" /></button>
                </div>
            )}

            {/* Content */}
            {view === 'kanban' ? (
                <KanbanBoard
                    pipeline={pipeline}
                    deals={filtered}
                    onCardClick={setSelectedDeal}
                    onAddDeal={(stageId) => { setNewDealDefaultStage(stageId); setNewDealOpen(true); }}
                    onDrop={handleDrop}
                    dragging={dragging}
                    setDragging={setDragging}
                    onRenameStage={(id, name) => updateStage(id, { name } as any)}
                    onRecolorStage={(id, color) => updateStage(id, { color } as any)}
                    onDeleteStage={deleteStage}
                    onAddStage={addStage}
                    onReorderStages={reorderStages}
                />
            ) : (
                <DealsTable
                    pipeline={pipeline}
                    deals={filtered}
                    onRowClick={setSelectedDeal}
                />
            )}

            {newDealOpen && (
                <NewDealModal
                    pipeline={pipeline}
                    defaultStageId={newDealDefaultStage}
                    onCreate={createDeal}
                    onClose={() => { setNewDealOpen(false); setNewDealDefaultStage(undefined); }}
                />
            )}
            {selectedDeal && (
                <DealDrawer
                    deal={selectedDeal}
                    pipeline={pipeline}
                    onClose={() => setSelectedDeal(null)}
                    onUpdate={patch => updateDeal(selectedDeal.id, patch)}
                    onDelete={() => deleteDeal(selectedDeal.id)}
                />
            )}
        </div>
    );
}

// ─── Kanban Board ─────────────────────────────────────────────────
function KanbanBoard({ pipeline, deals, onCardClick, onAddDeal, onDrop, dragging, setDragging, onRenameStage, onRecolorStage, onDeleteStage, onAddStage, onReorderStages }: {
    pipeline: Pipeline;
    deals: Deal[];
    onCardClick: (deal: Deal) => void;
    onAddDeal: (stageId: string) => void;
    onDrop: (dealId: string, targetStageId: string) => void;
    dragging: Deal | null;
    setDragging: (d: Deal | null) => void;
    onRenameStage: (id: string, name: string) => void;
    onRecolorStage: (id: string, color: string) => void;
    onDeleteStage: (id: string) => void;
    onAddStage: (afterStageId?: string) => void;
    onReorderStages: (ids: string[]) => void;
}) {
    // Track a stage being dragged for reordering (separate from deal drag).
    const [stageDrag, setStageDrag] = useState<{ id: string } | null>(null);

    return (
        <div className="overflow-x-auto -mx-2 px-2 pb-2">
            <div className="flex gap-0 min-h-[60vh] items-start">
                {pipeline.stages.map((stage, i) => {
                    const tint = tintFor(stage.color);
                    const stageDeals = deals.filter(d => d.stageId === stage.id).sort((a, b) => a.order - b.order);
                    const stageSum = stageDeals.reduce((acc, d) => acc + (Number(d.value) || 0), 0);
                    return (
                        <div key={stage.id} className="group flex items-stretch">
                            <div
                                draggable={!dragging}
                                onDragStart={(e) => {
                                    if (dragging) return;
                                    e.dataTransfer.setData('text/stage-id', stage.id);
                                    setStageDrag({ id: stage.id });
                                }}
                                onDragEnd={() => setStageDrag(null)}
                                onDragOver={e => {
                                    e.preventDefault();
                                    // If we're dragging a stage, let this be a drop target
                                    // for reordering (below). If we're dragging a deal it
                                    // stays a normal drop target for card moves.
                                }}
                                onDrop={e => {
                                    e.preventDefault();
                                    const draggedStageId = e.dataTransfer.getData('text/stage-id');
                                    if (draggedStageId && draggedStageId !== stage.id) {
                                        // Reorder: move draggedStageId to this stage's index.
                                        const ids = pipeline.stages.map(s => s.id);
                                        const from = ids.indexOf(draggedStageId);
                                        const to = ids.indexOf(stage.id);
                                        if (from > -1 && to > -1) {
                                            const next = [...ids];
                                            next.splice(from, 1);
                                            next.splice(to, 0, draggedStageId);
                                            onReorderStages(next);
                                        }
                                    } else if (dragging) {
                                        onDrop(dragging.id, stage.id);
                                    }
                                }}
                                className={`w-72 flex-shrink-0 rounded-2xl border border-border bg-card overflow-hidden flex flex-col mx-1.5 ${dragging && dragging.stageId !== stage.id ? `ring-2 ring-primary/40` : ''} ${stageDrag?.id === stage.id ? 'opacity-40' : ''}`}>
                                <StageHeader
                                    stage={stage}
                                    count={stageDeals.length}
                                    sum={stageSum}
                                    currency={pipeline.currency}
                                    onRename={(name) => onRenameStage(stage.id, name)}
                                    onRecolor={(color) => onRecolorStage(stage.id, color)}
                                    onDelete={() => onDeleteStage(stage.id)}
                                    onAddDeal={() => onAddDeal(stage.id)}
                                />
                                <div className="p-2 space-y-2 flex-1 min-h-[100px]">
                                    {stageDeals.map(deal => (
                                        <DealCard key={deal.id}
                                            deal={deal}
                                            currency={pipeline.currency}
                                            tintDot={tint.dot}
                                            dragging={dragging}
                                            setDragging={setDragging}
                                            onClick={() => onCardClick(deal)}
                                        />
                                    ))}
                                    {stageDeals.length === 0 && (
                                        <button onClick={() => onAddDeal(stage.id)}
                                            className="w-full text-[11px] text-muted-foreground/50 italic py-6 border border-dashed border-border/60 rounded-lg hover:bg-secondary/20 hover:text-muted-foreground transition-colors">
                                            Drop or click to add
                                        </button>
                                    )}
                                </div>
                            </div>
                            {/* Between-stage insert affordance — appears on hover
                                of the whole row. Injects a new stage after the
                                current one. */}
                            {i < pipeline.stages.length - 1 && (
                                <div className="w-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => onAddStage(stage.id)}
                                        title="Add stage here"
                                        className="w-6 h-6 rounded-full bg-primary/15 border border-primary/40 text-primary hover:bg-primary/25 flex items-center justify-center">
                                        <Plus className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            )}
                            {/* Trailing hover-slot after the last stage — same
                                affordance but appends at the end. */}
                            {i === pipeline.stages.length - 1 && (
                                <div className="w-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => onAddStage(stage.id)}
                                        title="Add stage"
                                        className="w-6 h-6 rounded-full bg-primary/15 border border-primary/40 text-primary hover:bg-primary/25 flex items-center justify-center">
                                        <Plus className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function DealCard({ deal, currency, tintDot, dragging, setDragging, onClick }: {
    deal: Deal;
    currency: string;
    tintDot: string;
    dragging: Deal | null;
    setDragging: (d: Deal | null) => void;
    onClick: () => void;
}) {
    return (
        <div
            draggable
            onDragStart={() => setDragging(deal)}
            onDragEnd={() => setDragging(null)}
            onClick={onClick}
            className={`rounded-xl border border-border bg-secondary/30 p-3 hover:border-primary/50 hover:bg-secondary/50 cursor-grab active:cursor-grabbing transition-colors ${dragging?.id === deal.id ? 'opacity-40' : ''}`}>
            <div className="text-sm font-medium truncate">{deal.title}</div>
            {deal.value && (
                <div className="text-xs font-semibold mt-1 text-primary">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${tintDot} mr-1.5 align-middle`} />
                    {formatMoney(deal.value, currency)}
                </div>
            )}
            {deal.client && (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground truncate">
                    {deal.client.channel === 'instagram'
                        ? <Camera className="w-3 h-3 text-pink-400 flex-shrink-0" />
                        : <MessageSquare className="w-3 h-3 text-emerald-400 flex-shrink-0" />}
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
    );
}

function StageHeader({ stage, count, sum, currency, onRename, onRecolor, onDelete, onAddDeal }: {
    stage: Stage;
    count: number;
    sum: number;
    currency: string;
    onRename: (name: string) => void;
    onRecolor: (color: string) => void;
    onDelete: () => void;
    onAddDeal: () => void;
}) {
    const tint = tintFor(stage.color);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(stage.name);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!menuOpen) return;
        const onDoc = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [menuOpen]);

    const commit = () => {
        setEditing(false);
        if (draft.trim() && draft.trim() !== stage.name) onRename(draft.trim());
        else setDraft(stage.name);
    };

    return (
        <div className={`${tint.bg} ${tint.text} px-3 py-2`}>
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    {editing ? (
                        <input value={draft} onChange={e => setDraft(e.target.value)}
                            onBlur={commit}
                            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setDraft(stage.name); } }}
                            autoFocus
                            className="flex-1 bg-white/20 border-b border-white/40 focus:outline-none focus:border-white/80 text-xs font-semibold uppercase tracking-widest px-1 -mx-1" />
                    ) : (
                        <button onClick={() => setEditing(true)}
                            className="text-xs font-semibold uppercase tracking-widest truncate cursor-text hover:bg-white/10 rounded px-1 -mx-1"
                            title="Click to rename">
                            {stage.name}
                        </button>
                    )}
                    {stage.isWon && <Check className="w-3.5 h-3.5" />}
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-[10px] font-medium bg-white/20 rounded px-1.5 py-0.5">{count}</span>
                    <div className="relative" ref={menuRef}>
                        <button onClick={() => setMenuOpen(v => !v)}
                            title="Stage options"
                            className="p-1 rounded hover:bg-white/20">
                            <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>
                        {menuOpen && (
                            <div className="absolute right-0 top-full mt-1 min-w-[180px] rounded-xl border border-border bg-card shadow-xl z-10 text-foreground text-xs overflow-hidden">
                                <button onClick={() => { onAddDeal(); setMenuOpen(false); }}
                                    className="w-full text-left px-3 py-2 hover:bg-secondary/40">Add deal here</button>
                                <div className="border-t border-border/60 px-3 py-2">
                                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Colour</div>
                                    <div className="flex flex-wrap gap-1">
                                        {STAGE_COLORS.map(c => (
                                            <button key={c} onClick={() => { onRecolor(c); setMenuOpen(false); }}
                                                title={c}
                                                className={`w-5 h-5 rounded-full ${STAGE_TINTS[c].bg} border-2 ${stage.color === c ? 'border-white' : 'border-transparent'} hover:scale-110 transition-transform`} />
                                        ))}
                                    </div>
                                </div>
                                <button onClick={() => { onDelete(); setMenuOpen(false); }}
                                    className="w-full text-left px-3 py-2 hover:bg-red-500/10 text-red-400 border-t border-border/60 flex items-center gap-1.5">
                                    <Trash2 className="w-3 h-3" /> Delete stage
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {sum > 0 && (
                <div className="text-[10px] mt-1 opacity-90">{formatMoney(sum, currency)}</div>
            )}
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
                                    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md ${tint.bg} ${tint.text}`}>
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

// ─── New deal modal ────────────────────────────────────────────
function NewDealModal({ pipeline, defaultStageId, onCreate, onClose }: { pipeline: Pipeline; defaultStageId?: string; onCreate: (payload: any) => void; onClose: () => void }) {
    const [title, setTitle] = useState("");
    const [stageId, setStageId] = useState(defaultStageId || pipeline.stages[0]?.id || "");
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
                    <div>
                        <div className="text-xs uppercase tracking-widest text-muted-foreground">{pipeline.name}</div>
                        <div className="text-sm font-semibold">{deal.title}</div>
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

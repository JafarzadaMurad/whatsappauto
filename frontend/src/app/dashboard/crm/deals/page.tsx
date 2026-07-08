"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
    Briefcase, Loader2, Plus, Search, Eye, Copy, Trash2, X, Filter,
    ChevronUp, ChevronDown,
} from "lucide-react";
import api from "@/lib/api";

type Stage = { id: string; name: string; order: number; color: string | null; isWon: boolean; isLost: boolean };
type Pipeline = {
    id: string; name: string; description: string | null; color: string | null;
    currency: string; isDefault: boolean; order: number; createdAt: string;
    stages: Stage[];
    _count?: { deals: number };
};

type SortKey = 'name' | 'createdAt' | 'stages' | 'deals';

export default function DealsPipelinesListPage() {
    const [loading, setLoading] = useState(true);
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);
    const [query, setQuery] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [newOpen, setNewOpen] = useState(false);
    const [sortKey, setSortKey] = useState<SortKey>('createdAt');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [busyId, setBusyId] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const r = await api.get('/crm/pipelines');
            if (r.data?.success) setPipelines(r.data.pipelines as Pipeline[]);
        } catch (e: any) {
            setError(e.response?.data?.message || e.message);
        } finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = q ? pipelines.filter(p =>
            p.name.toLowerCase().includes(q)
            || (p.description || '').toLowerCase().includes(q)
        ) : pipelines.slice();

        const dir = sortDir === 'asc' ? 1 : -1;
        list.sort((a, b) => {
            let cmp = 0;
            if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
            else if (sortKey === 'createdAt') cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            else if (sortKey === 'stages') cmp = (a.stages?.length || 0) - (b.stages?.length || 0);
            else if (sortKey === 'deals') cmp = (a._count?.deals || 0) - (b._count?.deals || 0);
            return cmp * dir;
        });
        return list;
    }, [pipelines, query, sortKey, sortDir]);

    const toggleSort = (k: SortKey) => {
        if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(k); setSortDir(k === 'name' ? 'asc' : 'desc'); }
    };

    const createPipeline = async (name: string, currency: string) => {
        try {
            const r = await api.post('/crm/pipelines', { name, currency });
            if (r.data?.success) {
                setPipelines(prev => [...prev, r.data.pipeline as Pipeline]);
                setNewOpen(false);
            }
        } catch (e: any) { setError(e.response?.data?.message || e.message); }
    };

    const duplicatePipeline = async (id: string) => {
        setBusyId(id);
        try {
            const r = await api.post(`/crm/pipelines/${id}/duplicate`);
            if (r.data?.success) setPipelines(prev => [...prev, { ...r.data.pipeline, _count: { deals: 0 } }]);
        } catch (e: any) { setError(e.response?.data?.message || e.message); }
        finally { setBusyId(null); }
    };

    const deletePipeline = async (id: string) => {
        const p = pipelines.find(x => x.id === id);
        if (!confirm(`Delete pipeline "${p?.name}"? This removes all its stages and deals — this cannot be undone.`)) return;
        setBusyId(id);
        try {
            await api.delete(`/crm/pipelines/${id}`);
            setPipelines(prev => prev.filter(x => x.id !== id));
        } catch (e: any) { setError(e.response?.data?.message || e.message); }
        finally { setBusyId(null); }
    };

    return (
        <div className="max-w-6xl mx-auto space-y-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-xl"><Briefcase className="w-6 h-6" /></div>
                        All pipelines
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        A pipeline is a sales funnel — drag deals through the stages until they close. Click a name to open its board.
                    </p>
                </div>
                <button onClick={() => setNewOpen(true)}
                    className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
                    <Plus className="w-4 h-4" /> Add pipeline
                </button>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded-lg flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="hover:opacity-70"><X className="w-3.5 h-3.5" /></button>
                </div>
            )}

            {/* Toolbar */}
            <div className="bg-card border border-border rounded-2xl p-4 flex items-end gap-3 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                    <label className="text-xs text-muted-foreground">Search</label>
                    <div className="mt-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/50 border border-border">
                        <Search className="w-3.5 h-3.5 text-muted-foreground" />
                        <input value={query} onChange={e => setQuery(e.target.value)}
                            placeholder="Search pipelines by name…"
                            className="flex-1 bg-transparent outline-none text-sm" />
                    </div>
                </div>
                <button disabled title="Filters coming soon"
                    className="text-xs text-muted-foreground/60 inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border cursor-not-allowed">
                    <Filter className="w-3.5 h-3.5" /> Add filter
                </button>
            </div>

            {/* Table */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
                {loading ? (
                    <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-16">
                        <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                            <Briefcase className="w-7 h-7" />
                        </div>
                        <h2 className="text-lg font-semibold">
                            {query ? 'No pipelines match your search' : 'No pipelines yet'}
                        </h2>
                        {!query && (
                            <>
                                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                                    Add your first pipeline — we&apos;ll pre-fill it with a 6-stage sales funnel you can rename or reshape later.
                                </p>
                                <button onClick={() => setNewOpen(true)}
                                    className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
                                    <Plus className="w-4 h-4" /> Add pipeline
                                </button>
                            </>
                        )}
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="bg-secondary/40 text-xs uppercase tracking-widest text-muted-foreground">
                            <tr>
                                <SortHeader label="Name"          k="name"      current={sortKey} dir={sortDir} onClick={toggleSort} align="left" />
                                <SortHeader label="Created"       k="createdAt" current={sortKey} dir={sortDir} onClick={toggleSort} align="left" />
                                <SortHeader label="Stages"        k="stages"    current={sortKey} dir={sortDir} onClick={toggleSort} align="left" />
                                <SortHeader label="Deals"         k="deals"     current={sortKey} dir={sortDir} onClick={toggleSort} align="left" />
                                <th className="px-4 py-3 text-right font-semibold w-32">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(p => (
                                <tr key={p.id} className="border-t border-border/60 hover:bg-secondary/20 transition-colors">
                                    <td className="px-4 py-3">
                                        <Link href={`/dashboard/crm/deals/${p.id}`}
                                            className="text-primary font-medium hover:underline">
                                            {p.name}
                                        </Link>
                                        {p.isDefault && (
                                            <span className="ml-2 text-[9px] uppercase tracking-widest text-primary/70 border border-primary/30 rounded px-1 py-0.5">Default</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-muted-foreground">
                                        {new Date(p.createdAt).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                    <td className="px-4 py-3">{p.stages?.length || 0}</td>
                                    <td className="px-4 py-3">{p._count?.deals ?? 0}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-1">
                                            <Link href={`/dashboard/crm/deals/${p.id}`}
                                                title="Open pipeline"
                                                className="p-1.5 rounded-md border border-border hover:bg-secondary/50 text-muted-foreground hover:text-foreground">
                                                <Eye className="w-3.5 h-3.5" />
                                            </Link>
                                            <button onClick={() => duplicatePipeline(p.id)} disabled={busyId === p.id}
                                                title="Duplicate"
                                                className="p-1.5 rounded-md border border-border hover:bg-secondary/50 text-muted-foreground hover:text-foreground disabled:opacity-50">
                                                {busyId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
                                            </button>
                                            <button onClick={() => deletePipeline(p.id)} disabled={busyId === p.id}
                                                title="Delete"
                                                className="p-1.5 rounded-md border border-red-500/40 hover:bg-red-500/10 text-red-400 disabled:opacity-50">
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {newOpen && <NewPipelineModal onCreate={createPipeline} onClose={() => setNewOpen(false)} />}
        </div>
    );
}

function SortHeader({ label, k, current, dir, onClick, align }: {
    label: string; k: SortKey; current: SortKey; dir: 'asc' | 'desc'; onClick: (k: SortKey) => void; align?: 'left' | 'right';
}) {
    const active = current === k;
    return (
        <th className={`px-4 py-3 font-semibold ${align === 'right' ? 'text-right' : 'text-left'}`}>
            <button onClick={() => onClick(k)}
                className={`inline-flex items-center gap-1 ${active ? 'text-foreground' : 'hover:text-foreground'}`}>
                <span>{label}</span>
                {active && (dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
            </button>
        </th>
    );
}

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
                        Pre-fills 6 default stages (New → Contacted → Qualified → Proposal → Won / Lost). Rename or delete any of them after creating.
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

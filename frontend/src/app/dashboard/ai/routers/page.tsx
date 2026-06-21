"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, ArrowRight, GitBranch } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import api from "@/lib/api";

interface Router {
    id: string;
    name: string;
    model: string;
    provider: { provider: string };
    routableAgentIds: string[];
    routerDescription: string | null;
    isActive: boolean;
    createdAt: string;
}

interface Agent {
    id: string;
    name: string;
}

export default function RoutersPage() {
    const navigate = useRouter();
    const [routers, setRouters] = useState<Router[]>([]);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [providers, setProviders] = useState<any[]>([]);
    const [aiModels, setAiModels] = useState<Record<string, string[]>>({});
    const [loading, setLoading] = useState(true);

    // Create modal
    const [open, setOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [name, setName] = useState("");
    const [providerId, setProviderId] = useState("");
    const [model, setModel] = useState("");
    const [targets, setTargets] = useState<string[]>([]);

    const load = async () => {
        setLoading(true);
        try {
            const [rRes, aRes, pRes, mRes] = await Promise.all([
                api.get('/agents', { params: { type: 'router' } }),
                api.get('/agents', { params: { type: 'ai' } }),
                api.get('/ai-providers'),
                api.get('/ai-providers/models').catch(() => ({ data: { success: false } })),
            ]);
            if (rRes.data.success) setRouters(rRes.data.agents);
            if (aRes.data.success) setAgents(aRes.data.agents);
            if (pRes.data.success) setProviders(pRes.data.providers);
            if (mRes.data?.success) setAiModels(mRes.data.models || {});
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const reset = () => { setName(""); setProviderId(""); setModel(""); setTargets([]); };

    const openCreate = () => {
        reset();
        if (providers[0]) setProviderId(providers[0].id);
        setOpen(true);
    };

    const submit = async () => {
        if (!name.trim() || !providerId || !model || targets.length === 0) {
            alert('Name, provider, model and at least one target agent are required.');
            return;
        }
        setSubmitting(true);
        try {
            const r = await api.post('/agents', {
                name: name.trim(),
                providerId,
                model,
                systemPrompt: 'You are the front-door router. Greet the customer warmly, find out which topic they need in ONE short question, then call handoffTo with the right agentId.',
                isRouter: true,
                routableAgentIds: targets,
            });
            if (r.data?.success) {
                setOpen(false);
                navigate.push(`/dashboard/ai/agents/${r.data.agent.id}`);
            }
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        } finally { setSubmitting(false); }
    };

    const remove = async (id: string, label: string) => {
        if (!confirm(`Delete router agent "${label}"? Contacts already routed by it stay assigned to their specialised agent.`)) return;
        try {
            await api.delete(`/agents/${id}`);
            await load();
        } catch (e: any) { alert(e.response?.data?.message || e.message); }
    };

    const availableModels = (): string[] => {
        const p = providers.find(p => p.id === providerId)?.provider;
        if (!p) return [];
        return aiModels[p] || [];
    };

    const toggleTarget = (id: string) => {
        setTargets(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    if (loading) {
        return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
                        <GitBranch className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">Router Agents</h1>
                        <p className="text-sm text-muted-foreground">
                            Front-door dispatchers. A router greets new contacts, identifies the topic, and binds them to a specialised AI agent.
                        </p>
                    </div>
                </div>
                <button onClick={openCreate}
                    className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-xl px-4 py-2 text-sm font-medium">
                    <Plus className="w-4 h-4" /> New router
                </button>
            </div>

            {agents.length === 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-sm text-amber-300">
                    Routers dispatch to regular AI Agents — create at least one AI Agent first under <Link href="/dashboard/ai/agents" className="underline">AI Agents</Link>.
                </div>
            )}

            {routers.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                    <GitBranch className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>No router agents yet.</p>
                </div>
            ) : (
                <div className="grid gap-3">
                    {routers.map(r => (
                        <div key={r.id} className="bg-card border border-border rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <Link href={`/dashboard/ai/agents/${r.id}`} className="font-semibold hover:text-primary">
                                        {r.name}
                                    </Link>
                                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                        router
                                    </span>
                                    {!r.isActive && (
                                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border">
                                            inactive
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                    {r.provider?.provider} · {r.model} · {r.routableAgentIds?.length || 0} target agent(s)
                                </p>
                                {r.routableAgentIds?.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {r.routableAgentIds.map(aid => {
                                            const a = agents.find(x => x.id === aid);
                                            return (
                                                <span key={aid} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-secondary/40 border border-border">
                                                    <ArrowRight className="w-2.5 h-2.5 text-muted-foreground" />
                                                    {a?.name || 'Unknown'}
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                <Link href={`/dashboard/ai/agents/${r.id}`}
                                    className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/50">
                                    Edit
                                </Link>
                                <button onClick={() => remove(r.id, r.name)}
                                    className="text-muted-foreground hover:text-red-400 p-1.5">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {open && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-card border border-border rounded-2xl p-5 w-full max-w-lg space-y-3">
                        <div className="flex items-center justify-between">
                            <h2 className="font-semibold">New router agent</h2>
                            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">✕</button>
                        </div>
                        <div className="space-y-2.5">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Name</label>
                                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Müraciət qəbulu"
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Provider</label>
                                    <select value={providerId} onChange={e => { setProviderId(e.target.value); setModel(''); }}
                                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm">
                                        <option value="">Select…</option>
                                        {providers.map(p => <option key={p.id} value={p.id}>{p.provider}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Model</label>
                                    <select value={model} onChange={e => setModel(e.target.value)}
                                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm">
                                        <option value="">Select…</option>
                                        {availableModels().map(m => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Can dispatch to</label>
                                <div className="mt-1 border border-border rounded-lg max-h-48 overflow-y-auto">
                                    {agents.length === 0 ? (
                                        <div className="p-3 text-xs text-muted-foreground">No AI agents — create some first.</div>
                                    ) : agents.map(a => (
                                        <label key={a.id} className="flex items-center gap-2 px-3 py-2 hover:bg-secondary/40 cursor-pointer text-sm">
                                            <input type="checkbox" checked={targets.includes(a.id)} onChange={() => toggleTarget(a.id)}
                                                className="w-3.5 h-3.5 accent-primary" />
                                            {a.name}
                                        </label>
                                    ))}
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-1">
                                    The router will only be able to hand contacts off to the agents you tick here.
                                </p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground px-3 py-2">Cancel</button>
                            <button onClick={submit} disabled={submitting || agents.length === 0}
                                className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-xs font-medium flex items-center gap-1.5 disabled:opacity-60">
                                {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                                Create router
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

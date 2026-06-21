"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";
import { GitBranch, Loader2, Save, ArrowLeft, Trash2, ArrowRight, Mic, Eye } from "lucide-react";

interface AgentRow { id: string; name: string; routerDescription?: string | null }
interface Provider { id: string; provider: string }

const WHISPER_LANGUAGES: Array<{ code: string; label: string }> = [
    { code: '',   label: 'Auto-detect' },
    { code: 'az', label: 'Azerbaijani' },
    { code: 'ru', label: 'Russian' },
    { code: 'tr', label: 'Turkish' },
    { code: 'en', label: 'English' },
    { code: 'uk', label: 'Ukrainian' },
    { code: 'ar', label: 'Arabic' },
    { code: 'fa', label: 'Persian' },
    { code: 'es', label: 'Spanish' },
    { code: 'fr', label: 'French' },
    { code: 'de', label: 'German' },
];

export default function RouterEditPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [notFound, setNotFound] = useState(false);

    const [name, setName] = useState("");
    const [providerId, setProviderId] = useState("");
    const [model, setModel] = useState("");
    const [systemPrompt, setSystemPrompt] = useState("");
    const [isActive, setIsActive] = useState(true);
    const [routableAgentIds, setRoutableAgentIds] = useState<string[]>([]);

    const [audioEnabled, setAudioEnabled] = useState(true);
    const [visionEnabled, setVisionEnabled] = useState(true);
    const [whisperLanguage, setWhisperLanguage] = useState("");
    const [whisperModel, setWhisperModel] = useState("whisper-1");
    const [historyDepth, setHistoryDepth] = useState(10);

    const [siblings, setSiblings] = useState<AgentRow[]>([]);
    const [providers, setProviders] = useState<Provider[]>([]);
    const [aiModels, setAiModels] = useState<Record<string, string[]>>({});

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [agentRes, sibRes, provRes, modelsRes] = await Promise.all([
                api.get(`/agents/${id}`),
                api.get('/agents', { params: { type: 'ai' } }),
                api.get('/ai-providers'),
                api.get('/ai-providers/models').catch(() => ({ data: { success: false } })),
            ]);
            if (!agentRes.data?.success) { setNotFound(true); return; }
            const a = agentRes.data.agent;
            if (!a.isRouter) {
                // Wrong page — bounce to the AI editor
                router.replace(`/dashboard/ai/agents/${id}`);
                return;
            }
            setName(a.name || "");
            setProviderId(a.providerId || "");
            setModel(a.model || "");
            setSystemPrompt(a.systemPrompt || "");
            setIsActive(a.isActive !== false);
            setRoutableAgentIds((a.routableAgentIds || []) as string[]);
            setAudioEnabled(a.audioEnabled !== false);
            setVisionEnabled(a.visionEnabled !== false);
            setWhisperLanguage(a.whisperLanguage || "");
            setWhisperModel(a.whisperModel || "whisper-1");
            setHistoryDepth(Number(a.historyDepth) || 10);

            if (sibRes.data?.success) setSiblings(sibRes.data.agents || []);
            if (provRes.data?.success) setProviders(provRes.data.providers || []);
            if (modelsRes.data?.success) setAiModels(modelsRes.data.models || {});
        } catch (e: any) {
            console.error(e);
            setNotFound(true);
        } finally { setLoading(false); }
    }, [id, router]);

    useEffect(() => { load(); }, [load]);

    const availableModels = (): string[] => {
        const p = providers.find(p => p.id === providerId)?.provider;
        if (!p) return [];
        return aiModels[p] || [];
    };

    const toggleTarget = (aid: string) => {
        setRoutableAgentIds(prev => prev.includes(aid) ? prev.filter(x => x !== aid) : [...prev, aid]);
    };

    const handleSave = async () => {
        if (!name.trim() || !providerId || !model) {
            alert('Name, provider and model are required.');
            return;
        }
        setSaving(true);
        try {
            await api.put(`/agents/${id}`, {
                name: name.trim(),
                providerId,
                model,
                systemPrompt,
                isActive,
                isRouter: true,
                routableAgentIds,
                audioEnabled,
                visionEnabled,
                whisperLanguage: whisperLanguage || null,
                whisperModel,
                historyDepth,
                // Router doesn't use these — explicitly pin them clean.
                skills: [],
                allowedTableIds: [],
                allowedUrls: [],
                httpTools: [],
                skillPrompts: {},
            });
            await load();
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        } finally { setSaving(false); }
    };

    const handleDelete = async () => {
        if (!confirm(`Delete router "${name}"? Contacts already routed by it stay assigned to their specialised agent.`)) return;
        try {
            await api.delete(`/agents/${id}`);
            router.push('/dashboard/ai/routers');
        } catch (e: any) { alert(e.response?.data?.message || e.message); }
    };

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
    if (notFound) return (
        <div className="text-center py-12">
            <p className="text-muted-foreground">Router agent not found.</p>
            <Link href="/dashboard/ai/routers" className="text-primary hover:underline text-sm mt-2 inline-block">
                ← Back to Router Agents
            </Link>
        </div>
    );

    return (
        <div className="max-w-4xl mx-auto space-y-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-3 min-w-0">
                    <Link href="/dashboard/ai/routers"
                        className="p-2 rounded-lg border border-border hover:bg-secondary/50 flex-shrink-0">
                        <ArrowLeft className="w-4 h-4" />
                    </Link>
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center flex-shrink-0">
                        <GitBranch className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h1 className="text-2xl font-bold truncate">{name || 'Router Agent'}</h1>
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                router
                            </span>
                            {!isActive && (
                                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border">
                                    inactive
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Front-door dispatcher. Greets new contacts and binds them to a specialised agent for everything that follows.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setIsActive(!isActive)}
                        className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${isActive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-secondary/40 text-muted-foreground border-border'}`}>
                        {isActive ? 'Active' : 'Inactive'}
                    </button>
                    <button onClick={handleSave} disabled={saving}
                        className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-1.5 disabled:opacity-60">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save
                    </button>
                </div>
            </div>

            {/* Basics */}
            <section className="bg-card border border-border rounded-2xl p-5 space-y-3">
                <div>
                    <label className="text-sm font-medium text-muted-foreground">Name</label>
                    <input value={name} onChange={e => setName(e.target.value)}
                        className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label className="text-sm font-medium text-muted-foreground">Provider</label>
                        <select value={providerId} onChange={e => { setProviderId(e.target.value); setModel(''); }}
                            className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm">
                            <option value="">Select…</option>
                            {providers.map(p => <option key={p.id} value={p.id}>{p.provider}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-sm font-medium text-muted-foreground">Model</label>
                        <select value={model} onChange={e => setModel(e.target.value)}
                            className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm">
                            <option value="">Select…</option>
                            {availableModels().map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </div>
                </div>
                <div>
                    <label className="text-sm font-medium text-muted-foreground">System prompt</label>
                    <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={6}
                        placeholder="You are the front-door router. Greet warmly, ask ONE short question to find out which topic the customer needs, then call handoffTo with the right agent."
                        className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm resize-none" />
                    <p className="text-[11px] text-muted-foreground mt-1">
                        The router automatically receives a list of every target agent + its routerDescription appended to this prompt, plus the handoffTo / unassignAgent tools. Keep this prompt short — just personality + tone.
                    </p>
                </div>
            </section>

            {/* Targets */}
            <section className="bg-amber-500/5 border border-amber-500/30 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <h2 className="text-sm font-semibold text-amber-300">Targets</h2>
                        <p className="text-xs text-muted-foreground">Specialised agents this router can dispatch contacts to.</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{routableAgentIds.length} selected</span>
                </div>
                {siblings.length === 0 ? (
                    <div className="text-xs text-muted-foreground p-3 bg-card rounded-lg border border-border">
                        No AI agents in this workspace yet. Create some under <Link href="/dashboard/ai/agents" className="underline">AI Agents</Link> first.
                    </div>
                ) : (
                    <div className="grid gap-2">
                        {siblings.map(s => {
                            const on = routableAgentIds.includes(s.id);
                            return (
                                <button key={s.id} type="button" onClick={() => toggleTarget(s.id)}
                                    className={`text-left flex items-start gap-3 p-3 rounded-xl border transition-colors ${on ? 'bg-amber-500/10 border-amber-500/40' : 'bg-card border-border hover:bg-secondary/30'}`}>
                                    <div className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${on ? 'bg-amber-500 border-amber-500' : 'border-border'}`}>
                                        {on && <ArrowRight className="w-3 h-3 text-white" />}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium">{s.name}</div>
                                        <div className="text-xs text-muted-foreground">{s.routerDescription || 'No description'}</div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* Multi-modal */}
            <section className="bg-card border border-border rounded-2xl p-5 space-y-3">
                <h2 className="text-sm font-semibold">Multi-modal input</h2>
                <div className="space-y-3">
                    <label className="flex items-start gap-3 cursor-pointer">
                        <input type="checkbox" checked={audioEnabled} onChange={e => setAudioEnabled(e.target.checked)}
                            className="w-4 h-4 mt-0.5 accent-primary rounded cursor-pointer" />
                        <div className="flex-1">
                            <div className="text-sm font-medium flex items-center gap-2"><Mic className="w-3.5 h-3.5" /> Listen to voice messages</div>
                            <div className="text-xs text-muted-foreground">
                                Voice notes are transcribed via Whisper before the router reads them. Requires an OpenAI provider in this workspace.
                            </div>
                        </div>
                    </label>
                    {audioEnabled && (
                        <div className="pl-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="text-[11px] font-medium text-muted-foreground">Transcription model</label>
                                <select value={whisperModel} onChange={e => setWhisperModel(e.target.value)}
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm">
                                    <option value="whisper-1">whisper-1 (cheapest)</option>
                                    <option value="gpt-4o-mini-transcribe">gpt-4o-mini-transcribe</option>
                                    <option value="gpt-4o-transcribe">gpt-4o-transcribe (most accurate)</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[11px] font-medium text-muted-foreground">Expected language</label>
                                <select value={whisperLanguage} onChange={e => setWhisperLanguage(e.target.value)}
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm">
                                    {WHISPER_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                                </select>
                            </div>
                        </div>
                    )}
                    <label className="flex items-start gap-3 cursor-pointer">
                        <input type="checkbox" checked={visionEnabled} onChange={e => setVisionEnabled(e.target.checked)}
                            className="w-4 h-4 mt-0.5 accent-primary rounded cursor-pointer" />
                        <div className="flex-1">
                            <div className="text-sm font-medium flex items-center gap-2"><Eye className="w-3.5 h-3.5" /> See images</div>
                            <div className="text-xs text-muted-foreground">
                                Photos are forwarded to the model as a native image part. Useful when the contact opens with a screenshot or document image.
                            </div>
                        </div>
                    </label>
                </div>
            </section>

            {/* History */}
            <section className="bg-card border border-border rounded-2xl p-5 space-y-2">
                <h2 className="text-sm font-semibold">History depth</h2>
                <div className="flex items-center gap-3">
                    <input type="number" min={1} max={50}
                        value={historyDepth}
                        onChange={e => setHistoryDepth(Math.max(1, Math.min(50, Number(e.target.value) || 10)))}
                        className="w-24 bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm" />
                    <p className="text-xs text-muted-foreground">
                        Number of recent messages the router sees per turn. Routers usually only need 2–5 since they decide on the first message.
                    </p>
                </div>
            </section>

            {/* Danger */}
            <section className="bg-card border border-red-500/30 rounded-2xl p-5">
                <h2 className="font-semibold text-red-400 mb-1">Danger zone</h2>
                <p className="text-xs text-muted-foreground mb-3">Removing this router unbinds it from every WhatsApp / Instagram channel. Contacts already routed stay on their assigned agents.</p>
                <button onClick={handleDelete}
                    className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-red-500/20 inline-flex items-center gap-1.5">
                    <Trash2 className="w-3.5 h-3.5" /> Delete router
                </button>
            </section>
        </div>
    );
}

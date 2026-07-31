"use client";

import { useEffect, useState } from "react";
import { Bot, Plus, Loader2, Trash2, Database, ShieldCheck, X, Wifi, WifiOff, MessageSquare, Copy, ClipboardPaste, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";

export default function AiAgentsPage() {
    const [agents, setAgents] = useState<any[]>([]);
    const [providers, setProviders] = useState<any[]>([]);
    const [tables, setTables] = useState<any[]>([]);
    const [aiModels, setAiModels] = useState<Record<string, string[]>>({});
    const [loading, setLoading] = useState(true);

    // Form modal state
    const router = useRouter();
    const [formOpen, setFormOpen] = useState(false);
    const [editingAgent, setEditingAgent] = useState<any>(null);
    const [submitting, setSubmitting] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [pasting, setPasting] = useState(false);

    // Form fields
    const [name, setName] = useState("");
    const [providerId, setProviderId] = useState("");
    const [model, setModel] = useState("");
    const [systemPrompt, setSystemPrompt] = useState("");
    const [allowedTableIds, setAllowedTableIds] = useState<string[]>([]);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const [agentsRes, provRes, tablesRes, modelsRes] = await Promise.all([
                api.get('/agents', { params: { type: 'ai' } }),
                api.get('/ai-providers'),
                api.get('/tables'),
                api.get('/ai-providers/models').catch(() => ({ data: { success: false } })),
            ]);
            if (agentsRes.data.success) setAgents(agentsRes.data.agents);
            if (provRes.data.success) setProviders(provRes.data.providers);
            if (tablesRes.data.success) setTables(tablesRes.data.tables);
            if (modelsRes.data?.success) setAiModels(modelsRes.data.models || {});
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const resetForm = () => {
        setName(""); setProviderId(""); setModel(""); setSystemPrompt(""); setAllowedTableIds([]);
        setEditingAgent(null);
    };

    const openCreate = () => {
        resetForm();
        setFormOpen(true);
    };

    const closeForm = () => {
        setFormOpen(false);
        resetForm();
    };

    const handleSubmit = async () => {
        if (!name || !providerId || !model) return alert("Please fill required fields (Name, Provider, Model)");
        setSubmitting(true);
        try {
            if (editingAgent) {
                await api.put(`/agents/${editingAgent.id}`, { name, providerId, model, systemPrompt, allowedTableIds });
            } else {
                await api.post('/agents', { name, providerId, model, systemPrompt, allowedTableIds, skills: [], allowedUrls: [] });
            }
            const reload = await api.get('/agents');
            setAgents(reload.data.agents);
            closeForm();
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this agent?')) return;
        try {
            await api.delete(`/agents/${id}`);
            setAgents(agents.filter(a => a.id !== id));
        } catch (err: any) {
            const body = err?.response?.data;
            if (err?.response?.status === 409 && body?.requiresConfirmation) {
                const list = (body.campaigns || []).map((c: any) => `• ${c.name} (${c.status})`).join('\n');
                const proceed = confirm(`${body.message}\n\nLinked campaigns:\n${list}\n\nDelete this agent anyway?`);
                if (!proceed) return;
                try {
                    await api.delete(`/agents/${id}?force=true`);
                    setAgents(agents.filter(a => a.id !== id));
                } catch (e: any) {
                    alert(e?.response?.data?.message || e.message);
                }
                return;
            }
            alert(body?.message || err.message || 'Delete failed');
        }
    };

    const toggleTable = (id: string) => {
        setAllowedTableIds(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
    };

    // Model catalogue is admin-managed (see /dashboard/admin/ai-models).
    // We load it from /ai-providers/models into `aiModels` and use it
    // to populate the dropdown for whichever provider is selected.
    const getAvailableModels = (): string[] => {
        const selectedProvider = providers.find(p => p.id === providerId)?.provider;
        if (!selectedProvider) return [];
        return aiModels[selectedProvider] || [];
    };

    // A provider with zero models on this plan is unusable — picking it
    // leaves the Model dropdown empty and the form unsubmittable. Hide
    // those so the list only shows what the workspace can actually run.
    // (Before the catalogue loads we show everything rather than flash
    // an empty list.)
    const catalogueLoaded = Object.keys(aiModels).length > 0;
    const usableProviders = catalogueLoaded
        ? providers.filter(p => (aiModels[p.provider] || []).length > 0)
        : providers;

    // ─── Copy / paste an agent ─────────────────────────────────────
    // Copy puts a self-contained JSON config on the clipboard; Paste
    // rebuilds it here. Because it travels as text it works between
    // accounts, not just workspaces. Ids are excluded server-side, so
    // the provider is re-bound and workspace-local references (tables,
    // routing targets) are left for the operator to re-pick.
    const copyAgent = async (agentId: string, agentName: string) => {
        try {
            const r = await api.get(`/agents/${agentId}/export`);
            if (!r.data?.success) throw new Error(r.data?.message || 'Export failed');
            await navigator.clipboard.writeText(JSON.stringify(r.data.export, null, 2));
            setCopiedId(agentId);
            setTimeout(() => setCopiedId(null), 2000);
        } catch (err: any) {
            alert(err.response?.data?.message || err.message || `Couldn't copy ${agentName}`);
        }
    };

    // Shared by the Paste button and the Ctrl/Cmd+V handler. `raw` comes
    // straight from the paste event when available — that path needs no
    // clipboard permission at all.
    const importFromText = async (raw: string) => {
        if (!raw.trim()) return;
        let parsed: any;
        try {
            parsed = JSON.parse(raw);
        } catch {
            alert("That isn't a valid agent config — copy one with the Copy button first.");
            return;
        }
        setPasting(true);
        try {
            const r = await api.post('/agents/import', parsed);
            if (r.data?.success) {
                const notes: string[] = r.data.notes || [];
                await loadData();
                if (notes.length) alert(`Agent imported.\n\n${notes.join('\n')}`);
            }
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        } finally { setPasting(false); }
    };

    const pasteAgent = async () => {
        let raw = '';
        try {
            raw = await navigator.clipboard.readText();
        } catch {
            // Firefox and Safari don't grant clipboard read without a
            // gesture-scoped permission — fall back to asking.
            raw = window.prompt('Paste the copied agent config here:') || '';
        }
        await importFromText(raw);
    };

    // Ctrl/Cmd+V anywhere on the page imports an agent, so copying from
    // one account and pasting into another needs no button hunting. We
    // stay out of the way when the user is typing in a field, and only
    // act on text that actually looks like an exported agent — otherwise
    // an ordinary paste would trigger an error dialog.
    useEffect(() => {
        const onPaste = (e: ClipboardEvent) => {
            if (formOpen || pasting) return;
            const el = document.activeElement as HTMLElement | null;
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
            const text = e.clipboardData?.getData('text') ?? '';
            if (!text.includes('alchatbot.agent')) return;
            e.preventDefault();
            importFromText(text);
        };
        window.addEventListener('paste', onPaste);
        return () => window.removeEventListener('paste', onPaste);
    }, [formOpen, pasting]);

    return (
        <div className="max-w-6xl mx-auto space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-foreground">AI Agents</h1>
                    <p className="text-muted-foreground mt-1">Design autonomous AI assistants and link them to WhatsApp</p>
                </div>
                {/* Split control: Create is the primary action, Paste
                    hangs off it so the two live together. Ctrl/Cmd+V
                    does the same thing without touching either. */}
                <div className="flex items-stretch rounded-xl overflow-hidden border border-primary/30">
                <button
                    onClick={openCreate}
                    className="bg-primary text-primary-foreground px-5 py-2.5 font-medium flex items-center gap-2 hover:bg-primary/90 transition-all active:scale-[0.98]"
                >
                    <Plus className="w-5 h-5" />
                    Create Agent
                </button>
                <button
                    onClick={pasteAgent}
                    disabled={pasting}
                    title="Paste an agent copied from any workspace or account (Ctrl+V works too)"
                    className="bg-primary/80 text-primary-foreground px-3 border-l border-primary-foreground/20 flex items-center hover:bg-primary transition-all disabled:opacity-60"
                >
                    {pasting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ClipboardPaste className="w-5 h-5" />}
                </button>
                </div>
            </div>

            {/* Create / Edit Modal */}
            <AnimatePresence>
                {formOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                        onClick={(e) => e.target === e.currentTarget && closeForm()}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="bg-card border border-border rounded-2xl p-6 shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
                        >
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-xl font-semibold flex items-center gap-2">
                                    <Bot className="w-6 h-6 text-primary" />
                                    {editingAgent ? 'Edit Agent' : 'Create Agent'}
                                </h2>
                                <button onClick={closeForm} className="p-2 hover:bg-secondary rounded-lg transition-colors">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="space-y-5">
                                <div>
                                    <label className="text-sm font-medium text-muted-foreground">Agent Name</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Sales Assistant"
                                        value={name}
                                        onChange={e => setName(e.target.value)}
                                        className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-sm font-medium text-muted-foreground">AI Provider</label>
                                        <select
                                            value={providerId}
                                            onChange={e => { setProviderId(e.target.value); setModel(''); }}
                                            className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                                        >
                                            <option value="" disabled>Select Provider</option>
                                            {usableProviders.map(p => (
                                                <option key={p.id} value={p.id}>{p.provider}</option>
                                            ))}
                                        </select>
                                        {catalogueLoaded && usableProviders.length === 0 && (
                                            <p className="text-[11px] text-amber-400 mt-1">
                                                No provider has models enabled on your plan. Ask an admin to allow models under Admin → Plans → AI models.
                                            </p>
                                        )}
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-muted-foreground">Model</label>
                                        <select
                                            value={model}
                                            onChange={e => setModel(e.target.value)}
                                            disabled={!providerId}
                                            className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                                        >
                                            <option value="" disabled>Select Model</option>
                                            {getAvailableModels().map(m => (
                                                <option key={m} value={m}>{m}</option>
                                            ))}
                                            {/* Legacy fallback so editing an old agent doesn't drop
                                                a model the admin has since removed from the catalogue. */}
                                            {model && !getAvailableModels().includes(model) && (
                                                <option value={model}>{model} (legacy)</option>
                                            )}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-sm font-medium text-muted-foreground">System Prompt (Instructions)</label>
                                    <textarea
                                        placeholder="You are a helpful sales assistant. Always greet the user."
                                        value={systemPrompt}
                                        onChange={e => setSystemPrompt(e.target.value)}
                                        rows={5}
                                        className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none text-sm"
                                    />
                                </div>

                                <div>
                                    <h3 className="font-semibold flex items-center gap-2 mb-2">
                                        <Database className="w-4 h-4 text-muted-foreground" />
                                        Knowledge Base Access
                                    </h3>
                                    <p className="text-sm text-muted-foreground mb-3">Select which data tables this agent can access.</p>

                                    {tables.length === 0 ? (
                                        <div className="bg-secondary/50 border border-dashed border-border rounded-xl p-4 text-center text-sm text-muted-foreground">
                                            No data tables created yet.
                                        </div>
                                    ) : (
                                        <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2">
                                            {tables.map(table => (
                                                <label key={table.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${allowedTableIds.includes(table.id) ? 'bg-primary/5 border-primary/30' : 'bg-card border-border hover:bg-secondary/50'}`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={allowedTableIds.includes(table.id)}
                                                        onChange={() => toggleTable(table.id)}
                                                        className="w-4 h-4 accent-primary rounded"
                                                    />
                                                    <div>
                                                        <div className="font-medium text-sm">{table.name}</div>
                                                        <div className="text-xs text-muted-foreground">{table.columns.length} columns</div>
                                                    </div>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-6 mt-6 border-t border-border/50">
                                <button onClick={closeForm} className="px-6 py-2.5 font-medium text-muted-foreground hover:bg-secondary rounded-xl transition-all">
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSubmit}
                                    disabled={submitting}
                                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-6 py-2.5 flex items-center gap-2 transition-all disabled:opacity-70"
                                >
                                    {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : editingAgent ? 'Save Changes' : 'Create Agent'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Agent List */}
            {loading ? (
                <div className="flex justify-center items-center h-48 border border-border border-dashed rounded-2xl">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
            ) : agents.length === 0 && !formOpen ? (
                <div className="flex flex-col items-center justify-center h-48 border border-border border-dashed rounded-2xl bg-card/50 text-center px-4">
                    <Bot className="w-12 h-12 text-muted-foreground mb-3 opacity-50" />
                    <h3 className="text-lg font-medium text-foreground">No AI Agents</h3>
                    <p className="text-muted-foreground text-sm max-w-sm mt-1">Build your first autonomous AI agent to handle conversations.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {agents.map(agent => (
                        <div
                            key={agent.id}
                            className="bg-card border border-border rounded-2xl p-6 shadow-sm hover:border-primary/50 transition-colors flex flex-col group cursor-pointer"
                            onClick={() => router.push(`/dashboard/ai/agents/${agent.id}`)}
                        >
                            <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-primary/10 text-primary rounded-xl">
                                        <Bot className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-foreground">{agent.name}</h3>
                                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                                            {agent.provider?.provider} &bull; {agent.model}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); copyAgent(agent.id, agent.name); }}
                                        title="Copy this agent's config — paste it into any workspace or account"
                                        className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg"
                                    >
                                        {copiedId === agent.id
                                            ? <Check className="w-4 h-4 text-emerald-400" />
                                            : <Copy className="w-4 h-4" />}
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleDelete(agent.id); }}
                                        className="p-2 text-destructive hover:bg-destructive/10 rounded-lg"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            <div className="mt-4 p-3 bg-secondary/30 rounded-xl text-sm text-foreground/80 border border-border/50 h-20 overflow-y-auto">
                                {agent.systemPrompt ? agent.systemPrompt : <span className="italic opacity-50">No system prompt provided.</span>}
                            </div>

                            {/* Connected Instances */}
                            {agent.instances && agent.instances.length > 0 && (
                                <div className="mt-4 flex flex-wrap gap-2">
                                    {agent.instances.map((inst: any) => (
                                        <div
                                            key={inst.id}
                                            className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border ${
                                                inst.status === 'CONNECTED'
                                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                                    : 'bg-secondary/50 text-muted-foreground border-border'
                                            }`}
                                        >
                                            {inst.status === 'CONNECTED' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                                            <MessageSquare className="w-3 h-3" />
                                            {inst.name}
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div className="mt-4 pt-4 border-t border-border flex items-center justify-between text-sm">
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-1.5 text-muted-foreground">
                                        <Database className="w-4 h-4" />
                                        <span>{agent.allowedTableIds.length} Data context(s)</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-muted-foreground">
                                        <MessageSquare className="w-4 h-4" />
                                        <span>{agent.instances?.length || 0} Instance(s)</span>
                                    </div>
                                </div>
                                <div className={`flex items-center gap-2 font-medium ${agent.isActive !== false ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                                    <ShieldCheck className="w-4 h-4" /> {agent.isActive !== false ? 'Active' : 'Inactive'}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

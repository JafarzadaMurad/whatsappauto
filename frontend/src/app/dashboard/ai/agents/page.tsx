"use client";

import { useEffect, useState } from "react";
import { Bot, Plus, Loader2, Trash2, Edit2, Play, Settings2, ShieldCheck, Fingerprint, Database } from "lucide-react";
import api from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";

export default function AiAgentsPage() {
    const [agents, setAgents] = useState<any[]>([]);
    const [providers, setProviders] = useState<any[]>([]);
    const [tables, setTables] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const [isCreating, setIsCreating] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Form state
    const [name, setName] = useState("");
    const [providerId, setProviderId] = useState("");
    const [model, setModel] = useState("");
    const [systemPrompt, setSystemPrompt] = useState("");
    const [allowedTableIds, setAllowedTableIds] = useState<string[]>([]);

    useEffect(() => {
        const loadData = async () => {
            try {
                const [agentsRes, provRes, tablesRes] = await Promise.all([
                    api.get('/agents'),
                    api.get('/ai-providers'),
                    api.get('/tables')
                ]);
                if (agentsRes.data.success) setAgents(agentsRes.data.agents);
                if (provRes.data.success) setProviders(provRes.data.providers);
                if (tablesRes.data.success) setTables(tablesRes.data.tables);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, []);

    const handleCreate = async () => {
        if (!name || !providerId || !model) return alert("Please fill required fields (Name, Provider, Model)");
        setSubmitting(true);
        try {
            const res = await api.post('/agents', {
                name,
                providerId,
                model,
                systemPrompt,
                allowedTableIds
            });
            if (res.data.success) {
                // To fetch the relationships (provider), just reload data cleanly
                const reload = await api.get('/agents');
                setAgents(reload.data.agents);
                setIsCreating(false);
                setName(""); setProviderId(""); setModel(""); setSystemPrompt(""); setAllowedTableIds([]);
            }
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
        } catch (err) {
            console.error(err);
        }
    };

    const toggleTable = (id: string) => {
        setAllowedTableIds(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
    };

    const getAvailableModels = () => {
        const selectedProvider = providers.find(p => p.id === providerId)?.provider;
        if (selectedProvider === 'OPENAI') return ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'];
        if (selectedProvider === 'CLAUDE') return ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'];
        if (selectedProvider === 'GEMINI') return ['gemini-1.5-pro', 'gemini-1.5-flash'];
        return [];
    };

    return (
        <div className="max-w-6xl mx-auto space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-foreground">AI Agents</h1>
                    <p className="text-muted-foreground mt-1">Design autonomous AI assistants and link them to WhatsApp</p>
                </div>
                <button
                    onClick={() => setIsCreating(true)}
                    className="bg-primary text-primary-foreground px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 hover:bg-primary/90 transition-all active:scale-[0.98]"
                >
                    <Plus className="w-5 h-5" />
                    Create Agent
                </button>
            </div>

            <AnimatePresence>
                {isCreating && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -10 }}
                        className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-8"
                    >
                        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                            <Bot className="w-6 h-6 text-primary" />
                            Agent Configuration
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
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
                                            onChange={e => {
                                                setProviderId(e.target.value);
                                                setModel(''); // reset model when provider changes
                                            }}
                                            className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                                        >
                                            <option value="" disabled>Select Provider</option>
                                            {providers.map(p => (
                                                <option key={p.id} value={p.id}>{p.provider}</option>
                                            ))}
                                        </select>
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
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-sm font-medium text-muted-foreground">System Prompt (Instructions)</label>
                                    <textarea
                                        placeholder="You are a helpful sales assistant. Always greet the user."
                                        value={systemPrompt}
                                        onChange={e => setSystemPrompt(e.target.value)}
                                        rows={4}
                                        className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none text-sm"
                                    />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h3 className="font-semibold text-lg flex items-center gap-2">
                                    <Database className="w-5 h-5 text-muted-foreground" />
                                    Knowledge Base Access
                                </h3>
                                <p className="text-sm text-muted-foreground mb-4">Select which custom data tables this agent can query autonomously.</p>

                                {tables.length === 0 ? (
                                    <div className="bg-secondary/50 border border-dashed border-border rounded-xl p-4 text-center text-sm text-muted-foreground">
                                        No data tables created yet.
                                    </div>
                                ) : (
                                    <div className="space-y-3 max-h-[250px] overflow-y-auto pr-2">
                                        {tables.map(table => (
                                            <label key={table.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${allowedTableIds.includes(table.id) ? 'bg-primary/5 border-primary/30' : 'bg-card border-border hover:bg-secondary/50'}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={allowedTableIds.includes(table.id)}
                                                    onChange={() => toggleTable(table.id)}
                                                    className="w-5 h-5 accent-primary rounded"
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
                            <button
                                onClick={() => setIsCreating(false)}
                                className="px-6 py-2.5 font-medium text-muted-foreground hover:bg-secondary rounded-xl transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreate}
                                disabled={submitting}
                                className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-6 py-2.5 flex items-center gap-2 transition-all disabled:opacity-70"
                            >
                                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Create Agent'}
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {loading ? (
                <div className="flex justify-center items-center h-48 border border-border border-dashed rounded-2xl">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
            ) : agents.length === 0 && !isCreating ? (
                <div className="flex flex-col items-center justify-center h-48 border border-border border-dashed rounded-2xl bg-card/50 text-center px-4">
                    <Bot className="w-12 h-12 text-muted-foreground mb-3 opacity-50" />
                    <h3 className="text-lg font-medium text-foreground">No AI Agents</h3>
                    <p className="text-muted-foreground text-sm max-w-sm mt-1">Build your first autonomous AI agent to handle conversations.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {agents.map(agent => (
                        <div key={agent.id} className="bg-card border border-border rounded-2xl p-6 shadow-sm hover:border-primary/50 transition-colors flex flex-col group">
                            <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-primary/10 text-primary rounded-xl">
                                        <Bot className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-foreground">{agent.name}</h3>
                                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                                            {agent.provider?.provider} • {agent.model}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => handleDelete(agent.id)} className="p-2 text-destructive hover:bg-destructive/10 rounded-lg">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            <div className="mt-4 p-3 bg-secondary/30 rounded-xl text-sm text-foreground/80 border border-border/50 h-20 overflow-y-auto">
                                {agent.systemPrompt ? agent.systemPrompt : <span className="italic opacity-50">No system prompt provided.</span>}
                            </div>

                            <div className="mt-4 pt-4 border-t border-border flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Database className="w-4 h-4" />
                                    <span>{agent.allowedTableIds.length} Data context(s)</span>
                                </div>
                                <div className="flex items-center gap-2 font-medium text-foreground">
                                    <ShieldCheck className="w-4 h-4 text-emerald-500" /> Active
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

"use client";

import { useEffect, useState, use } from "react";
import { ArrowLeft, Bot, Loader2, MessageSquare, BarChart3, Settings, Database, Wrench, Wifi, WifiOff, Power } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";
import { motion } from "framer-motion";

type Tab = "conversations" | "usage" | "settings";

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const [agent, setAgent] = useState<any>(null);
    const [providers, setProviders] = useState<any[]>([]);
    const [tables, setTables] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<Tab>("conversations");

    // Conversations state
    const [conversations, setConversations] = useState<any[]>([]);
    const [selectedJid, setSelectedJid] = useState<string | null>(null);
    const [chatMessages, setChatMessages] = useState<any[]>([]);
    const [loadingChat, setLoadingChat] = useState(false);

    // Stats state
    const [stats, setStats] = useState<any>(null);

    // Settings form
    const [name, setName] = useState("");
    const [providerId, setProviderId] = useState("");
    const [model, setModel] = useState("");
    const [systemPrompt, setSystemPrompt] = useState("");
    const [allowedTableIds, setAllowedTableIds] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                const [agentRes, provRes, tablesRes] = await Promise.all([
                    api.get(`/agents/${id}`),
                    api.get('/ai-providers'),
                    api.get('/tables')
                ]);
                if (agentRes.data.success) {
                    const a = agentRes.data.agent;
                    setAgent(a);
                    setName(a.name);
                    setProviderId(a.providerId);
                    setModel(a.model);
                    setSystemPrompt(a.systemPrompt || "");
                    setAllowedTableIds(a.allowedTableIds || []);
                }
                if (provRes.data.success) setProviders(provRes.data.providers);
                if (tablesRes.data.success) setTables(tablesRes.data.tables);
            } catch (err) { console.error(err); }
            finally { setLoading(false); }
        };
        load();
    }, [id]);

    useEffect(() => {
        if (tab === "conversations") loadConversations();
        if (tab === "usage") loadStats();
    }, [tab]);

    const loadConversations = async () => {
        try {
            const res = await api.get(`/agents/${id}/conversations`);
            if (res.data.success) setConversations(res.data.conversations);
        } catch (err) { console.error(err); }
    };

    const loadStats = async () => {
        try {
            const res = await api.get(`/agents/${id}/stats`);
            if (res.data.success) setStats(res.data);
        } catch (err) { console.error(err); }
    };

    const loadChat = async (jid: string) => {
        setSelectedJid(jid);
        setLoadingChat(true);
        try {
            const res = await api.get(`/agents/${id}/messages?remoteJid=${encodeURIComponent(jid)}`);
            if (res.data.success) setChatMessages(res.data.messages);
        } catch (err) { console.error(err); }
        finally { setLoadingChat(false); }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.put(`/agents/${id}`, { name, providerId, model, systemPrompt, allowedTableIds });
            const res = await api.get(`/agents/${id}`);
            if (res.data.success) setAgent(res.data.agent);
        } catch (err) { console.error(err); }
        finally { setSaving(false); }
    };

    const getAvailableModels = () => {
        const p = providers.find(p => p.id === providerId)?.provider;
        if (p === 'OPENAI') return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
        if (p === 'CLAUDE') return ['claude-sonnet-4-5-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'];
        if (p === 'GEMINI') return ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'];
        return [];
    };

    const toggleActive = async () => {
        try {
            await api.put(`/agents/${id}`, { name, providerId, model, systemPrompt, allowedTableIds, isActive: !agent.isActive });
            setAgent({ ...agent, isActive: !agent.isActive });
        } catch (err) { console.error(err); }
    };

    const formatJid = (jid: string) => {
        if (jid.includes('@lid')) return jid.split('@')[0].slice(-6) + '...';
        return jid.replace('@s.whatsapp.net', '');
    };

    const formatTokens = (n: number) => {
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
        if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
        return n.toString();
    };

    if (loading) return (
        <div className="flex justify-center items-center h-screen">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
    );
    if (!agent) return <div>Agent not found</div>;

    const tabs: { key: Tab; label: string; icon: any }[] = [
        { key: "conversations", label: "Conversations", icon: MessageSquare },
        { key: "usage", label: "Usage", icon: BarChart3 },
        { key: "settings", label: "Settings", icon: Settings },
    ];

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            {/* Header */}
            <div>
                <Link href="/dashboard/ai/agents" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back to Agents
                </Link>
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-primary/10 text-primary rounded-xl">
                        <Bot className="w-7 h-7" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">{agent.name}</h1>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                            {agent.provider?.provider} &bull; {agent.model}
                        </span>
                    </div>
                    <button
                        onClick={toggleActive}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border ${agent.isActive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20' : 'bg-secondary/50 text-muted-foreground border-border hover:bg-emerald-500/10 hover:text-emerald-400 hover:border-emerald-500/20'}`}
                    >
                        <Power className="w-4 h-4" />
                        {agent.isActive ? 'Active' : 'Inactive'}
                    </button>
                    {agent.instances?.length > 0 && (
                        <div className="flex gap-2 ml-4">
                            {agent.instances.map((inst: any) => (
                                <div key={inst.id} className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border ${inst.status === 'CONNECTED' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-secondary/50 text-muted-foreground border-border'}`}>
                                    {inst.status === 'CONNECTED' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                                    {inst.name}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-secondary/30 p-1 rounded-xl w-fit">
                {tabs.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.key ? 'bg-card text-foreground shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                        <t.icon className="w-4 h-4" /> {t.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            {tab === "conversations" && (
                <div className="flex gap-4 h-[600px]">
                    {/* Conversation List */}
                    <div className="w-72 flex-shrink-0 bg-card border border-border rounded-2xl overflow-y-auto">
                        <div className="p-3 border-b border-border">
                            <h3 className="font-semibold text-sm">Conversations</h3>
                        </div>
                        {conversations.length === 0 ? (
                            <div className="p-4 text-center text-sm text-muted-foreground">No conversations yet</div>
                        ) : conversations.map(conv => (
                            <button
                                key={conv.remoteJid}
                                onClick={() => loadChat(conv.remoteJid)}
                                className={`w-full text-left p-3 border-b border-border/50 hover:bg-secondary/30 transition-colors ${selectedJid === conv.remoteJid ? 'bg-secondary/50' : ''}`}
                            >
                                <div className="font-medium text-sm">{formatJid(conv.remoteJid)}</div>
                                <div className="flex items-center justify-between mt-1">
                                    <span className="text-xs text-muted-foreground">{conv.messageCount} messages</span>
                                    <span className="text-xs text-muted-foreground">{formatTokens(conv.totalTokens)} tokens</span>
                                </div>
                            </button>
                        ))}
                    </div>

                    {/* Chat Messages */}
                    <div className="flex-1 bg-card border border-border rounded-2xl overflow-y-auto">
                        {!selectedJid ? (
                            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                                Select a conversation
                            </div>
                        ) : loadingChat ? (
                            <div className="flex items-center justify-center h-full">
                                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : chatMessages.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                                No logged messages yet. Logs are recorded from now on.
                            </div>
                        ) : (
                            <div className="p-4 space-y-4">
                                {chatMessages.map((msg: any) => (
                                    <div key={msg.id} className="space-y-2">
                                        {/* User message */}
                                        <div className="flex justify-start">
                                            <div className="bg-secondary/50 rounded-xl px-4 py-2 max-w-[70%] text-sm">
                                                {msg.userMessage}
                                            </div>
                                        </div>
                                        {/* Tool calls */}
                                        {msg.toolCalls && (msg.toolCalls as any[]).length > 0 && (
                                            <div className="flex flex-wrap gap-1.5 pl-2">
                                                {(msg.toolCalls as any[]).map((tc: any, i: number) => (
                                                    <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                                        <Wrench className="w-3 h-3" />
                                                        {tc.toolName}
                                                        {tc.args?.column && <span className="opacity-70">({tc.args.column}: {tc.args.query})</span>}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        {/* Agent reply */}
                                        <div className="flex justify-end">
                                            <div className="bg-primary/10 border border-primary/20 rounded-xl px-4 py-2 max-w-[70%] text-sm">
                                                {msg.agentReply}
                                                <div className="text-[10px] text-muted-foreground mt-1 text-right">
                                                    {msg.promptTokens + msg.completionTokens} tokens &bull; {new Date(msg.createdAt).toLocaleTimeString()}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {tab === "usage" && (
                <div className="space-y-6">
                    {!stats ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
                    ) : (
                        <>
                            {/* Summary Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="bg-card border border-border rounded-2xl p-5">
                                    <div className="text-sm text-muted-foreground">Total Requests</div>
                                    <div className="text-3xl font-bold mt-1">{stats.totals.requestCount}</div>
                                </div>
                                <div className="bg-card border border-border rounded-2xl p-5">
                                    <div className="text-sm text-muted-foreground">Total Tokens</div>
                                    <div className="text-3xl font-bold mt-1">{formatTokens(stats.totals.totalTokens)}</div>
                                </div>
                                <div className="bg-card border border-border rounded-2xl p-5">
                                    <div className="text-sm text-muted-foreground">Prompt / Completion</div>
                                    <div className="text-xl font-bold mt-1">
                                        {formatTokens(stats.totals.promptTokens)} / {formatTokens(stats.totals.completionTokens)}
                                    </div>
                                </div>
                            </div>

                            {/* Provider Breakdown */}
                            <div className="bg-card border border-border rounded-2xl overflow-hidden">
                                <div className="p-4 border-b border-border">
                                    <h3 className="font-semibold">Usage by Provider</h3>
                                </div>
                                {stats.stats.length === 0 ? (
                                    <div className="p-6 text-center text-sm text-muted-foreground">No usage data yet</div>
                                ) : (
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-border text-muted-foreground">
                                                <th className="text-left p-3 font-medium">Provider</th>
                                                <th className="text-left p-3 font-medium">Model</th>
                                                <th className="text-right p-3 font-medium">Requests</th>
                                                <th className="text-right p-3 font-medium">Prompt</th>
                                                <th className="text-right p-3 font-medium">Completion</th>
                                                <th className="text-right p-3 font-medium">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {stats.stats.map((s: any, i: number) => (
                                                <tr key={i} className="border-b border-border/50 hover:bg-secondary/20">
                                                    <td className="p-3">
                                                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.provider === 'OPENAI' ? 'bg-green-500/10 text-green-400' : s.provider === 'CLAUDE' ? 'bg-orange-500/10 text-orange-400' : 'bg-blue-500/10 text-blue-400'}`}>
                                                            {s.provider}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 font-mono text-xs">{s.model}</td>
                                                    <td className="p-3 text-right">{s.requestCount}</td>
                                                    <td className="p-3 text-right">{formatTokens(s.promptTokens)}</td>
                                                    <td className="p-3 text-right">{formatTokens(s.completionTokens)}</td>
                                                    <td className="p-3 text-right font-semibold">{formatTokens(s.totalTokens)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}

            {tab === "settings" && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-card border border-border rounded-2xl p-6"
                >
                    <div className="space-y-5 max-w-2xl">
                        <div>
                            <label className="text-sm font-medium text-muted-foreground">Agent Name</label>
                            <input type="text" value={name} onChange={e => setName(e.target.value)}
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium text-muted-foreground">AI Provider</label>
                                <select value={providerId} onChange={e => { setProviderId(e.target.value); setModel(''); }}
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                                    <option value="" disabled>Select Provider</option>
                                    {providers.map(p => <option key={p.id} value={p.id}>{p.provider}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-muted-foreground">Model</label>
                                <select value={model} onChange={e => setModel(e.target.value)} disabled={!providerId}
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50">
                                    <option value="" disabled>Select Model</option>
                                    {getAvailableModels().map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="text-sm font-medium text-muted-foreground">System Prompt</label>
                            <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={6}
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none text-sm" />
                        </div>

                        <div>
                            <h3 className="font-semibold flex items-center gap-2 mb-2">
                                <Database className="w-4 h-4 text-muted-foreground" /> Knowledge Base
                            </h3>
                            {tables.length === 0 ? (
                                <div className="bg-secondary/50 border border-dashed border-border rounded-xl p-4 text-center text-sm text-muted-foreground">No data tables created yet.</div>
                            ) : (
                                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                    {tables.map(table => (
                                        <label key={table.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${allowedTableIds.includes(table.id) ? 'bg-primary/5 border-primary/30' : 'bg-card border-border hover:bg-secondary/50'}`}>
                                            <input type="checkbox" checked={allowedTableIds.includes(table.id)}
                                                onChange={() => setAllowedTableIds(prev => prev.includes(table.id) ? prev.filter(t => t !== table.id) : [...prev, table.id])}
                                                className="w-4 h-4 accent-primary rounded" />
                                            <div>
                                                <div className="font-medium text-sm">{table.name}</div>
                                                <div className="text-xs text-muted-foreground">{table.columns.length} columns</div>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>

                        <button onClick={handleSave} disabled={saving}
                            className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-6 py-2.5 flex items-center gap-2 transition-all disabled:opacity-70">
                            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Changes'}
                        </button>
                    </div>
                </motion.div>
            )}
        </div>
    );
}

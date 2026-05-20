"use client";

import { useEffect, useState, use } from "react";
import { ArrowLeft, Bot, Loader2, MessageSquare, BarChart3, Settings, Database, Wrench, Wifi, WifiOff, Power, Plus, Trash2, ChevronDown, ChevronRight, Sparkles, Play, Send, User } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";
import { motion } from "framer-motion";

type Tab = "conversations" | "usage" | "settings";

// Mirror of backend DEFAULT_SKILL_PROMPTS in src/modules/agent/ai.service.ts
const DEFAULT_SKILL_PROMPTS: Record<string, string> = {
    tables: 'You have access to data tables. Use listTables first, then searchTable or getTableRows.',
    crm: 'You can manage clients in the CRM. Use upsertClient to save/update contacts, getClient to look up, searchClients to find existing clients.',
    http: 'You can call external HTTP APIs via the dedicated tools listed below.',
    memory: 'You have memory tools to recall earlier parts of this conversation: conversationStats (overview), searchMessages (keyword search), getMessages (fetch a range by index), getMessagesAround (context around a match). Only call them when the user references earlier topics, contradicts something they said before, or you need older context. For simple greetings or new topics, do not call them.',
};

type ValueSpec =
    | { mode: "fixed"; value: string }
    | { mode: "ai"; description: string };

type NameValue = { name: string; value: ValueSpec };

type HttpAuth =
    | { type: "none" }
    | { type: "bearer"; token: string }
    | { type: "basic"; username: string; password: string };

type HttpToolTemplate = {
    id: string;
    name: string;
    description: string;
    inputMode?: "form" | "raw";
    rawRequest?: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: ValueSpec;
    auth?: HttpAuth;
    queryParams?: NameValue[];
    headers?: NameValue[];
    bodyType?: "none" | "json" | "raw";
    bodyParams?: NameValue[];
    rawBody?: ValueSpec;
};

const RAW_REQUEST_PLACEHOLDER = `POST https://api.example.com/orders
Content-Type: application/json
Authorization: Bearer {{API key from session}}

{
  "customer": "{{customer name from conversation}}",
  "quantity": {{quantity number}}
}`;

const newTool = (): HttpToolTemplate => ({
    id: Math.random().toString(36).slice(2),
    name: "newTool",
    description: "",
    inputMode: "form",
    rawRequest: "",
    method: "GET",
    url: { mode: "fixed", value: "" },
    auth: { type: "none" },
    queryParams: [],
    headers: [],
    bodyType: "none",
    bodyParams: [],
    rawBody: { mode: "fixed", value: "" }
});

// Value input: switchable between Fixed value and AI-described
function ValueInput({ spec, onChange, placeholder }: { spec: ValueSpec; onChange: (v: ValueSpec) => void; placeholder?: string }) {
    return (
        <div className="flex gap-1.5">
            <button
                type="button"
                onClick={() => onChange(spec.mode === "fixed" ? { mode: "ai", description: "" } : { mode: "fixed", value: "" })}
                title={spec.mode === "fixed" ? "Switch to AI-filled" : "Switch to fixed value"}
                className={`flex-shrink-0 flex items-center gap-1 px-2 rounded-lg border text-xs font-medium transition-colors ${spec.mode === "ai" ? "bg-amber-500/10 text-amber-400 border-amber-500/30" : "bg-secondary/50 text-muted-foreground border-border hover:text-foreground"}`}
            >
                {spec.mode === "ai" ? <><Sparkles className="w-3 h-3" /> AI</> : "Fixed"}
            </button>
            <input
                type="text"
                value={spec.mode === "fixed" ? spec.value : spec.description}
                onChange={e => onChange(spec.mode === "fixed" ? { mode: "fixed", value: e.target.value } : { mode: "ai", description: e.target.value })}
                placeholder={spec.mode === "ai" ? "Describe what AI should put here" : (placeholder || "")}
                className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
            />
        </div>
    );
}

function NameValueRows({ items, onChange, namePlaceholder }: { items: NameValue[]; onChange: (next: NameValue[]) => void; namePlaceholder: string }) {
    return (
        <div className="space-y-2">
            {items.map((it, i) => (
                <div key={i} className="flex gap-1.5 items-start">
                    <input
                        type="text"
                        value={it.name}
                        onChange={e => { const n = [...items]; n[i] = { ...it, name: e.target.value }; onChange(n); }}
                        placeholder={namePlaceholder}
                        className="w-40 flex-shrink-0 bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                    />
                    <div className="flex-1">
                        <ValueInput spec={it.value} onChange={v => { const n = [...items]; n[i] = { ...it, value: v }; onChange(n); }} placeholder="value" />
                    </div>
                    <button
                        type="button"
                        onClick={() => onChange(items.filter((_, j) => j !== i))}
                        className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Remove"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            ))}
            <button
                type="button"
                onClick={() => onChange([...items, { name: "", value: { mode: "fixed", value: "" } }])}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 border border-dashed border-border transition-colors"
            >
                <Plus className="w-3 h-3" /> Add
            </button>
        </div>
    );
}

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
    const [replyText, setReplyText] = useState("");
    const [sendingReply, setSendingReply] = useState(false);
    const [replyError, setReplyError] = useState<string | null>(null);

    // Stats state
    const [stats, setStats] = useState<any>(null);

    // Settings form
    const [name, setName] = useState("");
    const [providerId, setProviderId] = useState("");
    const [model, setModel] = useState("");
    const [systemPrompt, setSystemPrompt] = useState("");
    const [allowedTableIds, setAllowedTableIds] = useState<string[]>([]);
    const [skills, setSkills] = useState<string[]>([]);
    const [httpTools, setHttpTools] = useState<HttpToolTemplate[]>([]);
    const [expandedTool, setExpandedTool] = useState<string | null>(null);
    const [testStates, setTestStates] = useState<Record<string, { values: Record<string, string>; response: any; loading: boolean }>>({});
    const [skillPrompts, setSkillPrompts] = useState<Record<string, string>>({});
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
                    setSkills(a.skills || []);
                    setHttpTools(((a.httpTools as HttpToolTemplate[]) || []).map((t: any) => ({
                        ...t,
                        id: t.id || Math.random().toString(36).slice(2)
                    })));
                    setSkillPrompts((a.skillPrompts as Record<string, string>) || {});
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
        setReplyText("");
        setReplyError(null);
        try {
            const res = await api.get(`/agents/${id}/messages?remoteJid=${encodeURIComponent(jid)}`);
            if (res.data.success) setChatMessages(res.data.messages);
        } catch (err) { console.error(err); }
        finally { setLoadingChat(false); }
    };

    const sendReply = async () => {
        if (!selectedJid || !replyText.trim()) return;
        setSendingReply(true);
        setReplyError(null);
        try {
            const res = await api.post(`/agents/${id}/reply`, { remoteJid: selectedJid, text: replyText.trim() });
            if (res.data.success) {
                setChatMessages(prev => [...prev, res.data.message]);
                setReplyText("");
            } else {
                setReplyError(res.data.message || 'Failed to send');
            }
        } catch (err: any) {
            setReplyError(err.response?.data?.message || err.message || 'Failed to send');
        } finally {
            setSendingReply(false);
        }
    };

    // Collect AI-mode fields a test panel needs (URL, each AI query/header/body param, raw body)
    const aiFieldsOf = (tool: HttpToolTemplate): { key: string; label: string }[] => {
        const out: { key: string; label: string }[] = [];

        if (tool.inputMode === 'raw') {
            // Extract {{description}} placeholders from rawRequest
            const text = tool.rawRequest || '';
            const seen = new Set<string>();
            const re = /\{\{([^}]+)\}\}/g;
            let m: RegExpExecArray | null;
            let idx = 0;
            while ((m = re.exec(text)) !== null) {
                const desc = m[1].trim();
                if (seen.has(desc)) continue;
                seen.add(desc);
                out.push({ key: `ai_${idx}`, label: desc });
                idx++;
            }
            return out;
        }

        if (tool.url.mode === 'ai') out.push({ key: 'url', label: 'URL — ' + tool.url.description });
        (tool.queryParams || []).forEach(p => {
            if (p.value.mode === 'ai') out.push({ key: `query.${p.name}`, label: `?${p.name} — ${p.value.description}` });
        });
        (tool.headers || []).forEach(h => {
            if (h.value.mode === 'ai') out.push({ key: `header.${h.name}`, label: `${h.name}: — ${h.value.description}` });
        });
        if (tool.bodyType === 'json') {
            (tool.bodyParams || []).forEach(b => {
                if (b.value.mode === 'ai') out.push({ key: `body.${b.name}`, label: `body.${b.name} — ${b.value.description}` });
            });
        } else if (tool.bodyType === 'raw' && tool.rawBody?.mode === 'ai') {
            out.push({ key: 'body', label: 'Raw body — ' + tool.rawBody.description });
        }
        return out;
    };

    const runTest = async (tool: HttpToolTemplate) => {
        const current = testStates[tool.id] || { values: {}, response: null, loading: false };
        setTestStates(prev => ({ ...prev, [tool.id]: { ...current, loading: true } }));
        try {
            const res = await api.post(`/agents/test-http-tool`, { template: tool, aiValues: current.values });
            setTestStates(prev => ({ ...prev, [tool.id]: { ...current, loading: false, response: res.data.result ?? res.data } }));
        } catch (err: any) {
            setTestStates(prev => ({ ...prev, [tool.id]: { ...current, loading: false, response: { error: err.response?.data?.message || err.message } } }));
        }
    };

    const setTestValue = (toolId: string, key: string, value: string) => {
        setTestStates(prev => {
            const cur = prev[toolId] || { values: {}, response: null, loading: false };
            return { ...prev, [toolId]: { ...cur, values: { ...cur.values, [key]: value } } };
        });
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.put(`/agents/${id}`, {
                name, providerId, model, systemPrompt, allowedTableIds, skills,
                httpTools, skillPrompts
            });
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
            await api.put(`/agents/${id}`, { name, providerId, model, systemPrompt, allowedTableIds, skills, httpTools, skillPrompts, isActive: !agent.isActive });
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
            {tab === "conversations" && (() => {
                const convName = (conv: any) => conv?.username || conv?.name || formatJid(conv?.remoteJid || '');
                const selectedConv = conversations.find(c => c.remoteJid === selectedJid);
                const Avatar = ({ conv, size }: { conv: any; size: number }) => (
                    conv?.profilePic ? (
                        <img src={conv.profilePic} alt="" className="rounded-full object-cover flex-shrink-0"
                            style={{ width: size, height: size }}
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                        <div className="rounded-full bg-secondary flex items-center justify-center flex-shrink-0"
                            style={{ width: size, height: size }}>
                            <User className="text-muted-foreground" style={{ width: size * 0.55, height: size * 0.55 }} />
                        </div>
                    )
                );
                return (
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
                                className={`w-full text-left p-3 border-b border-border/50 hover:bg-secondary/30 transition-colors flex items-center gap-3 ${selectedJid === conv.remoteJid ? 'bg-secondary/50' : ''}`}
                            >
                                <Avatar conv={conv} size={40} />
                                <div className="min-w-0 flex-1">
                                    <div className="font-medium text-sm truncate">
                                        {conv.username ? '@' + conv.username : convName(conv)}
                                    </div>
                                    {conv.name && conv.username && (
                                        <div className="text-xs text-muted-foreground truncate">{conv.name}</div>
                                    )}
                                    <div className="flex items-center justify-between mt-1">
                                        <span className="text-xs text-muted-foreground">{conv.messageCount} msg</span>
                                        <span className="text-xs text-muted-foreground">{formatTokens(conv.totalTokens)} tok</span>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>

                    {/* Chat Messages */}
                    <div className="flex-1 bg-card border border-border rounded-2xl flex flex-col overflow-hidden">
                        {!selectedJid ? (
                            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                                Select a conversation
                            </div>
                        ) : (
                            <>
                                {/* Chat header */}
                                <div className="flex items-center gap-3 p-3 border-b border-border flex-shrink-0">
                                    <Avatar conv={selectedConv} size={36} />
                                    <div className="min-w-0">
                                        <div className="font-medium text-sm truncate">
                                            {selectedConv?.username ? '@' + selectedConv.username : convName(selectedConv)}
                                        </div>
                                        {selectedConv?.name && (
                                            <div className="text-xs text-muted-foreground truncate">{selectedConv.name}</div>
                                        )}
                                    </div>
                                </div>

                                {/* Messages */}
                                <div className="flex-1 overflow-y-auto">
                                    {loadingChat ? (
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
                                                    {/* User message — skipped for manual replies (empty userMessage) */}
                                                    {msg.userMessage && (
                                                        <div className="flex justify-start">
                                                            <div className="bg-secondary/50 rounded-xl px-4 py-2 max-w-[70%] text-sm">
                                                                {msg.userMessage}
                                                            </div>
                                                        </div>
                                                    )}
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
                                                    {/* Agent / manual reply */}
                                                    <div className="flex justify-end">
                                                        <div className="bg-primary/10 border border-primary/20 rounded-xl px-4 py-2 max-w-[70%] text-sm">
                                                            {msg.agentReply}
                                                            <div className="text-[10px] text-muted-foreground mt-1 text-right">
                                                                {msg.provider === 'MANUAL'
                                                                    ? 'Manual reply'
                                                                    : `${msg.promptTokens + msg.completionTokens} tokens`}
                                                                {' '}&bull;{' '}
                                                                {new Date(msg.createdAt).toLocaleTimeString()}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Reply box */}
                                <div className="border-t border-border p-3 flex-shrink-0">
                                    {replyError && (
                                        <div className="text-xs text-red-400 mb-2">{replyError}</div>
                                    )}
                                    {selectedJid.startsWith('ig:') ? (
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={replyText}
                                                onChange={e => setReplyText(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                                                placeholder="Type a reply…"
                                                maxLength={950}
                                                disabled={sendingReply}
                                                className="flex-1 bg-secondary/50 border border-border rounded-xl px-4 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60"
                                            />
                                            <button
                                                onClick={sendReply}
                                                disabled={sendingReply || !replyText.trim()}
                                                className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-4 flex items-center gap-2 text-sm font-medium transition-all disabled:opacity-50"
                                            >
                                                {sendingReply ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="text-xs text-muted-foreground text-center">
                                            Manual reply is available for Instagram conversations only.
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
                );
            })()}

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

                        {/* Memory — promoted out of Skills, lives right under System Prompt */}
                        <div className={`rounded-xl border ${skills.includes('memory') ? 'bg-primary/5 border-primary/30' : 'bg-card border-border'}`}>
                            <label className="flex items-center gap-3 p-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={skills.includes('memory')}
                                    onChange={() => setSkills(prev => prev.includes('memory') ? prev.filter(s => s !== 'memory') : [...prev, 'memory'])}
                                    className="w-4 h-4 accent-primary rounded"
                                />
                                <div className="flex-1">
                                    <div className="font-medium text-sm flex items-center gap-2">
                                        <MessageSquare className="w-4 h-4 text-muted-foreground" /> Memory
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        Agent looks back through prior messages on demand (search, range, stats). Default history shrinks to 3 turns and the model fetches older context only when needed — big token savings on long chats.
                                    </div>
                                </div>
                            </label>
                            {skills.includes('memory') && (
                                <div className="border-t border-border p-4">
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="text-xs font-medium text-muted-foreground">Memory Prompt</label>
                                        {(skillPrompts['memory'] || '').trim().length > 0 && (
                                            <button type="button"
                                                onClick={() => setSkillPrompts(prev => { const n = { ...prev }; delete n['memory']; return n; })}
                                                className="text-xs text-muted-foreground hover:text-red-400 transition-colors">
                                                Reset to default
                                            </button>
                                        )}
                                    </div>
                                    <textarea
                                        value={skillPrompts['memory'] ?? ''}
                                        onChange={e => setSkillPrompts(prev => ({ ...prev, memory: e.target.value }))}
                                        rows={5}
                                        placeholder={DEFAULT_SKILL_PROMPTS.memory}
                                        className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none text-sm" />
                                    {!(skillPrompts['memory'] || '').trim() && (
                                        <p className="text-[10px] text-muted-foreground mt-1 italic">Using default</p>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Skills — each card hosts its checkbox AND (when checked) its own panel */}
                        <div>
                            <h3 className="font-semibold flex items-center gap-2 mb-2">
                                <Wrench className="w-4 h-4 text-muted-foreground" /> Skills
                            </h3>
                            <p className="text-sm text-muted-foreground mb-3">Enable capabilities for this agent. Each enabled skill opens its own configuration panel below.</p>
                            <div className="space-y-3">
                                {[
                                    { id: 'crm', name: 'CRM Management', desc: 'Create/update clients, track statuses and tags' },
                                    { id: 'tables', name: 'Data Tables', desc: 'Query and search custom data tables' },
                                    { id: 'http', name: 'HTTP API Requests', desc: 'Call external APIs (GET/POST/etc) with custom headers and body' },
                                ].map(skill => {
                                    const enabled = skills.includes(skill.id);
                                    const promptVal = skillPrompts[skill.id] ?? '';
                                    const isOverridden = promptVal.trim().length > 0;
                                    return (
                                        <div key={skill.id} className={`rounded-xl border overflow-hidden ${enabled ? 'bg-primary/5 border-primary/30' : 'bg-card border-border'}`}>
                                            <label className="flex items-center gap-3 p-3 cursor-pointer">
                                                <input type="checkbox" checked={enabled}
                                                    onChange={() => setSkills(prev => prev.includes(skill.id) ? prev.filter(s => s !== skill.id) : [...prev, skill.id])}
                                                    className="w-4 h-4 accent-primary rounded" />
                                                <div className="flex-1">
                                                    <div className="font-medium text-sm">{skill.name}</div>
                                                    <div className="text-xs text-muted-foreground">{skill.desc}</div>
                                                </div>
                                            </label>
                                            {enabled && (
                                                <div className="border-t border-border p-4 space-y-4">
                                                    {/* Skill prompt override */}
                                                    <div>
                                                        <div className="flex items-center justify-between mb-1">
                                                            <label className="text-xs font-medium text-muted-foreground">{skill.name} Prompt</label>
                                                            {isOverridden && (
                                                                <button type="button"
                                                                    onClick={() => setSkillPrompts(prev => { const n = { ...prev }; delete n[skill.id]; return n; })}
                                                                    className="text-xs text-muted-foreground hover:text-red-400 transition-colors">
                                                                    Reset to default
                                                                </button>
                                                            )}
                                                        </div>
                                                        <textarea
                                                            value={promptVal}
                                                            onChange={e => setSkillPrompts(prev => ({ ...prev, [skill.id]: e.target.value }))}
                                                            rows={3}
                                                            placeholder={DEFAULT_SKILL_PROMPTS[skill.id]}
                                                            className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none text-sm" />
                                                        {!isOverridden && (
                                                            <p className="text-[10px] text-muted-foreground mt-1 italic">Using default</p>
                                                        )}
                                                    </div>

                                                    {/* Tables-specific: knowledge base selector */}
                                                    {skill.id === 'tables' && (
                                                        <div>
                                                            <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-2">
                                                                <Database className="w-3.5 h-3.5" /> Knowledge Base
                                                            </div>
                                                            {tables.length === 0 ? (
                                                                <div className="bg-secondary/50 border border-dashed border-border rounded-xl p-3 text-center text-xs text-muted-foreground">No data tables created yet.</div>
                                                            ) : (
                                                                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                                                    {tables.map(table => (
                                                                        <label key={table.id} className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${allowedTableIds.includes(table.id) ? 'bg-primary/5 border-primary/30' : 'bg-card border-border hover:bg-secondary/50'}`}>
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
                                                    )}

                                                    {/* HTTP-specific: tools manager */}
                                                    {skill.id === 'http' && (
                                                        <div>
                                                            <div className="flex items-center justify-between mb-2">
                                                                <div className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                                                                    <Wrench className="w-3.5 h-3.5" /> HTTP Tools
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => { const t = newTool(); setHttpTools([...httpTools, t]); setExpandedTool(t.id); }}
                                                                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                                                                >
                                                                    <Plus className="w-3 h-3" /> Add Tool
                                                                </button>
                                                            </div>
                                                            <p className="text-xs text-muted-foreground mb-2">
                                                                Each value can be a <span className="text-foreground">fixed</span> value or <span className="text-amber-400">AI-filled</span> at call time.
                                                            </p>
                            <div className="space-y-2">
                                {httpTools.length === 0 && (
                                    <div className="bg-secondary/30 border border-dashed border-border rounded-xl p-4 text-center text-sm text-muted-foreground">
                                        No custom HTTP tools yet. Click "Add Tool" to create one.
                                    </div>
                                )}
                                {httpTools.map((tool, idx) => {
                                    const isOpen = expandedTool === tool.id;
                                    const update = (patch: Partial<HttpToolTemplate>) => {
                                        const next = [...httpTools];
                                        next[idx] = { ...tool, ...patch };
                                        setHttpTools(next);
                                    };
                                    const remove = () => setHttpTools(httpTools.filter(t => t.id !== tool.id));

                                    return (
                                        <div key={tool.id} className="bg-card border border-border rounded-xl overflow-hidden">
                                            <div className="flex items-center gap-2 p-3 hover:bg-secondary/30 cursor-pointer" onClick={() => setExpandedTool(isOpen ? null : tool.id)}>
                                                {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                                                <span className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded ${tool.method === 'GET' ? 'bg-emerald-500/10 text-emerald-400' : tool.method === 'POST' ? 'bg-blue-500/10 text-blue-400' : tool.method === 'DELETE' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                                    {tool.method}
                                                </span>
                                                <span className="font-medium text-sm flex-1">{tool.name || <span className="text-muted-foreground italic">unnamed</span>}</span>
                                                <span className="text-xs text-muted-foreground truncate max-w-[40%] font-mono">
                                                    {tool.url.mode === 'fixed' ? tool.url.value : `[AI] ${tool.url.description}`}
                                                </span>
                                                <button type="button" onClick={(e) => { e.stopPropagation(); remove(); }} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                            {isOpen && (
                                                <div className="p-4 border-t border-border space-y-4">
                                                    {/* Name + Method */}
                                                    <div className="grid grid-cols-3 gap-3">
                                                        <div className="col-span-2">
                                                            <label className="text-xs font-medium text-muted-foreground">Tool Name</label>
                                                            <input type="text" value={tool.name} onChange={e => update({ name: e.target.value })}
                                                                placeholder="getWeather"
                                                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono" />
                                                        </div>
                                                        <div>
                                                            <label className="text-xs font-medium text-muted-foreground">Method</label>
                                                            <select value={tool.method} onChange={e => update({ method: e.target.value as any })}
                                                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                                                                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m} value={m}>{m}</option>)}
                                                            </select>
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Description (when AI should use this)</label>
                                                        <textarea value={tool.description} onChange={e => update({ description: e.target.value })} rows={2}
                                                            placeholder="Fetches the current weather for a given city"
                                                            className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
                                                    </div>

                                                    {/* Mode toggle: Form (structured) vs Raw (text) */}
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Input Mode</label>
                                                        <div className="mt-1 flex gap-1 bg-secondary/30 p-1 rounded-lg w-fit">
                                                            {(['form', 'raw'] as const).map(m => (
                                                                <button
                                                                    key={m}
                                                                    type="button"
                                                                    onClick={() => update({ inputMode: m })}
                                                                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${(tool.inputMode || 'form') === m ? 'bg-card text-foreground border border-border' : 'text-muted-foreground hover:text-foreground'}`}
                                                                >
                                                                    {m === 'form' ? 'Form (structured)' : 'Raw (text)'}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Raw mode: single textarea with {{description}} placeholders */}
                                                    {tool.inputMode === 'raw' && (
                                                        <div>
                                                            <label className="text-xs font-medium text-muted-foreground">Raw HTTP Request</label>
                                                            <p className="text-xs text-muted-foreground mt-0.5 mb-1">
                                                                Format: <code className="bg-secondary px-1 rounded">METHOD URL</code>, then headers, blank line, then body. Use <code className="bg-secondary px-1 rounded text-amber-400">{`{{description}}`}</code> anywhere to mark an AI-filled placeholder.
                                                            </p>
                                                            <textarea
                                                                value={tool.rawRequest || ''}
                                                                onChange={e => update({ rawRequest: e.target.value })}
                                                                rows={10}
                                                                placeholder={RAW_REQUEST_PLACEHOLDER}
                                                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y font-mono"
                                                            />
                                                        </div>
                                                    )}

                                                    {tool.inputMode !== 'raw' && (
                                                    <>
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">URL</label>
                                                        <div className="mt-1">
                                                            <ValueInput spec={tool.url} onChange={v => update({ url: v })} placeholder="https://api.example.com/data" />
                                                        </div>
                                                    </div>

                                                    {/* Authentication */}
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Authentication</label>
                                                        <select
                                                            value={tool.auth?.type || 'none'}
                                                            onChange={e => {
                                                                const t = e.target.value;
                                                                if (t === 'none') update({ auth: { type: 'none' } });
                                                                else if (t === 'bearer') update({ auth: { type: 'bearer', token: '' } });
                                                                else update({ auth: { type: 'basic', username: '', password: '' } });
                                                            }}
                                                            className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                                                            <option value="none">None</option>
                                                            <option value="bearer">Bearer Token</option>
                                                            <option value="basic">Basic Auth</option>
                                                        </select>
                                                        {tool.auth?.type === 'bearer' && (
                                                            <input type="password" value={tool.auth.token} onChange={e => update({ auth: { type: 'bearer', token: e.target.value } })}
                                                                placeholder="token..."
                                                                className="mt-2 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono" />
                                                        )}
                                                        {tool.auth?.type === 'basic' && (
                                                            <div className="mt-2 grid grid-cols-2 gap-2">
                                                                <input type="text" value={tool.auth.username} onChange={e => update({ auth: { type: 'basic', username: e.target.value, password: tool.auth && tool.auth.type === 'basic' ? tool.auth.password : '' } })}
                                                                    placeholder="username"
                                                                    className="bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                                                <input type="password" value={tool.auth.password} onChange={e => update({ auth: { type: 'basic', username: tool.auth && tool.auth.type === 'basic' ? tool.auth.username : '', password: e.target.value } })}
                                                                    placeholder="password"
                                                                    className="bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Query Parameters */}
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Query Parameters</label>
                                                        <div className="mt-1">
                                                            <NameValueRows items={tool.queryParams || []} onChange={v => update({ queryParams: v })} namePlaceholder="param name" />
                                                        </div>
                                                    </div>

                                                    {/* Headers */}
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Headers</label>
                                                        <div className="mt-1">
                                                            <NameValueRows items={tool.headers || []} onChange={v => update({ headers: v })} namePlaceholder="Header-Name" />
                                                        </div>
                                                    </div>

                                                    {/* Body */}
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Body</label>
                                                        <select
                                                            value={tool.bodyType || 'none'}
                                                            onChange={e => update({ bodyType: e.target.value as any })}
                                                            className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                                                            <option value="none">None</option>
                                                            <option value="json">JSON (fields)</option>
                                                            <option value="raw">Raw text</option>
                                                        </select>
                                                        {tool.bodyType === 'json' && (
                                                            <div className="mt-2">
                                                                <NameValueRows items={tool.bodyParams || []} onChange={v => update({ bodyParams: v })} namePlaceholder="field name" />
                                                            </div>
                                                        )}
                                                        {tool.bodyType === 'raw' && (
                                                            <div className="mt-2">
                                                                <ValueInput spec={tool.rawBody || { mode: 'fixed', value: '' }} onChange={v => update({ rawBody: v })} placeholder='{"key":"value"}' />
                                                            </div>
                                                        )}
                                                    </div>
                                                    </>
                                                    )}

                                                    {/* Test Panel */}
                                                    <div className="pt-3 mt-2 border-t border-dashed border-border">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <h4 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
                                                                <Play className="w-3.5 h-3.5" /> Test this tool
                                                            </h4>
                                                            <button
                                                                type="button"
                                                                onClick={() => runTest(tool)}
                                                                disabled={testStates[tool.id]?.loading}
                                                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-60"
                                                            >
                                                                {testStates[tool.id]?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                                                                Run Test
                                                            </button>
                                                        </div>

                                                        {(() => {
                                                            const aiFields = aiFieldsOf(tool);
                                                            if (aiFields.length === 0) {
                                                                return <p className="text-xs text-muted-foreground">All values are fixed — nothing to fill in. Click "Run Test".</p>;
                                                            }
                                                            return (
                                                                <div className="space-y-2">
                                                                    <p className="text-xs text-muted-foreground">Provide test values for AI-filled fields:</p>
                                                                    {aiFields.map(f => (
                                                                        <div key={f.key}>
                                                                            <label className="text-xs text-muted-foreground block mb-0.5">{f.label}</label>
                                                                            <input
                                                                                type="text"
                                                                                value={testStates[tool.id]?.values?.[f.key] || ''}
                                                                                onChange={e => setTestValue(tool.id, f.key, e.target.value)}
                                                                                placeholder="test value"
                                                                                className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                                                                            />
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            );
                                                        })()}

                                                        {testStates[tool.id]?.response && (
                                                            <div className="mt-3">
                                                                <div className="flex items-center gap-2 mb-1.5">
                                                                    <span className="text-xs text-muted-foreground">Response:</span>
                                                                    {testStates[tool.id].response.status !== undefined && (
                                                                        <span className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded ${testStates[tool.id].response.status >= 200 && testStates[tool.id].response.status < 300 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                                                            {testStates[tool.id].response.status}
                                                                        </span>
                                                                    )}
                                                                    {testStates[tool.id].response.error && (
                                                                        <span className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">error</span>
                                                                    )}
                                                                </div>
                                                                <pre className="bg-secondary/50 border border-border rounded-lg p-3 text-xs font-mono overflow-auto max-h-64 whitespace-pre-wrap break-all">
{typeof testStates[tool.id].response.data === 'object'
    ? JSON.stringify(testStates[tool.id].response.data, null, 2)
    : (testStates[tool.id].response.data ?? testStates[tool.id].response.error ?? '')}
                                                                </pre>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
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

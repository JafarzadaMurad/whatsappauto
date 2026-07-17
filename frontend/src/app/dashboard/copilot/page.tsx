"use client";

// Full-page copilot — same conversation, tools, socket wiring, and
// pickers as the floating bubble panel. Uses the shared Zustand
// store so a chat started in the bubble continues here and vice
// versa. Layout is wider so long tool-heavy conversations breathe.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Sparkles, Send, Mic, MicOff, Loader2, ArrowUpRight, Coins, RefreshCw, MessageSquare } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";
import { createSocket } from "@/lib/socket";
import { useCopilotStore } from "@/store/copilotStore";
import { useCopilotVoice } from "@/components/copilot/useCopilotVoice";

const ENTITY_PATH: Record<string, string> = {
    agents: "/dashboard/ai/agents",
    "ai-providers": "/dashboard/ai/providers",
    instances: "/dashboard/whatsapp",
    messages: "/dashboard/inbox",
    campaigns: "/dashboard/campaigns",
    automations: "/dashboard/automations",
    tables: "/dashboard/ai/tables",
    "user-fields": "/dashboard/contacts",
    clients: "/dashboard/contacts",
    webhooks: "/dashboard/webhooks",
    "api-keys": "/dashboard/api-keys",
    instagram: "/dashboard/instagram",
};

const LANGUAGE_OPTIONS: { code: string; label: string }[] = [
    { code: "", label: "Auto (match user)" },
    { code: "English", label: "English" },
    { code: "Azerbaijani", label: "Azərbaycan" },
    { code: "Russian", label: "Русский" },
    { code: "Turkish", label: "Türkçe" },
];

type ModelOption = { provider: string; model: string };
type CopilotConfig = {
    enabled: boolean;
    voiceEnabled: boolean;
    availableModels: ModelOption[];
    defaultProvider?: string;
    defaultModel?: string;
    reason?: string | null;
};

export default function CopilotFullPage() {
    const router = useRouter();
    const {
        isSending, voiceActive, sessionId, messages, actions, draft,
        provider, model, language,
        setDraft, setSending, setSession, pushMessage, pushAction,
        setProvider, setModel, setLanguage, reset,
    } = useCopilotStore();

    const [config, setConfig] = useState<CopilotConfig | null>(null);
    const [balance, setBalance] = useState<{ remaining: number; totalBudget: number } | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const { start: startVoice, stop: stopVoice } = useCopilotVoice({
        onError: (message) => {
            pushMessage({
                role: 'assistant',
                content: `⚠️ Voice session failed: ${message}`,
                at: new Date().toISOString(),
            });
        },
    });

    useEffect(() => {
        (async () => {
            try {
                const [cfgRes, balRes] = await Promise.all([
                    api.get('/copilot/config').catch(() => null),
                    api.get('/credits/balance').catch(() => null),
                ]);
                if (cfgRes?.data?.success) {
                    setConfig({
                        enabled: cfgRes.data.enabled,
                        voiceEnabled: cfgRes.data.voiceEnabled,
                        availableModels: cfgRes.data.availableModels || [],
                        defaultProvider: cfgRes.data.defaultProvider,
                        defaultModel: cfgRes.data.defaultModel,
                        reason: cfgRes.data.reason,
                    });
                    if (!provider && cfgRes.data.defaultProvider) setProvider(cfgRes.data.defaultProvider);
                    if (!model && cfgRes.data.defaultModel) setModel(cfgRes.data.defaultModel);
                }
                if (balRes?.data?.success) setBalance({
                    remaining: balRes.data.balance.remaining,
                    totalBudget: balRes.data.balance.totalBudget,
                });
            } catch { /* silent */ }
        })();
        // Poll the balance every 20s so the header tick reflects voice
        // sessions running in the background (voice bills only on end).
        const timer = setInterval(() => {
            api.get('/credits/balance').then(r => {
                if (r.data.success) setBalance({
                    remaining: r.data.balance.remaining,
                    totalBudget: r.data.balance.totalBudget,
                });
            }).catch(() => {});
        }, 20_000);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Socket wiring — full-page also listens for copilot.action + navigate
    // so tool-driven mutations still light up the actions column and
    // navigate_to still moves the user to the requested page.
    useEffect(() => {
        if (!config?.enabled) return;
        const socket = createSocket({});
        socket.on('copilot.action', (ev: any) => {
            pushAction({ tool: ev.tool, entity: ev.entity, verb: ev.verb, title: ev.title || '', id: ev.id || null, at: ev.at });
        });
        socket.on('copilot.navigate', (ev: any) => {
            const path = String(ev?.path || '');
            if (path.startsWith('/dashboard')) router.push(path);
        });
        return () => { socket.disconnect(); };
    }, [config?.enabled, pushAction, router]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, actions]);

    const send = async () => {
        const text = draft.trim();
        if (!text || isSending) return;
        setSending(true);
        pushMessage({ role: 'user', content: text, at: new Date().toISOString() });
        setDraft('');
        try {
            const res = await api.post('/copilot/chat', {
                sessionId: sessionId || undefined,
                message: text,
                currentPath: '/dashboard/copilot',
                provider: provider || undefined,
                model: model || undefined,
                language: language || undefined,
            });
            if (res.data.success) {
                if (!sessionId) setSession(res.data.sessionId);
                pushMessage({
                    role: 'assistant',
                    content: res.data.reply || '(no reply)',
                    toolCalls: res.data.toolCalls,
                    at: new Date().toISOString(),
                });
                api.get('/credits/balance').then(r => {
                    if (r.data.success) setBalance({
                        remaining: r.data.balance.remaining,
                        totalBudget: r.data.balance.totalBudget,
                    });
                }).catch(() => {});
            } else {
                pushMessage({ role: 'assistant', content: res.data.message || 'Something went wrong.', at: new Date().toISOString() });
            }
        } catch (err: any) {
            const status = err.response?.status;
            const data = err.response?.data;
            if (status === 402 && data?.code === 'credits_exhausted') {
                pushMessage({
                    role: 'assistant',
                    content: `⚠️ You've used all ${data.totalBudget?.toLocaleString?.() || 'your'} credits for this period. Upgrade your plan or wait for the reset on ${data.periodResetAt ? new Date(data.periodResetAt).toLocaleDateString() : 'next cycle'} to continue.`,
                    at: new Date().toISOString(),
                });
                setBalance({ remaining: 0, totalBudget: data.totalBudget || 0 });
            } else {
                pushMessage({
                    role: 'assistant',
                    content: data?.message || err.message || 'Request failed.',
                    at: new Date().toISOString(),
                });
            }
        } finally { setSending(false); }
    };

    const onKey = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    };

    const suggestions = useMemo(() => [
        "Neçə WhatsApp instance-ım var?",
        "Sales adında yeni bir agent yarat Claude Sonnet ilə",
        "Contacts səhifəsinə keç",
        "Son 5 kampaniyanı göstər",
    ], []);

    if (config && !config.enabled) {
        return (
            <div className="max-w-3xl mx-auto p-8 text-center space-y-4">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary mx-auto">
                    <Bot className="w-7 h-7" />
                </div>
                <h1 className="text-xl font-semibold">Copilot is not enabled on your plan</h1>
                <p className="text-sm text-muted-foreground">
                    The in-app copilot is a Pro+ feature. Upgrade your plan to talk to your workspace by text or voice.
                </p>
                <Link href="/dashboard/billing"
                    className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-5 py-2.5 text-sm">
                    Upgrade plan <ArrowUpRight className="w-4 h-4" />
                </Link>
            </div>
        );
    }

    return (
        <div className="h-[calc(100vh-8rem)] max-w-7xl mx-auto flex gap-4">
            {/* Main chat column */}
            <div className="flex-1 flex flex-col bg-card border border-border rounded-2xl overflow-hidden">
                {/* Toolbar */}
                <div className="flex items-center justify-between p-4 border-b border-border bg-secondary/30 flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/15 text-primary rounded-xl"><Bot className="w-5 h-5" /></div>
                        <div>
                            <h1 className="font-semibold">Copilot</h1>
                            {balance && (
                                <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                                    <Coins className="w-3 h-3 text-amber-400" />
                                    {balance.remaining.toLocaleString()} credits left
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <select value={model || ''}
                            onChange={e => {
                                const next = e.target.value;
                                setModel(next);
                                const found = config?.availableModels?.find(m => m.model === next);
                                if (found) setProvider(found.provider);
                            }}
                            className="bg-secondary/60 border border-border rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50">
                            {(config?.availableModels || []).map(m => (
                                <option key={`${m.provider}|${m.model}`} value={m.model} className="bg-card">
                                    {m.model}
                                </option>
                            ))}
                        </select>
                        <select value={language || ''}
                            onChange={e => setLanguage(e.target.value || null)}
                            className="bg-secondary/60 border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50">
                            {LANGUAGE_OPTIONS.map(l => (
                                <option key={l.code} value={l.code} className="bg-card">{l.label}</option>
                            ))}
                        </select>
                        <button onClick={reset}
                            title="Start a new conversation"
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Messages */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
                    {messages.length === 0 && (
                        <div className="text-center py-16 space-y-4">
                            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary">
                                <Sparkles className="w-8 h-8" />
                            </div>
                            <div>
                                <p className="text-lg font-medium">How can I help?</p>
                                <p className="text-sm text-muted-foreground mt-1">
                                    Ask me to list, create, or update anything in your workspace — by text or voice.
                                </p>
                            </div>
                            <div className="flex flex-col items-center gap-2 pt-4 max-w-md mx-auto">
                                {suggestions.map(q => (
                                    <button key={q} onClick={() => setDraft(q)}
                                        className="w-full text-left px-4 py-2 rounded-xl bg-secondary/40 hover:bg-secondary text-sm text-muted-foreground hover:text-foreground transition-colors">
                                        {q}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {messages.map((m, i) => (
                        <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
                                m.role === 'user'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-secondary/60 text-foreground'
                            }`}>
                                {m.content}
                                {m.toolCalls && m.toolCalls.length > 0 && (
                                    <div className="mt-2 space-y-1">
                                        {m.toolCalls.map((tc, j) => (
                                            <div key={j} className="text-[10px] font-mono text-muted-foreground bg-background/40 rounded px-1.5 py-0.5">
                                                <span className="text-primary">▸</span> {tc.name}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}

                    {isSending && (
                        <div className="flex justify-start">
                            <div className="bg-secondary/60 rounded-2xl px-4 py-2.5 text-sm flex items-center gap-2">
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                                <span className="text-muted-foreground">Thinking...</span>
                            </div>
                        </div>
                    )}
                </div>

                {voiceActive && (
                    <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/20 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            <span className="text-red-400 font-semibold">Voice active</span>
                        </div>
                        <button onClick={stopVoice} className="text-red-400 hover:text-red-300">End</button>
                    </div>
                )}

                {/* Input */}
                <div className="p-4 border-t border-border bg-background/30">
                    <div className="flex items-end gap-2">
                        <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey}
                            placeholder="Ask anything…"
                            rows={2}
                            disabled={isSending || voiceActive}
                            className="flex-1 bg-secondary/50 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none max-h-40" />
                        {config?.voiceEnabled && (
                            <button onClick={voiceActive ? stopVoice : startVoice} disabled={isSending}
                                title={voiceActive ? 'End voice' : 'Start voice'}
                                className={`p-2.5 rounded-xl transition-colors ${voiceActive ? 'bg-red-500 text-white' : 'bg-secondary/70 text-muted-foreground hover:text-foreground'}`}>
                                {voiceActive ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                            </button>
                        )}
                        <button onClick={send} disabled={!draft.trim() || isSending || voiceActive}
                            className="p-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed">
                            <Send className="w-5 h-5" />
                        </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Enter to send · Shift+Enter for new line</span>
                        <Link href="/dashboard/settings/copilot" className="hover:text-foreground">Custom prompt</Link>
                    </div>
                </div>
            </div>

            {/* Actions sidebar */}
            <div className="w-72 bg-card border border-border rounded-2xl overflow-hidden hidden lg:flex flex-col">
                <div className="p-4 border-b border-border">
                    <h2 className="font-semibold text-sm flex items-center gap-2"><MessageSquare className="w-4 h-4 text-primary" /> Recent actions</h2>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Live feed of what the copilot did.</p>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {actions.length === 0 && (
                        <div className="text-center py-8 text-xs text-muted-foreground">
                            No actions yet.
                        </div>
                    )}
                    {actions.slice().reverse().map((a, i) => {
                        const path = ENTITY_PATH[a.entity];
                        return (
                            <div key={a.at + i} className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-3 py-2 text-xs">
                                <div className="flex items-start gap-2">
                                    <span className="text-emerald-400 mt-0.5">✓</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-foreground">
                                            {a.entity} {a.verb}
                                            {a.title && <span className="text-muted-foreground">: {a.title}</span>}
                                        </div>
                                        {path && (
                                            <Link href={path}
                                                className="text-primary hover:underline text-[10px] flex items-center gap-0.5 mt-1">
                                                View <ArrowUpRight className="w-3 h-3" />
                                            </Link>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

"use client";

// Full-page copilot — same conversation, tools, socket wiring, and
// pickers as the floating bubble panel. Uses the shared Zustand
// store so a chat started in the bubble continues here and vice
// versa. Layout is wider so long tool-heavy conversations breathe.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Sparkles, Send, AudioLines, Square, Loader2, ArrowUpRight, Coins, RefreshCw, Plus, MessageSquare } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";
import { useCopilotStore } from "@/store/copilotStore";
import { useCopilotVoice } from "@/components/copilot/useCopilotVoice";


const LANGUAGE_OPTIONS: { code: string; label: string }[] = [
    { code: "", label: "Auto (match user)" },
    { code: "English", label: "English" },
    { code: "Azerbaijani", label: "Azərbaycan" },
    { code: "Russian", label: "Русский" },
    { code: "Turkish", label: "Türkçe" },
];

type CopilotSessionRow = {
    id: string;
    title: string | null;
    mode: string;
    totalCredits: number;
    updatedAt: string;
};

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
        isSending, voiceActive, sessionId, messages, draft,
        provider, model, language,
        setDraft, setSending, setSession, pushMessage,
        setProvider, setModel, setLanguage, reset, setMessages,
    } = useCopilotStore();

    const [config, setConfig] = useState<CopilotConfig | null>(null);
    const [balance, setBalance] = useState<{ remaining: number; totalBudget: number } | null>(null);
    const [sessions, setSessions] = useState<CopilotSessionRow[]>([]);
    const [sessionsBusy, setSessionsBusy] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const loadSessions = async () => {
        setSessionsBusy(true);
        try {
            const r = await api.get('/copilot/sessions');
            if (r.data.success) setSessions(r.data.sessions || []);
        } catch { /* an unreachable list is not worth an error banner */ }
        finally { setSessionsBusy(false); }
    };
    useEffect(() => { loadSessions(); }, []);

    // A finished turn either created a session or changed its title and
    // running total, so the list is refreshed when sending settles rather
    // than on a timer.
    useEffect(() => { if (!isSending) loadSessions(); }, [isSending]);

    const openSession = async (id: string) => {
        if (id === sessionId) return;
        try {
            const r = await api.get(`/copilot/sessions/${id}`);
            if (r.data.success) {
                setMessages(r.data.session.messages || []);
                setSession(id);
            }
        } catch { /* leave the current conversation alone */ }
    };

    const newChat = () => { reset(); loadSessions(); };

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

    // No socket here on purpose. The floating panel is mounted in the
    // dashboard layout, so it is already listening on this page — a
    // second subscription pushed every action card twice and fired
    // navigate_to's router.push twice.

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages]);

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
            {/* Chats.
                On the left, where a list of things you can switch between
                belongs. It replaced a live feed of tool calls: that feed
                repeated what the transcript already showed a few
                centimetres away, and it emptied on every reload, so the
                most valuable column on the page was showing the least
                durable thing on it. */}
            <div className="w-64 bg-card border border-border rounded-2xl overflow-hidden hidden lg:flex flex-col">
                <div className="p-3 border-b border-border flex items-center justify-between gap-2">
                    <h2 className="font-semibold text-sm flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-primary" /> Chats
                    </h2>
                    <button onClick={newChat}
                        title="New chat"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {sessionsBusy && sessions.length === 0 && (
                        <div className="py-8 flex justify-center">
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        </div>
                    )}
                    {!sessionsBusy && sessions.length === 0 && (
                        <p className="py-8 px-3 text-center text-xs text-muted-foreground">
                            No chats yet.
                        </p>
                    )}
                    {sessions.map(sn => (
                        <button key={sn.id} onClick={() => openSession(sn.id)}
                            className={`w-full text-left px-3 py-2.5 border-b border-border/50 last:border-0 hover:bg-secondary/40 transition-colors ${
                                sn.id === sessionId ? 'bg-secondary/50' : ''
                            }`}>
                            <div className="text-xs truncate">{sn.title || 'Untitled chat'}</div>
                            <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                <span>{new Date(sn.updatedAt).toLocaleDateString()}</span>
                                {sn.totalCredits > 0 && <span>· {sn.totalCredits} cai</span>}
                                {sn.mode === 'voice' && <span>· voice</span>}
                            </div>
                        </button>
                    ))}
                </div>
            </div>

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
                    {/* Model and language moved down into the composer:
                        they describe the message you are about to send, not
                        the page, and reading them a screen away from the
                        box you type in made that hard to see. */}
                    <button onClick={reset}
                        title="Start a new conversation"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                        <RefreshCw className="w-4 h-4" />
                    </button>
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

                {/* Input.
                    One bordered box holds the text and everything that acts
                    on it — the two pickers sit under the words they apply
                    to, and the send and voice buttons sit at the far end of
                    the same row. The whole thing takes the focus ring, so
                    typing lights up the control it belongs to rather than a
                    field floating between loose buttons. */}
                <div className="p-4 border-t border-border bg-background/30">
                    <div className="rounded-2xl border border-border bg-secondary/40 focus-within:ring-2 focus-within:ring-primary/40 transition-shadow">
                        <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey}
                            placeholder="Ask anything…"
                            rows={2}
                            disabled={isSending || voiceActive}
                            className="w-full bg-transparent px-4 pt-3 pb-1 text-sm focus:outline-none resize-none max-h-40 placeholder:text-muted-foreground" />

                        <div className="flex items-center gap-2 px-2.5 pb-2.5">
                            <select value={model || ''}
                                onChange={e => {
                                    const next = e.target.value;
                                    setModel(next);
                                    const found = config?.availableModels?.find(m => m.model === next);
                                    if (found) setProvider(found.provider);
                                }}
                                title="Model for text replies"
                                className="bg-secondary/70 border border-border rounded-lg px-2.5 py-1.5 text-[11px] font-mono max-w-[12rem] truncate focus:outline-none focus:ring-1 focus:ring-primary/50">
                                {(config?.availableModels || []).map(m => (
                                    <option key={`${m.provider}|${m.model}`} value={m.model} className="bg-card">
                                        {m.model}
                                    </option>
                                ))}
                            </select>
                            <select value={language || ''}
                                onChange={e => setLanguage(e.target.value || null)}
                                title="Reply language"
                                className="bg-secondary/70 border border-border rounded-lg px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/50">
                                {LANGUAGE_OPTIONS.map(l => (
                                    <option key={l.code} value={l.code} className="bg-card">{l.label}</option>
                                ))}
                            </select>

                            <div className="flex-1" />

                            {config?.voiceEnabled && (
                                /* A waveform rather than a microphone: this
                                   starts a spoken conversation, it doesn't
                                   record a voice note. */
                                <button onClick={voiceActive ? stopVoice : startVoice} disabled={isSending}
                                    title={voiceActive ? 'End voice conversation' : 'Talk to the copilot'}
                                    aria-label={voiceActive ? 'End voice conversation' : 'Talk to the copilot'}
                                    className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-colors ${
                                        voiceActive
                                            ? 'bg-red-500 text-white hover:bg-red-600'
                                            : 'bg-foreground text-background hover:opacity-90'
                                    }`}>
                                    {voiceActive
                                        ? <Square className="w-4 h-4 fill-current" />
                                        : <AudioLines className="w-4 h-4" />}
                                </button>
                            )}
                            <button onClick={send} disabled={!draft.trim() || isSending || voiceActive}
                                title="Send"
                                aria-label="Send"
                                className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed">
                                <Send className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Enter to send · Shift+Enter for new line</span>
                        <Link href="/dashboard/settings/copilot" className="hover:text-foreground">Custom prompt</Link>
                    </div>
                </div>
            </div>

        </div>
    );
}

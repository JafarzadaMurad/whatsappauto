"use client";

// The dashboard-wide copilot. Mounted once in `dashboard/layout.tsx`
// so opening/closing and the running conversation SURVIVE route
// changes (the user asked for chats to keep working while they
// navigate). All state lives in useCopilotStore (Zustand).

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bot, X, Send, Mic, MicOff, Loader2, ChevronDown, Sparkles, MessageSquare, Coins, Maximize2 } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";
import { createSocket } from "@/lib/socket";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { useCopilotStore } from "@/store/copilotStore";
import { useCopilotVoice } from "./useCopilotVoice";

// Entity → dashboard path mapping so action toasts get a "View →" link
// aimed at a page that actually exists.

type ModelOption = { provider: string; model: string };
type CopilotConfig = {
    enabled: boolean;
    voiceEnabled: boolean;
    customPrompt: string;
    reason?: string | null;
    defaultProvider?: string;
    defaultModel?: string;
    availableModels?: ModelOption[];
};

// Small curated list — full names go into the language directive in the
// system prompt. Users can pick "Auto" to let the model mirror the input.
const LANGUAGE_OPTIONS: { code: string; label: string }[] = [
    { code: "", label: "Auto (match user)" },
    { code: "English", label: "English" },
    { code: "Azerbaijani", label: "Azərbaycan" },
    { code: "Russian", label: "Русский" },
    { code: "Turkish", label: "Türkçe" },
];

export default function Copilot() {
    const pathname = usePathname();
    const router = useRouter();
    const {
        isOpen, isSending, voiceActive, sessionId, messages, draft,
        provider, model, language,
        open, close, setDraft, setSending, setSession, pushMessage, pushAction,
        setProvider, setModel, setLanguage,
    } = useCopilotStore();

    const [config, setConfig] = useState<CopilotConfig | null>(null);
    const [balance, setBalance] = useState<{ remaining: number; totalBudget: number } | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Voice mode WebRTC — split into its own hook to keep this file focused.
    // Errors land as an assistant-role message in the transcript so the user
    // sees the backend's actual reason (e.g. "OpenAI 401: invalid_api_key")
    // instead of a generic browser alert they'll dismiss and forget.
    const { start: startVoice, stop: stopVoice } = useCopilotVoice({
        onEnd: () => {},
        onError: (message) => {
            pushMessage({
                role: 'assistant',
                content: `⚠️ Voice session failed: ${message}`,
                at: new Date().toISOString(),
            });
        },
    });

    // ─── Load config once mounted (survives across route changes) ──
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
                        customPrompt: cfgRes.data.customPrompt,
                        reason: cfgRes.data.reason,
                        defaultProvider: cfgRes.data.defaultProvider,
                        defaultModel: cfgRes.data.defaultModel,
                        availableModels: cfgRes.data.availableModels || [],
                    });
                    // Initialise picker from admin defaults on first load.
                    // If the user has already picked something (localStorage)
                    // that value stays — don't clobber a deliberate choice.
                    if (!provider && cfgRes.data.defaultProvider) setProvider(cfgRes.data.defaultProvider);
                    if (!model && cfgRes.data.defaultModel) setModel(cfgRes.data.defaultModel);
                    if (!cfgRes.data.enabled) {
                        // eslint-disable-next-line no-console
                        console.info('[copilot] hidden — reason:', cfgRes.data.reason);
                    }
                }
                if (balRes?.data?.success) setBalance({
                    remaining: balRes.data.balance.remaining,
                    totalBudget: balRes.data.balance.totalBudget,
                });
            } catch { /* silent — we still render the bubble */ }
        })();

        // Poll balance every 20s so the header pill ticks even when
        // the user is chatting with the copilot in a different tab
        // (voice mode, or Usage page open beside). No auth-cost.
        const balanceTimer = setInterval(() => {
            api.get('/credits/balance').then(r => {
                if (r.data.success) setBalance({
                    remaining: r.data.balance.remaining,
                    totalBudget: r.data.balance.totalBudget,
                });
            }).catch(() => {});
        }, 20_000);
        return () => clearInterval(balanceTimer);
    }, []);

    // ─── Socket: listen for copilot.action + copilot.navigate ──────
    const activeWorkspaceId = useWorkspaceStore(w => w.activeWorkspaceId);
    useEffect(() => {
        if (!config?.enabled) return;
        // Passing the id explicitly (rather than letting the helper read
        // localStorage) is what makes the reconnect below meaningful —
        // the socket has to land in the room the requests are scoped to.
        const socket = createSocket({ workspaceId: activeWorkspaceId });
        socket.on('copilot.action', (ev: any) => {
            pushAction({
                tool: ev.tool, entity: ev.entity, verb: ev.verb,
                title: ev.title || '', id: ev.id || null, at: ev.at,
            });
        });
        // Navigation events come from the `navigate_to` copilot tool —
        // fires on the workspace room whenever the agent asks the UI to
        // switch pages. The panel stays open across navigations because
        // it's mounted in the dashboard layout, so the user keeps the
        // conversation in view while the destination loads.
        socket.on('copilot.navigate', (ev: any) => {
            const path = String(ev?.path || '');
            if (!path.startsWith('/dashboard')) return;
            router.push(path);
            // Leave a trace in the panel. A silent push is impossible to
            // tell apart from a model that only claimed to navigate —
            // which is exactly the confusion this card removes.
            pushAction({
                tool: 'navigate_to', entity: 'Page', verb: 'opened',
                title: path, id: null, at: ev?.at || new Date().toISOString(),
            });
        });
        return () => { socket.disconnect(); };
    }, [config?.enabled, activeWorkspaceId, pushAction, router]);

    // ─── Auto-scroll to latest message ─────────────────────────────
    useEffect(() => {
        if (isOpen) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, isOpen]);

    // ─── Send ──────────────────────────────────────────────────────
    const send = async () => {
        const text = draft.trim();
        if (!text || isSending) return;
        setSending(true);
        pushMessage({ role: 'user', content: text, at: new Date().toISOString() });
        setDraft("");
        try {
            const res = await api.post('/copilot/chat', {
                sessionId: sessionId || undefined,
                message: text,
                currentPath: pathname,
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
                // Refresh balance
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
            // Surface the credit-exhausted 402 with a friendlier prompt
            // pointing at Billing, not the raw backend message.
            const status = err.response?.status;
            const data = err.response?.data;
            if (status === 402 && data?.code === 'credits_exhausted') {
                pushMessage({
                    role: 'assistant',
                    content: `⚠️ You've used all ${data.totalBudget?.toLocaleString?.() || 'your'} credits for this period. Upgrade your plan or wait for the reset on ${data.periodResetAt ? new Date(data.periodResetAt).toLocaleDateString() : 'next cycle'} to continue.`,
                    at: new Date().toISOString(),
                });
                // Reflect the zero balance immediately.
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

    // Don't render the bubble AT ALL on non-dashboard pages OR when
    // the plan doesn't enable it. Loading config is silent — bubble
    // pops in as soon as the plan check resolves.
    if (!config?.enabled) return null;

    return (
        <>
            {/* Floating bubble */}
            {!isOpen && (
                <button onClick={open}
                    className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-2xl shadow-primary/30 hover:scale-105 active:scale-95 transition-transform flex items-center justify-center group">
                    <Bot className="w-6 h-6" />
                </button>
            )}

            {/* Panel */}
            {isOpen && (
                <div className="fixed bottom-6 right-6 z-40 w-[400px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-3rem)] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="p-3 border-b border-border bg-secondary/30 space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                                <div className="p-1.5 bg-primary/15 text-primary rounded-lg"><Bot className="w-4 h-4" /></div>
                                <div className="min-w-0">
                                    <div className="font-semibold text-sm">Copilot</div>
                                    {balance && (
                                        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                                            <Coins className="w-2.5 h-2.5 text-amber-400" />
                                            {balance.remaining.toLocaleString()} credits left
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                <button onClick={() => { close(); router.push('/dashboard/copilot'); }}
                                    title="Open full page"
                                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                                    <Maximize2 className="w-4 h-4" />
                                </button>
                                <button onClick={close} title="Collapse"
                                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                                    <ChevronDown className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Messages */}
                    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                        {messages.length === 0 && (
                            <div className="text-center py-8 space-y-3">
                                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10 text-primary">
                                    <Sparkles className="w-6 h-6" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium">How can I help?</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Ask me to list your agents, create a campaign, tag a client, or send a message.
                                    </p>
                                </div>
                                <div className="flex flex-col gap-1.5 pt-2 text-xs">
                                    {[
                                        "How many WhatsApp instances do I have?",
                                        "Create a Sales agent using Claude Sonnet",
                                        "List my top 5 clients tagged VIP",
                                    ].map(q => (
                                        <button key={q} onClick={() => setDraft(q)}
                                            className="text-left px-3 py-1.5 rounded-lg bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                                            {q}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {messages.map((m, i) => (
                            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
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
                                <div className="bg-secondary/60 rounded-2xl px-3 py-2 text-sm flex items-center gap-2">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                                    <span className="text-muted-foreground">Thinking...</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Voice mode banner */}
                    {voiceActive && (
                        <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/20 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                <span className="text-red-400 font-semibold">Voice active</span>
                            </div>
                            <button onClick={stopVoice} className="text-red-400 hover:text-red-300">
                                End
                            </button>
                        </div>
                    )}

                    {/* Input */}
                    <div className="p-3 border-t border-border bg-background/30">
                        <div className="flex items-end gap-2">
                            <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey}
                                placeholder="Ask anything..."
                                rows={1}
                                disabled={isSending || voiceActive}
                                className="flex-1 bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none max-h-32" />
                            {config.voiceEnabled && (
                                <button onClick={voiceActive ? stopVoice : startVoice} disabled={isSending}
                                    title={voiceActive ? 'End voice' : 'Start voice'}
                                    className={`p-2 rounded-xl transition-colors ${voiceActive ? 'bg-red-500 text-white' : 'bg-secondary/70 text-muted-foreground hover:text-foreground'}`}>
                                    {voiceActive ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                                </button>
                            )}
                            <button onClick={send} disabled={!draft.trim() || isSending || voiceActive}
                                className="p-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed">
                                <Send className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <select value={model || ''}
                                onChange={e => {
                                    const next = e.target.value;
                                    setModel(next);
                                    const found = config?.availableModels?.find(m => m.model === next);
                                    if (found) setProvider(found.provider);
                                }}
                                disabled={voiceActive}
                                title={voiceActive ? 'Voice mode runs on its own model' : 'Model for this conversation'}
                                className="bg-secondary/60 border border-border rounded px-1.5 py-0.5 text-[10px] text-foreground max-w-[45%] truncate focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50">
                                {(config?.availableModels || []).map(m => (
                                    <option key={`${m.provider}|${m.model}`} value={m.model} className="bg-card">
                                        {m.model}
                                    </option>
                                ))}
                            </select>
                            <select value={language || ''}
                                onChange={e => setLanguage(e.target.value || null)}
                                title="Reply language"
                                className="bg-secondary/60 border border-border rounded px-1.5 py-0.5 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50">
                                {LANGUAGE_OPTIONS.map(l => (
                                    <option key={l.code} value={l.code} className="bg-card">{l.label}</option>
                                ))}
                            </select>
                            <Link href="/dashboard/settings/copilot" className="ml-auto hover:text-foreground whitespace-nowrap">
                                Custom prompt
                            </Link>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Inbox, Loader2, MessageSquare, Camera, Search, Send, Pause, Play, Phone, Check, CheckCheck } from "lucide-react";
import api from "@/lib/api";

const PAGE_SIZE = 50;

// ─── Helpers ──────────────────────────────────────────────────
function jidToPhone(jid: string): string {
    if (jid.startsWith('ig:')) return jid.slice(3);
    return jid.replace('@s.whatsapp.net', '').replace('@lid', '').replace(/[^0-9]/g, '');
}

// Identifier shown under the contact name in headers and as a fallback
// when no name is known. For LIDs (anonymous WhatsApp identities) and
// IGSIDs, returns a generic "Unknown contact" label instead of pretending
// to be a phone number.
function formatIdentifier(c: Conversation): string {
    if (c.channel === 'instagram') {
        // For IG we already pre-pend @ to the username; the raw IGSID
        // never looks like a phone, so no '+' here.
        return c.name ? '@' + c.name : 'Instagram user';
    }
    if (c.isAnonymous) {
        return 'WhatsApp contact';
    }
    return '+' + c.phone;
}

function displayName(c: Conversation): string {
    if (c.name) return c.name;
    if (c.channel === 'whatsapp' && !c.isAnonymous) return '+' + c.phone;
    return formatIdentifier(c);
}

function formatRelative(d: string | Date): string {
    const date = new Date(d);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    const sameYear = date.getFullYear() === now.getFullYear();
    return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', ...(sameYear ? {} : { year: '2-digit' }) });
}

function fullDateLabel(d: string | Date): string {
    const date = new Date(d);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return 'Today';
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' });
}

// ─── Types ────────────────────────────────────────────────────
type Conversation = {
    accountId: string;
    accountName: string;
    channel: 'whatsapp' | 'instagram';
    remoteJid: string;
    name: string | null;
    phone: string;
    isAnonymous: boolean;
    lastMessage: string;
    lastFromMe: boolean;
    lastMessageAt: string;
    messageCount: number;
    profilePic?: string | null;
};

type Message = {
    id: string;
    userMessage?: string;
    agentReply?: string;
    createdAt: string;
    provider?: string;
    promptTokens?: number;
    completionTokens?: number;
};

type ChannelFilter = 'all' | 'whatsapp' | 'instagram';

// ─── Page ─────────────────────────────────────────────────────
export default function InboxPage() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loadingConvs, setLoadingConvs] = useState(true);
    const [search, setSearch] = useState('');
    const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
    const [selected, setSelected] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [loadingChat, setLoadingChat] = useState(false);
    const [replyText, setReplyText] = useState('');
    const [sending, setSending] = useState(false);

    const [agentPaused, setAgentPaused] = useState<boolean | null>(null);
    const [pauseBusy, setPauseBusy] = useState(false);

    // Pagination state for the open chat
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    // Anchored-scroll bookkeeping so prepending older messages keeps the
    // viewport pinned to whatever the user was reading.
    const prevHeightRef = useRef<number>(0);
    // Tracks whether the next layout should snap to the bottom (after
    // initial load or sending a reply) vs. keep the current scroll
    // anchor (after prepending older messages).
    const stickToBottomRef = useRef<boolean>(true);

    const loadConvos = useCallback(async () => {
        setLoadingConvs(true);
        try {
            const url = channelFilter === 'all' ? '/inbox/unified' : `/inbox/unified?channel=${channelFilter}`;
            const r = await api.get(url);
            if (r.data?.success) setConversations(r.data.conversations);
        } catch (e) { console.error(e); }
        finally { setLoadingConvs(false); }
    }, [channelFilter]);

    useEffect(() => { loadConvos(); }, [loadConvos]);

    const visibleConvos = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return conversations;
        return conversations.filter(c =>
            (c.name?.toLowerCase().includes(q)) ||
            c.phone.includes(q) ||
            c.lastMessage.toLowerCase().includes(q)
        );
    }, [conversations, search]);

    const refreshPauseStatus = async (jid: string) => {
        try {
            const phone = jidToPhone(jid);
            const r = await api.get(`/clients?search=${encodeURIComponent(phone)}`);
            if (r.data?.success) {
                const c = (r.data.clients as any[]).find(c => c.phone === phone || (c.phone || '').includes(phone));
                setAgentPaused(c?.agentPaused ?? false);
            } else setAgentPaused(false);
        } catch { setAgentPaused(false); }
    };

    const openConvo = async (c: Conversation) => {
        setSelected(c);
        setMessages([]);
        setReplyText('');
        setAgentPaused(null);
        setHasMore(false);
        stickToBottomRef.current = true;
        refreshPauseStatus(c.remoteJid);
        setLoadingChat(true);
        try {
            const r = await api.get(
                `/inbox/messages?accountId=${c.accountId}&remoteJid=${encodeURIComponent(c.remoteJid)}&limit=${PAGE_SIZE}`
            );
            if (r.data?.success) {
                setMessages(r.data.messages);
                setHasMore(!!r.data.hasMore);
            }
        } catch (e) { console.error(e); }
        finally { setLoadingChat(false); }
    };

    const loadMoreMessages = useCallback(async () => {
        if (!selected || loadingMore || !hasMore || messages.length === 0) return;
        const oldest = messages[0]?.createdAt;
        if (!oldest) return;
        setLoadingMore(true);
        // Remember scroll height before prepend so we can restore the
        // user's viewport position after the new rows render.
        if (scrollRef.current) prevHeightRef.current = scrollRef.current.scrollHeight;
        stickToBottomRef.current = false;
        try {
            const r = await api.get(
                `/inbox/messages?accountId=${selected.accountId}&remoteJid=${encodeURIComponent(selected.remoteJid)}&limit=${PAGE_SIZE}&before=${encodeURIComponent(oldest)}`
            );
            if (r.data?.success) {
                const older: Message[] = r.data.messages || [];
                if (older.length > 0) {
                    setMessages(prev => [...older, ...prev]);
                }
                setHasMore(!!r.data.hasMore);
            }
        } catch (e) { console.error(e); }
        finally { setLoadingMore(false); }
    }, [selected, loadingMore, hasMore, messages]);

    // After messages update: snap to bottom on initial/new-message
    // renders, or restore the anchored scroll position after a
    // load-more prepend.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        if (stickToBottomRef.current) {
            el.scrollTop = el.scrollHeight;
        } else {
            // Preserve viewport: new scrollTop = old scrollTop + (new height - old height)
            const newScrollTop = el.scrollTop + (el.scrollHeight - prevHeightRef.current);
            el.scrollTop = newScrollTop;
            stickToBottomRef.current = true;
        }
    }, [messages]);

    const onChatScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        if (e.currentTarget.scrollTop < 60 && hasMore && !loadingMore) {
            loadMoreMessages();
        }
    }, [hasMore, loadingMore, loadMoreMessages]);

    const sendReply = async () => {
        if (!selected || !replyText.trim()) return;
        const text = replyText.trim();
        setSending(true);
        try {
            const r = await api.post('/inbox/reply', {
                accountId: selected.accountId,
                remoteJid: selected.remoteJid,
                text,
            });
            if (r.data?.success && r.data.message) {
                stickToBottomRef.current = true;
                setMessages(prev => [...prev, r.data.message]);
                setReplyText('');
                // Optimistically bump conversation to top
                setConversations(prev => {
                    const next = prev.map(c => c.remoteJid === selected.remoteJid && c.accountId === selected.accountId
                        ? { ...c, lastMessage: text, lastFromMe: true, lastMessageAt: new Date().toISOString() }
                        : c);
                    return next.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
                });
            }
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        } finally { setSending(false); }
    };

    const togglePause = async () => {
        if (!selected) return;
        const next = !agentPaused;
        setPauseBusy(true);
        try {
            await api.post('/clients/pause', {
                phone: jidToPhone(selected.remoteJid),
                channel: selected.channel,
                paused: next,
            });
            setAgentPaused(next);
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        } finally { setPauseBusy(false); }
    };

    return (
        <div className="h-[calc(100vh-4rem)] flex flex-col">
            <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-shrink-0">
                <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <Inbox className="w-4 h-4" />
                </div>
                <h1 className="text-xl font-bold">Inbox</h1>
                <div className="ml-auto flex items-center gap-1.5 text-xs">
                    {([
                        { id: 'all', label: 'All' },
                        { id: 'whatsapp', label: 'WhatsApp', Icon: MessageSquare, color: 'text-emerald-400' },
                        { id: 'instagram', label: 'Instagram', Icon: Camera, color: 'text-pink-400' },
                    ] as const).map(f => (
                        <button key={f.id} onClick={() => setChannelFilter(f.id as ChannelFilter)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors
                                ${channelFilter === f.id
                                    ? 'bg-primary/10 border-primary/30 text-foreground'
                                    : 'bg-card border-border text-muted-foreground hover:text-foreground'}`}>
                            {'Icon' in f && f.Icon && <f.Icon className={`w-3.5 h-3.5 ${'color' in f ? f.color : ''}`} />}
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 flex min-h-0">
                {/* ─── Conversation list ─── */}
                <aside className="w-80 border-r border-border bg-card flex flex-col">
                    <div className="p-2 border-b border-border flex-shrink-0">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                            <input value={search} onChange={e => setSearch(e.target.value)}
                                placeholder="Search…"
                                className="w-full bg-secondary/50 border border-border rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {loadingConvs ? (
                            <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                        ) : visibleConvos.length === 0 ? (
                            <div className="text-center text-sm text-muted-foreground py-12 px-4">
                                {conversations.length === 0
                                    ? 'No conversations yet. Connect a WhatsApp number or Instagram account, or import history.'
                                    : 'No matches for that search.'}
                            </div>
                        ) : visibleConvos.map(c => (
                            <ConvoRow key={`${c.accountId}:${c.remoteJid}`}
                                convo={c}
                                active={selected?.remoteJid === c.remoteJid && selected?.accountId === c.accountId}
                                onClick={() => openConvo(c)} />
                        ))}
                    </div>
                </aside>

                {/* ─── Chat panel ─── */}
                <section className="flex-1 flex flex-col min-w-0 bg-background">
                    {!selected ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
                            <Inbox className="w-10 h-10 opacity-40" />
                            <p className="text-sm">Pick a conversation to start chatting</p>
                        </div>
                    ) : (
                        <>
                            {/* Chat header */}
                            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card flex-shrink-0">
                                <Avatar conv={selected} size={40} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <h2 className="font-semibold text-sm truncate">{displayName(selected)}</h2>
                                        <ChannelBadge channel={selected.channel} />
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate">
                                        {/* Show the phone (or fallback label) only when it's
                                            actually different from the displayed name. Keeps
                                            anonymous LIDs from showing a meaningless +digits. */}
                                        {!selected.name && selected.channel === 'whatsapp' && !selected.isAnonymous
                                            ? null
                                            : <span className="font-mono">{formatIdentifier(selected)} · </span>}
                                        {selected.accountName}
                                    </p>
                                </div>
                                {agentPaused !== null && (
                                    <button onClick={togglePause} disabled={pauseBusy}
                                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-60 ${agentPaused
                                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                                            : 'bg-secondary/40 text-muted-foreground border-border hover:bg-secondary/70 hover:text-foreground'}`}>
                                        {pauseBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                                            agentPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                                        {agentPaused ? 'Resume agent' : 'Pause agent'}
                                    </button>
                                )}
                            </div>

                            {/* Messages */}
                            <div ref={scrollRef} onScroll={onChatScroll}
                                className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                                {loadingChat ? (
                                    <div className="flex justify-center pt-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                                ) : messages.length === 0 ? (
                                    <div className="text-center text-sm text-muted-foreground pt-12">No messages yet.</div>
                                ) : (
                                    <>
                                        {loadingMore && (
                                            <div className="flex justify-center py-2">
                                                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                                            </div>
                                        )}
                                        {!loadingMore && !hasMore && messages.length > PAGE_SIZE && (
                                            <div className="text-center text-[10px] uppercase tracking-wide text-muted-foreground/60 py-1">
                                                Start of conversation
                                            </div>
                                        )}
                                        <MessageList messages={messages} />
                                    </>
                                )}
                            </div>

                            {/* Reply box */}
                            <div className="border-t border-border bg-card p-3 flex-shrink-0">
                                <div className="flex gap-2">
                                    <input type="text" value={replyText}
                                        onChange={e => setReplyText(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                                        placeholder="Type a reply…" maxLength={950} disabled={sending}
                                        className="flex-1 bg-secondary/50 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                    <button onClick={sendReply} disabled={sending || !replyText.trim()}
                                        className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-4 flex items-center gap-2 text-sm font-medium disabled:opacity-50">
                                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </section>
            </div>
        </div>
    );
}

// ─── Sub-components ───────────────────────────────────────────
function ConvoRow({ convo, active, onClick }: { convo: Conversation; active: boolean; onClick: () => void }) {
    return (
        <button onClick={onClick}
            className={`w-full text-left flex items-center gap-3 px-3 py-2.5 border-b border-border/30 hover:bg-secondary/30 transition-colors ${active ? 'bg-secondary/60' : ''}`}>
            <Avatar conv={convo} size={42} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm truncate flex-1">{displayName(convo)}</span>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">{formatRelative(convo.lastMessageAt)}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                    <ChannelBadge channel={convo.channel} mini />
                    <p className="text-xs text-muted-foreground truncate flex-1">
                        {convo.lastFromMe && <span className="opacity-60">You: </span>}
                        {convo.lastMessage || '—'}
                    </p>
                </div>
            </div>
        </button>
    );
}

function Avatar({ conv, size }: { conv: Conversation; size: number }) {
    const initial = (conv.name || conv.phone || '?').charAt(0).toUpperCase();
    if (conv.profilePic) {
        return (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={conv.profilePic} alt="" width={size} height={size}
                className="rounded-full object-cover flex-shrink-0" style={{ width: size, height: size }} />
        );
    }
    return (
        <div className="rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center flex-shrink-0"
            style={{ width: size, height: size, fontSize: size * 0.36 }}>
            {/[A-Za-z0-9]/.test(initial) ? initial : <Phone style={{ width: size * 0.4, height: size * 0.4 }} />}
        </div>
    );
}

function ChannelBadge({ channel, mini }: { channel: 'whatsapp' | 'instagram'; mini?: boolean }) {
    if (channel === 'instagram') {
        return mini ? (
            <Camera className="w-3 h-3 text-pink-400 flex-shrink-0" />
        ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-pink-500/10 text-pink-400 border border-pink-500/20">
                <Camera className="w-2.5 h-2.5" /> Instagram
            </span>
        );
    }
    return mini ? (
        <MessageSquare className="w-3 h-3 text-emerald-400 flex-shrink-0" />
    ) : (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <MessageSquare className="w-2.5 h-2.5" /> WhatsApp
        </span>
    );
}

function MessageList({ messages }: { messages: Message[] }) {
    // Render with date dividers between days.
    const elements: React.ReactElement[] = [];
    let lastDay = '';
    for (const msg of messages) {
        const day = new Date(msg.createdAt).toDateString();
        if (day !== lastDay) {
            elements.push(
                <div key={`day-${day}-${msg.id}`} className="flex items-center gap-2 my-3">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{fullDateLabel(msg.createdAt)}</span>
                    <div className="flex-1 h-px bg-border" />
                </div>
            );
            lastDay = day;
        }
        elements.push(<MessageBubble key={msg.id} msg={msg} />);
    }
    return <>{elements}</>;
}

function MessageBubble({ msg }: { msg: Message }) {
    const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return (
        <div className="space-y-1.5">
            {msg.userMessage && (
                <div className="flex justify-start">
                    <div className="bg-secondary/50 rounded-2xl rounded-bl-md px-3.5 py-2 max-w-[70%] text-sm">
                        <div className="whitespace-pre-wrap break-words">{msg.userMessage}</div>
                        <div className="text-[10px] text-muted-foreground/70 mt-0.5">{time}</div>
                    </div>
                </div>
            )}
            {msg.agentReply && (
                <div className="flex justify-end">
                    <div className="bg-primary/15 border border-primary/20 rounded-2xl rounded-br-md px-3.5 py-2 max-w-[70%] text-sm">
                        <div className="whitespace-pre-wrap break-words">{msg.agentReply}</div>
                        <div className="text-[10px] text-muted-foreground/70 mt-0.5 text-right flex items-center justify-end gap-1">
                            {msg.provider === 'MANUAL' || msg.provider === 'PHONE' ? null :
                                msg.provider && <span className="opacity-70">AI</span>}
                            {time}
                            <CheckCheck className="w-3 h-3 opacity-60" />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Silence unused import (kept for future tick icon variants)
void Check;

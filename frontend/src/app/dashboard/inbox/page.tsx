"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Inbox, Loader2, MessageSquare, Camera, Search, Send, Pause, Play, Phone, Check, CheckCheck, ArrowLeft, Paperclip, Mic, Square, X as XIcon } from "lucide-react";
import api from "@/lib/api";
import io, { Socket } from "socket.io-client";
import { usePermChatWrite } from "@/store/workspaceStore";

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
    unreadCount?: number;
    profilePic?: string | null;
    agentPaused?: boolean;
};

type Message = {
    id: string;
    userMessage?: string;
    agentReply?: string;
    createdAt: string;
    provider?: string;
    promptTokens?: number;
    completionTokens?: number;
    // WhatsApp media surfaced by the backend after it pulls the blob
    // from the CDN. Empty for plain text turns / AI logs.
    messageType?: string;
    mediaUrl?: string | null;
    mediaMime?: string | null;
    mediaName?: string | null;
    waMsgId?: string | null;
    deliveryStatus?: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | string;
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
    const canReply = usePermChatWrite();

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

        // Eagerly zero the unread badge in local state; the server-side
        // clear happens via /mark-read so the next /unified call agrees.
        setConversations(prev => prev.map(x =>
            x.accountId === c.accountId && x.remoteJid === c.remoteJid
                ? { ...x, unreadCount: 0 }
                : x));
        api.post('/inbox/mark-read', { accountId: c.accountId, remoteJid: c.remoteJid }).catch(() => {});

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

    // ─── Realtime: WhatsApp instance message stream ──────────────
    // Subscribe to every WhatsApp account in the inbox. For the
    // currently-open conversation we append directly to `messages`;
    // for every other one we bump the unread counter and refresh the
    // last-message preview. Delivery / read receipts come in on
    // message.status-* and rewrite the matching bubble's tick.
    const selectedRef = useRef<Conversation | null>(null);
    useEffect(() => { selectedRef.current = selected; }, [selected]);

    useEffect(() => {
        const waAccounts = conversations
            .filter(c => c.channel === 'whatsapp')
            .map(c => c.accountId);
        const unique = Array.from(new Set(waAccounts));
        if (unique.length === 0) return;

        const baseUrl = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/api\/?$/, '') || window.location.origin;
        const socket: Socket = io(baseUrl, { transports: ['websocket'] });

        const onMsgNew = (accountId: string) => (payload: any) => {
            const cur = selectedRef.current;
            const isOpenChat = !!cur && cur.accountId === accountId && cur.remoteJid === payload.remoteJid;

            if (isOpenChat) {
                stickToBottomRef.current = true;
                setMessages(prev => {
                    // Naive dedupe — Socket race may briefly double up
                    // a row we already wrote optimistically on send.
                    if (payload.id && prev.some(m => m.id === payload.id)) return prev;
                    return [...prev, {
                        id: payload.id || `live-${Date.now()}`,
                        userMessage: payload.isFromMe ? '' : payload.content,
                        agentReply: payload.isFromMe ? payload.content : '',
                        createdAt: payload.timestamp,
                        provider: payload.isFromMe ? 'PHONE' : undefined,
                        messageType: payload.messageType,
                        mediaUrl: payload.mediaUrl || null,
                        mediaMime: payload.mediaMime || null,
                        mediaName: payload.mediaName || null,
                        waMsgId: payload.waMsgId || payload.id,
                        deliveryStatus: payload.isFromMe ? (payload.status || 'SENT') : undefined,
                    }];
                });
                if (!payload.isFromMe) {
                    api.post('/inbox/mark-read', { accountId, remoteJid: payload.remoteJid }).catch(() => {});
                }
            }

            setConversations(prev => {
                const idx = prev.findIndex(x => x.accountId === accountId && x.remoteJid === payload.remoteJid);
                if (idx < 0) return prev;
                const next = [...prev];
                const incomingBump = !payload.isFromMe && !isOpenChat ? 1 : 0;
                next[idx] = {
                    ...next[idx],
                    lastMessage: payload.content || (payload.mediaUrl ? '📎 Media' : next[idx].lastMessage),
                    lastFromMe: !!payload.isFromMe,
                    lastMessageAt: payload.timestamp || new Date().toISOString(),
                    unreadCount: incomingBump ? (next[idx].unreadCount || 0) + 1 : (isOpenChat ? 0 : next[idx].unreadCount),
                };
                return next.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
            });
        };

        const onMsgStatus = (accountId: string) => (payload: any) => {
            const cur = selectedRef.current;
            if (!cur || cur.accountId !== accountId || cur.remoteJid !== payload.remoteJid) return;
            setMessages(prev => prev.map(m =>
                m.waMsgId === payload.waMsgId
                    ? { ...m, deliveryStatus: payload.status }
                    : m
            ));
        };

        for (const id of unique) {
            socket.on(`message.new-${id}`, onMsgNew(id));
            socket.on(`message.status-${id}`, onMsgStatus(id));
        }
        return () => { socket.disconnect(); };
    }, [conversations.map(c => c.accountId).join(',')]);

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

    const sendMedia = async (opts: {
        file: Blob;
        kind: 'image' | 'video' | 'audio' | 'document';
        fileName?: string;
        mimetype?: string;
        caption?: string;
        ptt?: boolean;
    }) => {
        if (!selected) return;
        setSending(true);
        try {
            const fd = new FormData();
            fd.append('file', opts.file, opts.fileName || 'attachment');
            const up = await api.post('/uploads', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            if (!up.data?.success) throw new Error(up.data?.message || 'Upload failed');

            const r = await api.post('/inbox/send-media', {
                accountId: selected.accountId,
                remoteJid: selected.remoteJid,
                mediaUrl: up.data.url,
                mediaType: opts.kind,
                caption: opts.caption,
                fileName: up.data.filename || opts.fileName,
                mimetype: opts.mimetype || up.data.mimetype,
                ptt: !!opts.ptt,
            });
            if (r.data?.success && r.data.message) {
                stickToBottomRef.current = true;
                setMessages(prev => [...prev, r.data.message]);
                // Bump conversation to top with a friendly preview.
                const preview = opts.caption || r.data.message.agentReply || '📎 Media';
                setConversations(prev => {
                    const next = prev.map(c => c.remoteJid === selected.remoteJid && c.accountId === selected.accountId
                        ? { ...c, lastMessage: preview, lastFromMe: true, lastMessageAt: new Date().toISOString() }
                        : c);
                    return next.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
                });
            }
        } catch (e: any) {
            alert(e.response?.data?.message || e.message || 'Send failed');
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
            // Mirror the new state onto the conversation list row so the
            // pause badge on the avatar flips immediately, without
            // waiting for the next /unified refresh.
            setConversations(prev => prev.map(c => (
                c.accountId === selected.accountId && c.remoteJid === selected.remoteJid
                    ? { ...c, agentPaused: next } : c
            )));
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        } finally { setPauseBusy(false); }
    };

    return (
        // Negative margins break out of <main>'s p-4 / md:p-8 padding so
        // the inbox fills the entire content area edge-to-edge on every
        // breakpoint. h-full flows the actual available height from main
        // instead of guessing at viewport math.
        <div className="h-full -m-4 md:-m-8 flex flex-col">
            {/* Header: title + filter chips. On mobile the chips wrap to a
                second row so a 360-px viewport doesn't push them off-screen. */}
            <div className="px-3 sm:px-4 py-3 border-b border-border flex flex-wrap items-center gap-x-3 gap-y-2 flex-shrink-0">
                <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <Inbox className="w-4 h-4" />
                </div>
                <h1 className="text-lg sm:text-xl font-bold">Inbox</h1>
                <div className="sm:ml-auto flex items-center gap-1.5 text-xs overflow-x-auto -mx-1 px-1">
                    {([
                        { id: 'all', label: 'All' },
                        { id: 'whatsapp', label: 'WhatsApp', Icon: MessageSquare, color: 'text-emerald-400' },
                        { id: 'instagram', label: 'Instagram', Icon: Camera, color: 'text-pink-400' },
                    ] as const).map(f => (
                        <button key={f.id} onClick={() => setChannelFilter(f.id as ChannelFilter)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors flex-shrink-0
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
                {/* ─── Conversation list ───
                    Mobile: full width when no chat selected, hidden once a
                    chat is open. Desktop: always shown as a fixed-width
                    sidebar. */}
                <aside className={`w-full md:w-80 border-r border-border bg-card flex-col
                    ${selected ? 'hidden md:flex' : 'flex'}`}>
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

                {/* ─── Chat panel ───
                    Mobile: full width when a chat is open, hidden when on
                    the conversation list. Desktop: always visible next to
                    the list. */}
                <section className={`flex-1 flex-col min-w-0 bg-background
                    ${selected ? 'flex' : 'hidden md:flex'}`}>
                    {!selected ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
                            <Inbox className="w-10 h-10 opacity-40" />
                            <p className="text-sm">Pick a conversation to start chatting</p>
                        </div>
                    ) : (
                        <>
                            {/* Chat header */}
                            <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 border-b border-border bg-card flex-shrink-0">
                                {/* Back button on mobile — returns to the conversation list */}
                                <button onClick={() => setSelected(null)}
                                    className="md:hidden text-muted-foreground hover:text-foreground p-1 -ml-1 rounded-lg flex-shrink-0">
                                    <ArrowLeft className="w-5 h-5" />
                                </button>
                                <Avatar conv={selected} size={40} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <h2 className="font-semibold text-sm truncate">{displayName(selected)}</h2>
                                        <ChannelBadge channel={selected.channel} />
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate">
                                        {!selected.name && selected.channel === 'whatsapp' && !selected.isAnonymous
                                            ? null
                                            : <span className="font-mono">{formatIdentifier(selected)} · </span>}
                                        {selected.accountName}
                                    </p>
                                </div>
                                {agentPaused !== null && (
                                    <button onClick={togglePause} disabled={pauseBusy}
                                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 sm:px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-60 flex-shrink-0 ${agentPaused
                                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                                            : 'bg-secondary/40 text-muted-foreground border-border hover:bg-secondary/70 hover:text-foreground'}`}>
                                        {pauseBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                                            agentPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                                        <span className="hidden sm:inline">{agentPaused ? 'Resume agent' : 'Pause agent'}</span>
                                    </button>
                                )}
                            </div>

                            {/* Messages */}
                            <div ref={scrollRef} onScroll={onChatScroll}
                                className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-4">
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
                            <div className="border-t border-border bg-card p-2 sm:p-3 flex-shrink-0">
                                {canReply ? (
                                    <Composer
                                        sending={sending}
                                        replyText={replyText}
                                        setReplyText={setReplyText}
                                        onSendText={sendReply}
                                        onSendMedia={sendMedia}
                                        // WhatsApp doesn't accept media on LID conversations.
                                        disabled={!selected || selected.channel !== 'whatsapp'}
                                    />
                                ) : (
                                    <div className="text-xs text-muted-foreground text-center py-2">
                                        Your role doesn't permit replying in chats.
                                    </div>
                                )}
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
    const unread = !active && (convo.unreadCount || 0) > 0;
    return (
        <button onClick={onClick}
            className={`w-full text-left flex items-center gap-3 px-3 py-2.5 border-b border-border/30 hover:bg-secondary/30 transition-colors ${active ? 'bg-secondary/60' : ''}`}>
            <Avatar conv={convo} size={42} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                    <span className={`text-sm truncate flex-1 ${unread ? 'font-semibold text-foreground' : 'font-medium'}`}>
                        {displayName(convo)}
                    </span>
                    <span className={`text-[10px] flex-shrink-0 ${unread ? 'text-emerald-400 font-medium' : 'text-muted-foreground'}`}>
                        {formatRelative(convo.lastMessageAt)}
                    </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                    <ChannelBadge channel={convo.channel} mini />
                    <p className={`text-xs truncate flex-1 ${unread ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {convo.lastFromMe && <span className="opacity-60">You: </span>}
                        {convo.lastMessage || '—'}
                    </p>
                    {unread && (
                        <span className="ml-auto flex-shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center">
                            {convo.unreadCount! > 99 ? '99+' : convo.unreadCount}
                        </span>
                    )}
                </div>
            </div>
        </button>
    );
}

function Avatar({ conv, size }: { conv: Conversation; size: number }) {
    const initial = (conv.name || conv.phone || '?').charAt(0).toUpperCase();
    // WhatsApp media URLs expire periodically — when one fails we
    // remember it in component state and render the letter fallback
    // instead of a broken-image placeholder.
    const [failed, setFailed] = useState(false);
    useEffect(() => { setFailed(false); }, [conv.profilePic]);

    const badgeSize = Math.max(14, Math.round(size * 0.42));
    const pauseBadge = conv.agentPaused ? (
        <span title="Agent paused"
            className="absolute -bottom-0.5 -right-0.5 rounded-full bg-amber-500 text-white flex items-center justify-center ring-2 ring-card"
            style={{ width: badgeSize, height: badgeSize }}>
            <Pause style={{ width: badgeSize * 0.55, height: badgeSize * 0.55 }} strokeWidth={3} />
        </span>
    ) : null;

    const inner = conv.profilePic && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={conv.profilePic} alt="" width={size} height={size}
            onError={() => setFailed(true)}
            referrerPolicy="no-referrer"
            className="rounded-full object-cover" style={{ width: size, height: size }} />
    ) : (
        <div className="rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center"
            style={{ width: size, height: size, fontSize: size * 0.36 }}>
            {/[A-Za-z0-9]/.test(initial) ? initial : <Phone style={{ width: size * 0.4, height: size * 0.4 }} />}
        </div>
    );

    return (
        <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
            {inner}
            {pauseBadge}
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

// "🖼️ Photo" / "🎤 Voice message" / etc come from extractMessageContent
// when there's no caption. With the actual blob rendered above the
// text we don't also want the placeholder underneath.
const PLACEHOLDER_CAPTIONS = new Set([
    '🖼️ Photo', '🎬 Video', '🎤 Voice message', '🎵 Audio',
    '🎟️ Sticker', '📍 Location', '👁️ View-once media', '[Unsupported message]',
    '📎 Media',
]);
function captionIsPlaceholder(text?: string): boolean {
    if (!text) return true;
    const t = text.trim();
    if (PLACEHOLDER_CAPTIONS.has(t)) return true;
    // "📄 invoice.pdf" / "👤 John Doe" — emoji-led labels without a real caption
    return /^(📄|👤|👥) [^\s]/.test(t) && t.length < 50;
}

function DeliveryTick({ status }: { status?: string }) {
    if (status === 'READ') return <CheckCheck className="w-3.5 h-3.5 text-sky-400" />;
    if (status === 'DELIVERED') return <CheckCheck className="w-3.5 h-3.5 text-muted-foreground/70" />;
    if (status === 'SENT' || status === 'PENDING' || !status) return <Check className="w-3.5 h-3.5 text-muted-foreground/70" />;
    return <Check className="w-3.5 h-3.5 text-muted-foreground/70" />;
}

function MessageBubble({ msg }: { msg: Message }) {
    const time = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const renderMedia = () => {
        if (!msg.mediaUrl) return null;
        const mime = (msg.mediaMime || '').toLowerCase();
        const kind = msg.messageType || (
            mime.startsWith('image/')   ? 'image' :
            mime.startsWith('video/')   ? 'video' :
            mime.startsWith('audio/')   ? 'audio' :
                                          'document'
        );

        if (kind === 'image' || kind === 'sticker') {
            return (
                <a href={msg.mediaUrl} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={msg.mediaUrl} alt=""
                        className="rounded-xl max-h-[300px] w-auto object-contain bg-black/20" />
                </a>
            );
        }
        if (kind === 'video') {
            return (
                <video controls preload="metadata" src={msg.mediaUrl}
                    className="rounded-xl max-h-[300px] w-auto bg-black/20">
                    Your browser does not support video playback.
                </video>
            );
        }
        if (kind === 'audio') {
            // Explicit <source> with the cleaned mime so the browser
            // can pick the right decoder for ogg/opus voice notes.
            return (
                <audio controls preload="metadata" className="w-full min-w-[220px] max-w-[300px]">
                    <source src={msg.mediaUrl} type={mime || 'audio/ogg'} />
                    <source src={msg.mediaUrl} />
                    Your browser does not support audio playback.
                </audio>
            );
        }
        // document / fallback — file name + open link (no mime label)
        return (
            <a href={msg.mediaUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-2 bg-secondary/40 border border-border rounded-xl px-3 py-2 hover:bg-secondary/70 transition-colors">
                <div className="w-8 h-8 rounded-md bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold">
                    {(msg.mediaName || 'FILE').split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE'}
                </div>
                <div className="min-w-0 text-xs font-medium truncate">
                    {msg.mediaName || 'Document'}
                </div>
            </a>
        );
    };

    const hasMedia = !!msg.mediaUrl;
    // Drop the auto-generated "🖼️ Photo" / "🎤 Voice message" text when
    // we have the real attachment rendered above it. Keep real captions.
    const incomingText = msg.userMessage && !(hasMedia && captionIsPlaceholder(msg.userMessage)) ? msg.userMessage : '';
    const outgoingText = msg.agentReply && !(hasMedia && captionIsPlaceholder(msg.agentReply)) ? msg.agentReply : '';

    const showIncomingBubble = !!incomingText || (hasMedia && !msg.agentReply);
    const showOutgoingBubble = !!outgoingText || (hasMedia && msg.agentReply !== undefined && msg.agentReply !== '' && captionIsPlaceholder(msg.agentReply));

    return (
        <div className="space-y-1.5">
            {showIncomingBubble && (
                <div className="flex justify-start">
                    <div className="bg-secondary/50 rounded-2xl rounded-bl-md px-3.5 py-2 max-w-[85%] sm:max-w-[70%] text-sm">
                        {hasMedia && !msg.agentReply && (
                            <div className={incomingText ? 'mb-1' : ''}>{renderMedia()}</div>
                        )}
                        {incomingText && (
                            <div className="whitespace-pre-wrap break-words">{incomingText}</div>
                        )}
                        <div className="text-[10px] text-muted-foreground/70 mt-0.5">{time}</div>
                    </div>
                </div>
            )}
            {showOutgoingBubble && (
                <div className="flex justify-end">
                    <div className="bg-primary/15 border border-primary/20 rounded-2xl rounded-br-md px-3.5 py-2 max-w-[85%] sm:max-w-[70%] text-sm">
                        {hasMedia && (
                            <div className={outgoingText ? 'mb-1' : ''}>{renderMedia()}</div>
                        )}
                        {outgoingText && (
                            <div className="whitespace-pre-wrap break-words">{outgoingText}</div>
                        )}
                        <div className="text-[10px] text-muted-foreground/70 mt-0.5 text-right flex items-center justify-end gap-1">
                            {msg.provider === 'MANUAL' || msg.provider === 'PHONE' ? null :
                                msg.provider && <span className="opacity-70">AI</span>}
                            {time}
                            <DeliveryTick status={msg.deliveryStatus} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Silence unused import (kept for future tick icon variants)
void Check;

// ─── Composer ─────────────────────────────────────────────────
// WhatsApp-style chat input: text, paperclip for files (image/video/
// audio/document), and a press-and-hold mic for voice notes. Files
// go through the existing /api/uploads endpoint, then the resulting
// URL is sent via /api/inbox/send-media.
function Composer(props: {
    sending: boolean;
    replyText: string;
    setReplyText: (v: string) => void;
    onSendText: () => void;
    onSendMedia: (opts: { file: Blob; kind: 'image' | 'video' | 'audio' | 'document'; fileName?: string; mimetype?: string; caption?: string; ptt?: boolean }) => Promise<void>;
    disabled?: boolean;
}) {
    const { sending, replyText, setReplyText, onSendText, onSendMedia, disabled } = props;
    const [pending, setPending] = useState<{ file: File; kind: 'image' | 'video' | 'audio' | 'document'; previewUrl?: string } | null>(null);
    const [caption, setCaption] = useState('');
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const pickFile = () => fileInputRef.current?.click();

    const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        let kind: 'image' | 'video' | 'audio' | 'document' = 'document';
        if (f.type.startsWith('image/')) kind = 'image';
        else if (f.type.startsWith('video/')) kind = 'video';
        else if (f.type.startsWith('audio/')) kind = 'audio';
        const previewUrl = (kind === 'image' || kind === 'video') ? URL.createObjectURL(f) : undefined;
        setPending({ file: f, kind, previewUrl });
        setCaption('');
    };

    const cancelPending = () => {
        if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
        setPending(null);
        setCaption('');
    };

    const sendPending = async () => {
        if (!pending) return;
        const p = pending;
        cancelPending();
        await onSendMedia({
            file: p.file, kind: p.kind,
            fileName: p.file.name, mimetype: p.file.type,
            caption: caption.trim() || undefined,
        });
    };

    // Voice recording
    const [recording, setRecording] = useState(false);
    const [recordSec, setRecordSec] = useState(0);
    const mediaRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const startedAtRef = useRef<number>(0);
    const tickRef = useRef<any>(null);

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // Prefer ogg/opus (what WhatsApp voice notes use); fall back to webm.
            const mime = MediaRecorder.isTypeSupported('audio/ogg; codecs=opus')
                ? 'audio/ogg; codecs=opus'
                : MediaRecorder.isTypeSupported('audio/webm; codecs=opus')
                    ? 'audio/webm; codecs=opus'
                    : 'audio/webm';
            const rec = new MediaRecorder(stream, { mimeType: mime });
            chunksRef.current = [];
            rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
            rec.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                const blob = new Blob(chunksRef.current, { type: mime });
                const ext = mime.startsWith('audio/ogg') ? 'ogg' : 'webm';
                await onSendMedia({
                    file: blob, kind: 'audio',
                    fileName: `voice-${Date.now()}.${ext}`,
                    mimetype: mime, ptt: true,
                });
            };
            mediaRef.current = rec;
            rec.start();
            startedAtRef.current = Date.now();
            setRecording(true);
            setRecordSec(0);
            tickRef.current = setInterval(() => setRecordSec(Math.floor((Date.now() - startedAtRef.current) / 1000)), 250);
        } catch (e: any) {
            alert('Microphone access denied');
        }
    };

    const stopRecording = (sendIt: boolean) => {
        const rec = mediaRef.current;
        if (!rec) return;
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
        setRecording(false);
        if (!sendIt) {
            rec.ondataavailable = null;
            rec.onstop = () => rec.stream.getTracks().forEach(t => t.stop());
        }
        rec.stop();
        mediaRef.current = null;
    };

    // Pending media preview replaces the text input until sent/cancelled.
    if (pending) {
        return (
            <div className="space-y-2">
                <div className="flex items-center gap-3 p-2 bg-secondary/40 rounded-xl">
                    {pending.previewUrl && pending.kind === 'image' && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={pending.previewUrl} alt="" className="w-14 h-14 rounded-lg object-cover" />
                    )}
                    {pending.previewUrl && pending.kind === 'video' && (
                        <video src={pending.previewUrl} className="w-14 h-14 rounded-lg object-cover" />
                    )}
                    {!pending.previewUrl && (
                        <div className="w-14 h-14 rounded-lg bg-card flex items-center justify-center">
                            <Paperclip className="w-5 h-5 text-muted-foreground" />
                        </div>
                    )}
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{pending.file.name}</p>
                        <p className="text-[11px] text-muted-foreground">{(pending.file.size / 1024).toFixed(0)} KB · {pending.kind}</p>
                    </div>
                    <button onClick={cancelPending} className="text-muted-foreground hover:text-foreground" title="Discard">
                        <XIcon className="w-4 h-4" />
                    </button>
                </div>
                {(pending.kind === 'image' || pending.kind === 'video' || pending.kind === 'document') && (
                    <input value={caption} onChange={e => setCaption(e.target.value)}
                        placeholder="Add a caption…" maxLength={950}
                        className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm" />
                )}
                <button onClick={sendPending} disabled={sending}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl py-2 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Send
                </button>
            </div>
        );
    }

    // Recording overlay replaces the input row while the mic is open.
    if (recording) {
        const mm = String(Math.floor(recordSec / 60)).padStart(2, '0');
        const ss = String(recordSec % 60).padStart(2, '0');
        return (
            <div className="flex items-center gap-2">
                <button onClick={() => stopRecording(false)} title="Cancel"
                    className="bg-secondary/60 text-foreground rounded-xl px-3 py-2 text-sm flex items-center gap-1.5">
                    <XIcon className="w-4 h-4" /> Cancel
                </button>
                <div className="flex-1 flex items-center justify-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-sm font-mono text-red-300">{mm}:{ss}</span>
                </div>
                <button onClick={() => stopRecording(true)} disabled={sending} title="Send voice note"
                    className="bg-primary text-primary-foreground rounded-xl px-3 py-2 flex items-center gap-1.5 disabled:opacity-50">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
            </div>
        );
    }

    return (
        <div className="flex gap-2 items-end">
            <input ref={fileInputRef} type="file" className="hidden" onChange={onFile}
                accept="image/*,video/*,audio/*,application/pdf,application/zip,.doc,.docx,.xls,.xlsx,.txt" />
            <button onClick={pickFile} disabled={sending || disabled} title="Attach file"
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-xl disabled:opacity-40 flex-shrink-0">
                <Paperclip className="w-5 h-5" />
            </button>
            <input type="text" value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSendText(); } }}
                placeholder="Type a reply…" maxLength={950} disabled={sending}
                className="flex-1 min-w-0 bg-secondary/50 border border-border rounded-xl px-3 sm:px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
            {replyText.trim() ? (
                <button onClick={onSendText} disabled={sending}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-3 sm:px-4 py-2 flex items-center gap-2 text-sm font-medium disabled:opacity-50 flex-shrink-0">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
            ) : (
                <button onClick={startRecording} disabled={sending || disabled} title="Record voice note"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-3 sm:px-4 py-2 flex items-center gap-2 text-sm font-medium disabled:opacity-50 flex-shrink-0">
                    <Mic className="w-4 h-4" />
                </button>
            )}
        </div>
    );
}

void Square; void Mic;

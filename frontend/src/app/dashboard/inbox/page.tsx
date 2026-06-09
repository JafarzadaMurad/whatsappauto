"use client";

import { useEffect, useState } from "react";
import { Inbox, Loader2, MessageSquare, Camera, User, Send, Wrench, Wifi, WifiOff, Pause, Play } from "lucide-react";
import api from "@/lib/api";

function jidToPhone(jid: string): string {
    if (jid.startsWith('ig:')) return jid.slice(3);
    return jid.replace('@s.whatsapp.net', '').replace('@lid', '').replace(/[^0-9]/g, '');
}

type Account = {
    id: string;
    channel: "whatsapp" | "instagram";
    label: string;
    sub?: string;
    status?: string;
};

export default function InboxPage() {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loadingAccounts, setLoadingAccounts] = useState(true);
    const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);

    const [conversations, setConversations] = useState<any[]>([]);
    const [loadingConvs, setLoadingConvs] = useState(false);
    const [selectedJid, setSelectedJid] = useState<string | null>(null);

    const [messages, setMessages] = useState<any[]>([]);
    const [loadingChat, setLoadingChat] = useState(false);

    const [replyText, setReplyText] = useState("");
    const [sendingReply, setSendingReply] = useState(false);
    const [replyError, setReplyError] = useState<string | null>(null);

    // Per-contact agent pause/resume
    const [agentPaused, setAgentPaused] = useState<boolean | null>(null);
    const [pauseBusy, setPauseBusy] = useState(false);

    const refreshPauseStatus = async (jid: string) => {
        try {
            const phone = jidToPhone(jid);
            const r = await api.get(`/clients?search=${encodeURIComponent(phone)}`);
            if (r.data?.success) {
                const c = (r.data.clients as any[]).find(c => c.phone === phone || (c.phone || '').includes(phone));
                setAgentPaused(c?.agentPaused ?? false);
            } else {
                setAgentPaused(false);
            }
        } catch {
            setAgentPaused(false);
        }
    };

    const togglePause = async () => {
        if (!selectedJid || !selectedAccount) return;
        const next = !agentPaused;
        setPauseBusy(true);
        try {
            const phone = jidToPhone(selectedJid);
            await api.post('/clients/pause', { phone, channel: selectedAccount.channel, paused: next });
            setAgentPaused(next);
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        } finally { setPauseBusy(false); }
    };

    useEffect(() => {
        const load = async () => {
            try {
                const res = await api.get('/inbox/accounts');
                if (res.data.success) {
                    const list: Account[] = [
                        ...res.data.whatsapp.map((w: any) => ({
                            id: w.id, channel: 'whatsapp' as const, label: w.name, status: w.status
                        })),
                        ...res.data.instagram.map((i: any) => ({
                            id: i.id, channel: 'instagram' as const,
                            label: i.username ? '@' + i.username : 'Instagram', sub: i.igUserId
                        })),
                    ];
                    setAccounts(list);
                }
            } catch (err) { console.error(err); }
            finally { setLoadingAccounts(false); }
        };
        load();
    }, []);

    const selectAccount = async (acc: Account) => {
        setSelectedAccount(acc);
        setSelectedJid(null);
        setMessages([]);
        setConversations([]);
        setLoadingConvs(true);
        try {
            const res = await api.get(`/inbox/conversations?accountId=${acc.id}&channel=${acc.channel}`);
            if (res.data.success) setConversations(res.data.conversations);
        } catch (err) { console.error(err); }
        finally { setLoadingConvs(false); }
    };

    const selectConversation = async (jid: string) => {
        if (!selectedAccount) return;
        setSelectedJid(jid);
        setMessages([]);
        setReplyText("");
        setReplyError(null);
        setLoadingChat(true);
        setAgentPaused(null);
        refreshPauseStatus(jid);
        try {
            const res = await api.get(`/inbox/messages?accountId=${selectedAccount.id}&remoteJid=${encodeURIComponent(jid)}`);
            if (res.data.success) setMessages(res.data.messages);
        } catch (err) { console.error(err); }
        finally { setLoadingChat(false); }
    };

    const sendReply = async () => {
        if (!selectedAccount || !selectedJid || !replyText.trim()) return;
        setSendingReply(true);
        setReplyError(null);
        try {
            const res = await api.post('/inbox/reply', {
                accountId: selectedAccount.id, remoteJid: selectedJid, text: replyText.trim()
            });
            if (res.data.success) {
                if (res.data.message) setMessages(prev => [...prev, res.data.message]);
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

    const formatJid = (jid: string) => {
        if (jid.startsWith('ig:')) return jid.slice(3);
        if (jid.includes('@lid')) return jid.split('@')[0].slice(-6) + '...';
        return jid.replace('@s.whatsapp.net', '');
    };
    const convName = (c: any) => c?.username ? '@' + c.username : (c?.name || formatJid(c?.remoteJid || ''));

    const Avatar = ({ conv, size }: { conv: any; size: number }) => (
        conv?.profilePic ? (
            <img src={conv.profilePic} alt="" className="rounded-full object-cover flex-shrink-0"
                style={{ width: size, height: size }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
            <div className="rounded-full bg-secondary flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}>
                <User className="text-muted-foreground" style={{ width: size * 0.55, height: size * 0.55 }} />
            </div>
        )
    );

    const whatsappAccounts = accounts.filter(a => a.channel === 'whatsapp');
    const instagramAccounts = accounts.filter(a => a.channel === 'instagram');
    const selectedConv = conversations.find(c => c.remoteJid === selectedJid);

    return (
        <div className="max-w-7xl mx-auto space-y-4">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-3">
                    <div className="p-2 bg-primary/10 text-primary rounded-xl"><Inbox className="w-6 h-6" /></div>
                    Inbox
                </h1>
                <p className="text-sm text-muted-foreground mt-1">All conversations across your WhatsApp and Instagram accounts.</p>
            </div>

            <div className="flex gap-3 h-[640px]">
                {/* Column 1 — Accounts */}
                <div className="w-56 flex-shrink-0 bg-card border border-border rounded-2xl overflow-y-auto">
                    {loadingAccounts ? (
                        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                    ) : accounts.length === 0 ? (
                        <div className="p-4 text-center text-xs text-muted-foreground">No accounts connected yet.</div>
                    ) : (
                        <div className="p-2 space-y-3">
                            {whatsappAccounts.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-2 px-2 py-1.5">
                                        <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                                        <span className="text-xs font-semibold uppercase text-muted-foreground">WhatsApp</span>
                                    </div>
                                    {whatsappAccounts.map(acc => (
                                        <button key={acc.id} onClick={() => selectAccount(acc)}
                                            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-sm transition-colors ${selectedAccount?.id === acc.id ? 'bg-primary/10 text-primary' : 'hover:bg-secondary/50'}`}>
                                            {acc.status === 'CONNECTED' ? <Wifi className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" /> : <WifiOff className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                                            <span className="truncate">{acc.label}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {instagramAccounts.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-2 px-2 py-1.5">
                                        <Camera className="w-3.5 h-3.5 text-pink-400" />
                                        <span className="text-xs font-semibold uppercase text-muted-foreground">Instagram</span>
                                    </div>
                                    {instagramAccounts.map(acc => (
                                        <button key={acc.id} onClick={() => selectAccount(acc)}
                                            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-sm transition-colors ${selectedAccount?.id === acc.id ? 'bg-primary/10 text-primary' : 'hover:bg-secondary/50'}`}>
                                            <Camera className="w-3.5 h-3.5 text-pink-400 flex-shrink-0" />
                                            <span className="truncate">{acc.label}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Column 2 — Conversations */}
                <div className="w-72 flex-shrink-0 bg-card border border-border rounded-2xl overflow-y-auto">
                    <div className="p-3 border-b border-border">
                        <h3 className="font-semibold text-sm">{selectedAccount ? selectedAccount.label : 'Conversations'}</h3>
                    </div>
                    {!selectedAccount ? (
                        <div className="p-4 text-center text-sm text-muted-foreground">Select an account</div>
                    ) : loadingConvs ? (
                        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                    ) : conversations.length === 0 ? (
                        <div className="p-4 text-center text-sm text-muted-foreground">No conversations yet</div>
                    ) : conversations.map(conv => (
                        <button key={conv.remoteJid} onClick={() => selectConversation(conv.remoteJid)}
                            className={`w-full text-left p-3 border-b border-border/50 hover:bg-secondary/30 transition-colors flex items-center gap-3 ${selectedJid === conv.remoteJid ? 'bg-secondary/50' : ''}`}>
                            <Avatar conv={conv} size={38} />
                            <div className="min-w-0 flex-1">
                                <div className="font-medium text-sm truncate">{convName(conv)}</div>
                                {conv.name && conv.username && (
                                    <div className="text-xs text-muted-foreground truncate">{conv.name}</div>
                                )}
                                <div className="text-xs text-muted-foreground mt-0.5">{conv.messageCount} messages</div>
                            </div>
                        </button>
                    ))}
                </div>

                {/* Column 3 — Chat */}
                <div className="flex-1 bg-card border border-border rounded-2xl flex flex-col overflow-hidden">
                    {!selectedJid ? (
                        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                            Select a conversation
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center gap-3 p-3 border-b border-border flex-shrink-0">
                                <Avatar conv={selectedConv} size={36} />
                                <div className="min-w-0 flex-1">
                                    <div className="font-medium text-sm truncate">{convName(selectedConv)}</div>
                                    {selectedConv?.name && selectedConv?.username ? (
                                        <div className="text-xs text-muted-foreground truncate">{selectedConv.name}</div>
                                    ) : (
                                        <div className="text-xs text-muted-foreground truncate">+{jidToPhone(selectedJid)}</div>
                                    )}
                                </div>
                                {agentPaused !== null && (
                                    <button onClick={togglePause} disabled={pauseBusy}
                                        title={agentPaused ? 'Agent is paused for this contact — resume to let it auto-reply again' : 'Pause the agent so it stops replying to this contact'}
                                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-60 ${agentPaused
                                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                                            : 'bg-secondary/40 text-muted-foreground border-border hover:bg-secondary/70 hover:text-foreground'}`}>
                                        {pauseBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : agentPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                                        {agentPaused ? 'Resume agent' : 'Pause agent'}
                                    </button>
                                )}
                            </div>

                            <div className="flex-1 overflow-y-auto">
                                {loadingChat ? (
                                    <div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                                ) : messages.length === 0 ? (
                                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No messages logged yet.</div>
                                ) : (
                                    <div className="p-4 space-y-4">
                                        {messages.map((msg: any) => (
                                            <div key={msg.id} className="space-y-2">
                                                {msg.userMessage && (
                                                    <div className="flex justify-start">
                                                        <div className="bg-secondary/50 rounded-xl px-4 py-2 max-w-[70%] text-sm">{msg.userMessage}</div>
                                                    </div>
                                                )}
                                                {msg.toolCalls && (msg.toolCalls as any[]).length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5 pl-2">
                                                        {(msg.toolCalls as any[]).map((tc: any, i: number) => (
                                                            <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                                                <Wrench className="w-3 h-3" /> {tc.toolName}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                <div className="flex justify-end">
                                                    <div className="bg-primary/10 border border-primary/20 rounded-xl px-4 py-2 max-w-[70%] text-sm">
                                                        {msg.agentReply}
                                                        <div className="text-[10px] text-muted-foreground mt-1 text-right">
                                                            {msg.provider === 'MANUAL' ? 'Manual reply' : `${msg.promptTokens + msg.completionTokens} tokens`}
                                                            {' '}&bull;{' '}{new Date(msg.createdAt).toLocaleTimeString()}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="border-t border-border p-3 flex-shrink-0">
                                {replyError && <div className="text-xs text-red-400 mb-2">{replyError}</div>}
                                <div className="flex gap-2">
                                    <input type="text" value={replyText}
                                        onChange={e => setReplyText(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                                        placeholder="Type a reply…" maxLength={950} disabled={sendingReply}
                                        className="flex-1 bg-secondary/50 border border-border rounded-xl px-4 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60" />
                                    <button onClick={sendReply} disabled={sendingReply || !replyText.trim()}
                                        className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-4 flex items-center gap-2 text-sm font-medium transition-all disabled:opacity-50">
                                        {sendingReply ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

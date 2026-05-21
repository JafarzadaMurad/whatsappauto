"use client";

import { useEffect, useState, use } from "react";
import { ArrowLeft, Loader2, MessageSquare, MessagesSquare, User, Send, Heart, Camera, X } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";

type Tab = "dms" | "comments";

export default function InstagramAccountPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const [profile, setProfile] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<Tab>("dms");

    // DM state
    const [conversations, setConversations] = useState<any[]>([]);
    const [loadingConvs, setLoadingConvs] = useState(false);
    const [selectedJid, setSelectedJid] = useState<string | null>(null);
    const [messages, setMessages] = useState<any[]>([]);
    const [loadingChat, setLoadingChat] = useState(false);
    const [replyText, setReplyText] = useState("");
    const [sendingReply, setSendingReply] = useState(false);
    const [replyError, setReplyError] = useState<string | null>(null);

    // Comments state
    const [media, setMedia] = useState<any[]>([]);
    const [loadingMedia, setLoadingMedia] = useState(false);
    const [mediaError, setMediaError] = useState<string | null>(null);
    const [selectedMedia, setSelectedMedia] = useState<any | null>(null);
    const [comments, setComments] = useState<any[]>([]);
    const [loadingComments, setLoadingComments] = useState(false);
    const [commentsError, setCommentsError] = useState<string | null>(null);
    const [commentReply, setCommentReply] = useState<Record<string, string>>({});
    const [replyingComment, setReplyingComment] = useState<string | null>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await api.get(`/instagram/accounts/${id}/profile`);
                if (res.data.success) setProfile(res.data.profile);
            } catch (err) { console.error(err); }
            finally { setLoading(false); }
        };
        load();
    }, [id]);

    useEffect(() => {
        if (tab === "dms" && conversations.length === 0) loadConversations();
        if (tab === "comments" && media.length === 0) loadMedia();
    }, [tab]);

    const loadConversations = async () => {
        setLoadingConvs(true);
        try {
            const res = await api.get(`/inbox/conversations?accountId=${id}&channel=instagram`);
            if (res.data.success) setConversations(res.data.conversations);
        } catch (err) { console.error(err); }
        finally { setLoadingConvs(false); }
    };

    const selectConversation = async (jid: string) => {
        setSelectedJid(jid);
        setMessages([]);
        setReplyText("");
        setReplyError(null);
        setLoadingChat(true);
        try {
            const res = await api.get(`/inbox/messages?accountId=${id}&remoteJid=${encodeURIComponent(jid)}`);
            if (res.data.success) setMessages(res.data.messages);
        } catch (err) { console.error(err); }
        finally { setLoadingChat(false); }
    };

    const sendReply = async () => {
        if (!selectedJid || !replyText.trim()) return;
        setSendingReply(true);
        setReplyError(null);
        try {
            const res = await api.post('/inbox/reply', { accountId: id, remoteJid: selectedJid, text: replyText.trim() });
            if (res.data.success) {
                if (res.data.message) setMessages(prev => [...prev, res.data.message]);
                setReplyText("");
            } else setReplyError(res.data.message || 'Failed to send');
        } catch (err: any) {
            setReplyError(err.response?.data?.message || err.message || 'Failed to send');
        } finally { setSendingReply(false); }
    };

    const loadMedia = async () => {
        setLoadingMedia(true);
        setMediaError(null);
        try {
            const res = await api.get(`/instagram/accounts/${id}/media`);
            if (res.data.success) setMedia(res.data.media);
            else setMediaError(res.data.message || 'Failed to load posts');
        } catch (err: any) {
            setMediaError(err.response?.data?.message || err.message);
        } finally { setLoadingMedia(false); }
    };

    const openMedia = async (m: any) => {
        setSelectedMedia(m);
        setComments([]);
        setCommentsError(null);
        setLoadingComments(true);
        try {
            const res = await api.get(`/instagram/accounts/${id}/media/${m.id}/comments`);
            if (res.data.success) setComments(res.data.comments);
            else setCommentsError(res.data.message || 'Failed to load comments');
        } catch (err: any) {
            setCommentsError(err.response?.data?.message || err.message);
        } finally { setLoadingComments(false); }
    };

    const replyToComment = async (commentId: string) => {
        const text = (commentReply[commentId] || '').trim();
        if (!text) return;
        setReplyingComment(commentId);
        try {
            const res = await api.post(`/instagram/accounts/${id}/comments/${commentId}/reply`, { text });
            if (res.data.success) {
                setCommentReply(prev => ({ ...prev, [commentId]: '' }));
                if (selectedMedia) openMedia(selectedMedia);
            } else {
                alert(res.data.message || 'Failed to reply');
            }
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        } finally { setReplyingComment(null); }
    };

    const convName = (c: any) => c?.username ? '@' + c.username : (c?.name || (c?.remoteJid || '').replace('ig:', ''));
    const Avatar = ({ conv, size }: { conv: any; size: number }) => (
        conv?.profilePic ? (
            <img src={conv.profilePic} alt="" className="rounded-full object-cover flex-shrink-0" style={{ width: size, height: size }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
            <div className="rounded-full bg-secondary flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}>
                <User className="text-muted-foreground" style={{ width: size * 0.55, height: size * 0.55 }} />
            </div>
        )
    );

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    const selectedConv = conversations.find(c => c.remoteJid === selectedJid);

    return (
        <div className="max-w-6xl mx-auto space-y-5">
            <Link href="/dashboard/instagram" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to Instagram
            </Link>

            {/* Profile header */}
            <div className="bg-card border border-border rounded-2xl p-5 flex items-center gap-5">
                {profile?.profile_picture_url ? (
                    <img src={profile.profile_picture_url} alt="" className="w-20 h-20 rounded-full object-cover ring-2 ring-pink-500/30" />
                ) : (
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-pink-500/20 to-purple-500/20 flex items-center justify-center">
                        <Camera className="w-8 h-8 text-pink-400" />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-xl font-bold">@{profile?.username || 'unknown'}</h1>
                        {profile?.account_type && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                {profile.account_type}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-sm">
                        <span><span className="font-bold">{profile?.followers_count ?? 0}</span> <span className="text-muted-foreground">followers</span></span>
                        <span><span className="font-bold">{profile?.media_count ?? 0}</span> <span className="text-muted-foreground">posts</span></span>
                    </div>
                    {profile?.biography && <p className="text-sm text-muted-foreground mt-1">{profile.biography}</p>}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-secondary/30 p-1 rounded-xl w-fit">
                {([
                    { key: 'dms' as const, label: 'Direct Messages', icon: MessagesSquare },
                    { key: 'comments' as const, label: 'Comments', icon: MessageSquare },
                ]).map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.key ? 'bg-card text-foreground shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground'}`}>
                        <t.icon className="w-4 h-4" /> {t.label}
                    </button>
                ))}
            </div>

            {/* DM tab */}
            {tab === 'dms' && (
                <div className="flex gap-4 h-[560px]">
                    <div className="w-72 flex-shrink-0 bg-card border border-border rounded-2xl overflow-y-auto">
                        <div className="p-3 border-b border-border"><h3 className="font-semibold text-sm">Conversations</h3></div>
                        {loadingConvs ? (
                            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                        ) : conversations.length === 0 ? (
                            <div className="p-4 text-center text-sm text-muted-foreground">No conversations yet</div>
                        ) : conversations.map(conv => (
                            <button key={conv.remoteJid} onClick={() => selectConversation(conv.remoteJid)}
                                className={`w-full text-left p-3 border-b border-border/50 hover:bg-secondary/30 transition-colors flex items-center gap-3 ${selectedJid === conv.remoteJid ? 'bg-secondary/50' : ''}`}>
                                <Avatar conv={conv} size={38} />
                                <div className="min-w-0 flex-1">
                                    <div className="font-medium text-sm truncate">{convName(conv)}</div>
                                    <div className="text-xs text-muted-foreground mt-0.5">{conv.messageCount} messages</div>
                                </div>
                            </button>
                        ))}
                    </div>
                    <div className="flex-1 bg-card border border-border rounded-2xl flex flex-col overflow-hidden">
                        {!selectedJid ? (
                            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Select a conversation</div>
                        ) : (
                            <>
                                <div className="flex items-center gap-3 p-3 border-b border-border flex-shrink-0">
                                    <Avatar conv={selectedConv} size={36} />
                                    <div className="font-medium text-sm truncate">{convName(selectedConv)}</div>
                                </div>
                                <div className="flex-1 overflow-y-auto">
                                    {loadingChat ? (
                                        <div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                                    ) : messages.length === 0 ? (
                                        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No messages yet.</div>
                                    ) : (
                                        <div className="p-4 space-y-4">
                                            {messages.map((msg: any) => (
                                                <div key={msg.id} className="space-y-2">
                                                    {msg.userMessage && (
                                                        <div className="flex justify-start">
                                                            <div className="bg-secondary/50 rounded-xl px-4 py-2 max-w-[70%] text-sm">{msg.userMessage}</div>
                                                        </div>
                                                    )}
                                                    <div className="flex justify-end">
                                                        <div className="bg-primary/10 border border-primary/20 rounded-xl px-4 py-2 max-w-[70%] text-sm">
                                                            {msg.agentReply}
                                                            <div className="text-[10px] text-muted-foreground mt-1 text-right">
                                                                {msg.provider === 'MANUAL' ? 'Manual' : `${msg.promptTokens + msg.completionTokens} tok`} &bull; {new Date(msg.createdAt).toLocaleTimeString()}
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
                                        <input type="text" value={replyText} onChange={e => setReplyText(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                                            placeholder="Type a reply…" maxLength={950} disabled={sendingReply}
                                            className="flex-1 bg-secondary/50 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60" />
                                        <button onClick={sendReply} disabled={sendingReply || !replyText.trim()}
                                            className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-4 flex items-center text-sm font-medium transition-all disabled:opacity-50">
                                            {sendingReply ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Comments tab */}
            {tab === 'comments' && (
                <div>
                    <h3 className="font-semibold mb-1">Recent Posts</h3>
                    <p className="text-sm text-muted-foreground mb-3">Click a post to view and reply to its comments.</p>
                    {loadingMedia ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                    ) : mediaError ? (
                        <div className="bg-secondary/30 border border-dashed border-border rounded-xl p-6 text-center text-sm text-muted-foreground">{mediaError}</div>
                    ) : media.length === 0 ? (
                        <div className="bg-secondary/30 border border-dashed border-border rounded-xl p-6 text-center text-sm text-muted-foreground">No posts found.</div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {media.map(m => (
                                <button key={m.id} onClick={() => openMedia(m)}
                                    className="group relative aspect-square rounded-xl overflow-hidden bg-secondary border border-border">
                                    {(m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url) ? (
                                        <img src={m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center"><Camera className="w-6 h-6 text-muted-foreground" /></div>
                                    )}
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-3 text-white opacity-0 group-hover:opacity-100">
                                        <span className="flex items-center gap-1 text-sm font-medium"><MessageSquare className="w-4 h-4" /> {m.comments_count ?? 0}</span>
                                        <span className="flex items-center gap-1 text-sm font-medium"><Heart className="w-4 h-4" /> {m.like_count ?? 0}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Comments modal */}
            {selectedMedia && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setSelectedMedia(null)}>
                    <div className="bg-card border border-border rounded-2xl w-full max-w-3xl max-h-[85vh] flex overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="w-1/2 bg-secondary flex-shrink-0 hidden sm:block">
                            {(selectedMedia.media_type === 'VIDEO' ? selectedMedia.thumbnail_url : selectedMedia.media_url) && (
                                <img src={selectedMedia.media_type === 'VIDEO' ? selectedMedia.thumbnail_url : selectedMedia.media_url} alt="" className="w-full h-full object-cover" />
                            )}
                        </div>
                        <div className="flex-1 flex flex-col min-w-0">
                            <div className="flex items-center justify-between p-3 border-b border-border">
                                <h3 className="font-semibold text-sm">Comments ({comments.length})</h3>
                                <button onClick={() => setSelectedMedia(null)} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                                {loadingComments ? (
                                    <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                                ) : commentsError ? (
                                    <div className="text-sm text-muted-foreground text-center py-6">{commentsError}</div>
                                ) : comments.length === 0 ? (
                                    <div className="text-sm text-muted-foreground text-center py-6">No comments yet.</div>
                                ) : comments.map(c => (
                                    <div key={c.id} className="border-b border-border/50 pb-3 last:border-0">
                                        <div className="text-sm"><span className="font-semibold">@{c.username}</span> {c.text}</div>
                                        <div className="text-[10px] text-muted-foreground mt-0.5">{c.timestamp ? new Date(c.timestamp).toLocaleString() : ''}</div>
                                        {c.replies?.data?.length > 0 && (
                                            <div className="mt-2 pl-3 border-l border-border space-y-1">
                                                {c.replies.data.map((r: any) => (
                                                    <div key={r.id} className="text-xs"><span className="font-semibold">@{r.username}</span> {r.text}</div>
                                                ))}
                                            </div>
                                        )}
                                        <div className="flex gap-2 mt-2">
                                            <input type="text" value={commentReply[c.id] || ''}
                                                onChange={e => setCommentReply(prev => ({ ...prev, [c.id]: e.target.value }))}
                                                onKeyDown={e => { if (e.key === 'Enter') replyToComment(c.id); }}
                                                placeholder="Reply…"
                                                className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                            <button onClick={() => replyToComment(c.id)} disabled={replyingComment === c.id || !(commentReply[c.id] || '').trim()}
                                                className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-3 text-xs font-medium disabled:opacity-50">
                                                {replyingComment === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Reply'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

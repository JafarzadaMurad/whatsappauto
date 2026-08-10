"use client";

// Who is using the platform right now, and where.
//
// Everything here is live-only: presence lives in the server's memory and
// disappears with the process. That is deliberate — presence is worthless
// five minutes after the fact, and writing every route change of every
// tab to the database would be the busiest table we own.
//
// For what somebody actually did, click through to their row: copilot
// sessions and credit spend are real records and come from the database.

import { useEffect, useState } from "react";
import { Users, Loader2, Monitor, Clock, ChevronRight, X, Coins } from "lucide-react";
import api from "@/lib/api";

type OnlineUser = {
    userId: string;
    name: string | null;
    email: string | null;
    role: string | null;
    workspaceName: string | null;
    path: string | null;
    tabs: number;
    connectedAt: number;
    lastSeenAt: number;
    userAgent: string | null;
    ip: string | null;
    recentPaths: { path: string; at: number }[];
};

type RecentUser = {
    userId: string;
    name: string | null;
    email: string | null;
    workspaceName: string | null;
    at: number;
    path: string | null;
};

type Detail = {
    user: { id: string; name: string | null; email: string; role: string; createdAt: string };
    online: boolean;
    path: string | null;
    lastSeenAt: number | null;
    tabs: number;
    userAgent: string | null;
    ip: string | null;
    recentPaths: { path: string; at: number }[];
    sessions: { id: string; title: string | null; mode: string; totalCredits: number; updatedAt: string }[];
    ledger: {
        createdAt: string; provider: string; model: string; cause: string;
        creditsUsed: number; inputTokens: number; outputTokens: number;
    }[];
};

const ago = (ms: number) => {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
};

// A user agent string is unreadable at a glance; the browser name is the
// only part anyone acts on.
const browserOf = (ua: string | null) => {
    if (!ua) return "—";
    if (/edg\//i.test(ua)) return "Edge";
    if (/chrome|crios/i.test(ua)) return "Chrome";
    if (/firefox/i.test(ua)) return "Firefox";
    if (/safari/i.test(ua)) return "Safari";
    return "Other";
};

export default function AdminPresencePage() {
    const [online, setOnline] = useState<OnlineUser[]>([]);
    const [recent, setRecent] = useState<RecentUser[]>([]);
    const [stats, setStats] = useState<{ onlineUsers: number; openTabs: number } | null>(null);
    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState<Detail | null>(null);
    const [detailBusy, setDetailBusy] = useState(false);

    const load = async () => {
        try {
            const r = await api.get('/admin/presence');
            if (r.data.success) {
                setOnline(r.data.online || []);
                setRecent(r.data.recent || []);
                setStats(r.data.stats || null);
            }
        } catch { /* a blank list beats an error banner on a live view */ }
        finally { setLoading(false); }
    };

    // Polled rather than pushed. The list changes as fast as people click,
    // and a 10-second refresh is indistinguishable from live while costing
    // one cheap in-memory read.
    useEffect(() => {
        load();
        const id = setInterval(load, 10_000);
        return () => clearInterval(id);
    }, []);

    const openDetail = async (userId: string) => {
        setDetailBusy(true);
        try {
            const r = await api.get(`/admin/presence/${userId}`);
            if (r.data.success) setDetail(r.data);
        } catch { /* leave the list alone */ }
        finally { setDetailBusy(false); }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-3">
                    <div className="p-2 bg-primary/10 text-primary rounded-xl"><Users className="w-6 h-6" /></div>
                    Who&apos;s online
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Live view of open dashboard tabs and the page each person is on. Refreshes every 10 seconds.
                    Presence is held in memory, so a server restart empties this list — it does not mean everyone left.
                </p>
            </div>

            <div className="grid grid-cols-2 gap-3 max-w-md">
                <div className="bg-card border border-border rounded-2xl px-4 py-3">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <Users className="w-3.5 h-3.5" /> People online
                    </div>
                    <div className="mt-1 text-xl font-bold">{stats?.onlineUsers ?? 0}</div>
                </div>
                <div className="bg-card border border-border rounded-2xl px-4 py-3">
                    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <Monitor className="w-3.5 h-3.5" /> Open tabs
                    </div>
                    <div className="mt-1 text-xl font-bold">{stats?.openTabs ?? 0}</div>
                </div>
            </div>

            <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                    <h2 className="font-semibold text-sm">Online now</h2>
                </div>
                {online.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nobody has a dashboard tab open.</p>
                ) : (
                    <div className="divide-y divide-border">
                        {online.map(u => (
                            <button key={u.userId} onClick={() => openDetail(u.userId)}
                                className="w-full text-left px-4 py-3 hover:bg-secondary/40 flex items-center gap-3">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium truncate">
                                        {u.name || u.email || u.userId}
                                        {u.role === 'ADMIN' && (
                                            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">admin</span>
                                        )}
                                    </div>
                                    <div className="text-xs text-muted-foreground truncate">
                                        {u.workspaceName || 'no workspace'} · {browserOf(u.userAgent)}
                                        {u.tabs > 1 && ` · ${u.tabs} tabs`}
                                    </div>
                                </div>
                                <div className="hidden sm:block text-right min-w-0">
                                    <div className="text-xs font-mono truncate max-w-[16rem]">{u.path || '—'}</div>
                                    <div className="text-[10px] text-muted-foreground">active {ago(u.lastSeenAt)}</div>
                                </div>
                                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {recent.length > 0 && (
                <div className="bg-card border border-border rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-border">
                        <h2 className="font-semibold text-sm flex items-center gap-2">
                            <Clock className="w-4 h-4 text-muted-foreground" /> Recently here
                        </h2>
                    </div>
                    <div className="divide-y divide-border">
                        {recent.map(u => (
                            <button key={u.userId} onClick={() => openDetail(u.userId)}
                                className="w-full text-left px-4 py-2.5 hover:bg-secondary/40 flex items-center gap-3">
                                <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm truncate">{u.name || u.email || u.userId}</div>
                                    <div className="text-xs text-muted-foreground truncate">{u.workspaceName || 'no workspace'}</div>
                                </div>
                                <div className="text-right">
                                    <div className="text-xs font-mono truncate max-w-[14rem]">{u.path || '—'}</div>
                                    <div className="text-[10px] text-muted-foreground">left {ago(u.at)}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {(detail || detailBusy) && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto"
                    onClick={() => { setDetail(null); }}>
                    <div className="bg-card border border-border rounded-2xl max-w-2xl w-full my-8"
                        onClick={e => e.stopPropagation()}>
                        {detailBusy && !detail ? (
                            <div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                        ) : detail && (
                            <>
                                <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <h3 className="font-semibold truncate">{detail.user.name || detail.user.email}</h3>
                                        <p className="text-xs text-muted-foreground truncate">{detail.user.email}</p>
                                    </div>
                                    <button onClick={() => setDetail(null)}
                                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary shrink-0">
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>

                                <div className="p-5 space-y-5">
                                    <div className="grid grid-cols-2 gap-3 text-xs">
                                        <div>
                                            <div className="text-muted-foreground">Status</div>
                                            <div className={detail.online ? 'text-emerald-400' : ''}>
                                                {detail.online ? `online · ${detail.tabs} tab${detail.tabs === 1 ? '' : 's'}` : 'offline'}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-muted-foreground">Last active</div>
                                            <div>{detail.lastSeenAt ? ago(detail.lastSeenAt) : '—'}</div>
                                        </div>
                                        <div className="min-w-0">
                                            <div className="text-muted-foreground">Current page</div>
                                            <div className="font-mono truncate">{detail.path || '—'}</div>
                                        </div>
                                        <div>
                                            <div className="text-muted-foreground">Browser · IP</div>
                                            <div className="truncate">{browserOf(detail.userAgent)} · {detail.ip || '—'}</div>
                                        </div>
                                    </div>

                                    {detail.recentPaths.length > 0 && (
                                        <div>
                                            <h4 className="text-xs font-medium text-muted-foreground mb-1.5">Pages visited this session</h4>
                                            <div className="space-y-0.5 max-h-40 overflow-y-auto">
                                                {detail.recentPaths.map((p, i) => (
                                                    <div key={i} className="flex items-center justify-between gap-3 text-[11px]">
                                                        <span className="font-mono truncate">{p.path}</span>
                                                        <span className="text-muted-foreground shrink-0">{ago(p.at)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {detail.sessions.length > 0 && (
                                        <div>
                                            <h4 className="text-xs font-medium text-muted-foreground mb-1.5">Copilot chats</h4>
                                            <div className="space-y-0.5 max-h-40 overflow-y-auto">
                                                {detail.sessions.map(s => (
                                                    <div key={s.id} className="flex items-center justify-between gap-3 text-[11px]">
                                                        <span className="truncate">{s.title || 'Untitled'}</span>
                                                        <span className="text-muted-foreground shrink-0">
                                                            {s.totalCredits > 0 && `${s.totalCredits} cai · `}
                                                            {new Date(s.updatedAt).toLocaleDateString()}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {detail.ledger.length > 0 && (
                                        <div>
                                            <h4 className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                                                <Coins className="w-3.5 h-3.5" /> Recent AI spend
                                            </h4>
                                            <div className="space-y-0.5 max-h-48 overflow-y-auto">
                                                {detail.ledger.map((l, i) => (
                                                    <div key={i} className="flex items-center justify-between gap-3 text-[11px]">
                                                        <span className="font-mono truncate">{l.model}</span>
                                                        <span className="text-muted-foreground shrink-0">
                                                            {l.cause} · {l.creditsUsed} cai · {new Date(l.createdAt).toLocaleString()}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

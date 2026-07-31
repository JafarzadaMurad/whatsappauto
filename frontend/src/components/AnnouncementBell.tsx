"use client";

// What's-new bell.
//
// Sits in the dashboard header. Badge counts unread announcements;
// opening the panel shows them newest first and marks each one read as
// the user acts on it. Polls slowly — announcements are rare, so a
// 5-minute refresh is plenty and costs nothing.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Sparkles, Wrench, Info, X, Check } from "lucide-react";
import api from "@/lib/api";

type Announcement = {
    id: string;
    title: string;
    body: string;
    kind: 'feature' | 'fix' | 'notice' | string;
    linkUrl: string | null;
    linkLabel: string | null;
    publishedAt: string | null;
    read: boolean;
};

const KIND = {
    feature: { icon: Sparkles, tone: 'text-primary', label: 'New' },
    fix: { icon: Wrench, tone: 'text-amber-400', label: 'Fixed' },
    notice: { icon: Info, tone: 'text-muted-foreground', label: 'Notice' },
} as const;

export default function AnnouncementBell() {
    const [items, setItems] = useState<Announcement[]>([]);
    const [unread, setUnread] = useState(0);
    const [open, setOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement | null>(null);

    const load = async () => {
        try {
            const r = await api.get('/announcements');
            if (r.data?.success) {
                setItems(r.data.announcements || []);
                setUnread(r.data.unreadCount || 0);
            }
        } catch { /* silent — the bell is never worth an error toast */ }
    };

    useEffect(() => {
        load();
        const t = setInterval(load, 5 * 60_000);
        return () => clearInterval(t);
    }, []);

    // Close on outside click / Escape.
    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onClick);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const markRead = async (id: string) => {
        setItems(prev => prev.map(a => a.id === id ? { ...a, read: true } : a));
        setUnread(n => Math.max(0, n - 1));
        try { await api.post(`/announcements/${id}/read`); } catch { load(); }
    };

    const markAll = async () => {
        setItems(prev => prev.map(a => ({ ...a, read: true })));
        setUnread(0);
        try { await api.post('/announcements/read-all'); } catch { load(); }
    };

    return (
        <div className="relative" ref={panelRef}>
            <button onClick={() => setOpen(o => !o)}
                title="What's new"
                className="relative p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors">
                <Bell className="w-5 h-5" />
                {unread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                        {unread > 9 ? '9+' : unread}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute right-0 mt-2 w-[360px] max-w-[calc(100vw-2rem)] bg-card border border-border rounded-2xl shadow-2xl z-50 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                        <h3 className="font-semibold text-sm">What's new</h3>
                        <div className="flex items-center gap-1">
                            {unread > 0 && (
                                <button onClick={markAll}
                                    className="text-[11px] text-primary hover:underline px-2 py-1">
                                    Mark all read
                                </button>
                            )}
                            <button onClick={() => setOpen(false)}
                                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    <div className="max-h-[420px] overflow-y-auto">
                        {items.length === 0 ? (
                            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                                Nothing new right now.
                            </div>
                        ) : items.map(a => {
                            const meta = KIND[a.kind as keyof typeof KIND] ?? KIND.notice;
                            const Icon = meta.icon;
                            return (
                                <div key={a.id}
                                    className={`px-4 py-3 border-b border-border/60 last:border-0 ${a.read ? '' : 'bg-primary/[0.04]'}`}>
                                    <div className="flex items-start gap-2.5">
                                        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${meta.tone}`} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-medium">{a.title}</span>
                                                {!a.read && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-words">
                                                {a.body}
                                            </p>
                                            <div className="flex items-center gap-3 mt-2">
                                                {a.linkUrl && (
                                                    <Link href={a.linkUrl}
                                                        onClick={() => { markRead(a.id); setOpen(false); }}
                                                        className="text-[11px] text-primary hover:underline font-medium">
                                                        {a.linkLabel || 'Open'} →
                                                    </Link>
                                                )}
                                                {!a.read && (
                                                    <button onClick={() => markRead(a.id)}
                                                        className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                                                        <Check className="w-3 h-3" /> Mark read
                                                    </button>
                                                )}
                                                {a.publishedAt && (
                                                    <span className="text-[10px] text-muted-foreground ml-auto">
                                                        {new Date(a.publishedAt).toLocaleDateString()}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

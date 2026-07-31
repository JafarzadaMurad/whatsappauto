"use client";

// Spotlight dialog for announcements the admin marked as needing
// immediate attention. Fires once per announcement — dismissing marks
// it read, so it never comes back — and only for notices explicitly
// flagged showAsModal. Everything else stays in the bell, because a
// popup on every notice trains people to dismiss without reading.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Wrench, Info, X, ArrowRight } from "lucide-react";
import api from "@/lib/api";

type Announcement = {
    id: string;
    title: string;
    body: string;
    kind: 'feature' | 'fix' | 'notice' | string;
    linkUrl: string | null;
    linkLabel: string | null;
    showAsModal: boolean;
    publishedAt: string | null;
    read: boolean;
};

const KIND = {
    feature: { icon: Sparkles, tone: 'text-primary', ring: 'bg-primary/10', label: "What's new" },
    fix: { icon: Wrench, tone: 'text-amber-400', ring: 'bg-amber-500/10', label: 'Fixed' },
    notice: { icon: Info, tone: 'text-muted-foreground', ring: 'bg-secondary', label: 'Notice' },
} as const;

export default function AnnouncementModal() {
    const [queue, setQueue] = useState<Announcement[]>([]);
    const [dismissing, setDismissing] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const r = await api.get('/announcements');
                if (cancelled || !r.data?.success) return;
                const pending = (r.data.announcements as Announcement[])
                    .filter(a => a.showAsModal && !a.read);
                // Oldest first so a backlog is read in the order it
                // shipped rather than newest-first.
                setQueue(pending.reverse());
            } catch { /* the dialog is never worth an error */ }
        })();
        return () => { cancelled = true; };
    }, []);

    const current = queue[0];

    const dismiss = async () => {
        if (!current || dismissing) return;
        setDismissing(true);
        try {
            await api.post(`/announcements/${current.id}/read`);
            // Let the bell refresh its badge without a page reload.
            window.dispatchEvent(new CustomEvent('announcements:changed'));
        } catch { /* still advance — a stuck dialog is worse */ }
        setQueue(q => q.slice(1));
        setDismissing(false);
    };

    // Escape closes, matching every other dialog in the app.
    useEffect(() => {
        if (!current) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current?.id, dismissing]);

    if (!current) return null;

    const meta = KIND[current.kind as keyof typeof KIND] ?? KIND.notice;
    const Icon = meta.icon;

    return (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={dismiss}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}>
                <div className="p-6 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${meta.ring}`}>
                            <Icon className={`w-6 h-6 ${meta.tone}`} />
                        </div>
                        <button onClick={dismiss}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div>
                        <div className={`text-[11px] font-semibold uppercase tracking-wide ${meta.tone}`}>
                            {meta.label}
                        </div>
                        <h2 className="text-xl font-bold mt-1">{current.title}</h2>
                        <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap break-words leading-relaxed">
                            {current.body}
                        </p>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                        {current.linkUrl && (
                            <Link href={current.linkUrl} onClick={dismiss}
                                className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2">
                                {current.linkLabel || 'Take a look'}
                                <ArrowRight className="w-4 h-4" />
                            </Link>
                        )}
                        <button onClick={dismiss} disabled={dismissing}
                            className={`rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-60 ${
                                current.linkUrl
                                    ? 'text-muted-foreground hover:bg-secondary/50'
                                    : 'flex-1 bg-primary hover:bg-primary/90 text-primary-foreground'
                            }`}>
                            {current.linkUrl ? 'Later' : 'Got it'}
                        </button>
                    </div>

                    {queue.length > 1 && (
                        <p className="text-[11px] text-muted-foreground text-center">
                            {queue.length - 1} more update{queue.length - 1 === 1 ? '' : 's'} after this
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

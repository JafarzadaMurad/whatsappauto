"use client";

// Admin → Announcements. Write a short notice, publish it, and every
// user sees it in the what's-new bell until they dismiss it. Read count
// shows how many have actually seen each one.

import { useEffect, useState } from "react";
import {
    Megaphone, Loader2, Plus, Trash2, Eye, EyeOff, Save, X,
    Sparkles, Wrench, Info, Users,
} from "lucide-react";
import api from "@/lib/api";

type Announcement = {
    id: string;
    title: string;
    body: string;
    kind: 'feature' | 'fix' | 'notice' | string;
    linkUrl: string | null;
    linkLabel: string | null;
    isPublished: boolean;
    showAsModal: boolean;
    publishedAt: string | null;
    createdAt: string;
    _count?: { reads: number };
};

const KIND_META = {
    feature: { icon: Sparkles, tone: 'text-primary', label: 'Feature' },
    fix: { icon: Wrench, tone: 'text-amber-400', label: 'Fix' },
    notice: { icon: Info, tone: 'text-muted-foreground', label: 'Notice' },
} as const;

type Kind = 'feature' | 'fix' | 'notice';
type Draft = {
    id?: string;
    title: string;
    body: string;
    kind: Kind;
    linkUrl: string;
    linkLabel: string;
    isPublished: boolean;
    showAsModal: boolean;
};

const empty = (): Draft => ({
    title: '', body: '', kind: 'feature',
    linkUrl: '', linkLabel: '', isPublished: true, showAsModal: false,
});

export default function AdminAnnouncementsPage() {
    const [rows, setRows] = useState<Announcement[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<Draft | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        try {
            const r = await api.get('/announcements/admin/all');
            if (r.data?.success) setRows(r.data.announcements);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const save = async () => {
        if (!editing) return;
        setSaving(true); setError(null);
        try {
            const payload = {
                title: editing.title.trim(),
                body: editing.body.trim(),
                kind: editing.kind,
                linkUrl: editing.linkUrl.trim() || null,
                linkLabel: editing.linkLabel.trim() || null,
                isPublished: editing.isPublished,
                showAsModal: editing.showAsModal,
            };
            if (editing.id) await api.put(`/announcements/admin/${editing.id}`, payload);
            else await api.post('/announcements/admin', payload);
            setEditing(null);
            load();
        } catch (err: any) {
            setError(err.response?.data?.errors?.[0]?.message || err.response?.data?.message || err.message);
        } finally { setSaving(false); }
    };

    const togglePublish = async (a: Announcement) => {
        try {
            await api.put(`/announcements/admin/${a.id}`, { isPublished: !a.isPublished });
            load();
        } catch (err: any) { alert(err.response?.data?.message || err.message); }
    };

    const remove = async (a: Announcement) => {
        if (!confirm(`Delete "${a.title}"? Everyone loses it from their feed.`)) return;
        try { await api.delete(`/announcements/admin/${a.id}`); load(); }
        catch (err: any) { alert(err.response?.data?.message || err.message); }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-xl"><Megaphone className="w-6 h-6" /></div>
                        Announcements
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Tell users what shipped. Published notices appear in the bell at the top of every dashboard page until dismissed.
                    </p>
                </div>
                <button onClick={() => { setEditing(empty()); setError(null); }}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-4 py-2.5 flex items-center gap-2">
                    <Plus className="w-5 h-5" /> New announcement
                </button>
            </div>

            {rows.length === 0 ? (
                <div className="bg-card border border-dashed border-border rounded-2xl p-12 text-center text-sm text-muted-foreground">
                    Nothing published yet. Write the first notice so users discover what's new.
                </div>
            ) : (
                <div className="space-y-2">
                    {rows.map(a => {
                        const meta = KIND_META[a.kind as keyof typeof KIND_META] ?? KIND_META.notice;
                        const Icon = meta.icon;
                        return (
                            <div key={a.id} className="bg-card border border-border rounded-2xl p-4">
                                <div className="flex items-start gap-3">
                                    <Icon className={`w-4 h-4 mt-1 flex-shrink-0 ${meta.tone}`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-semibold">{a.title}</span>
                                            <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                                                a.isPublished
                                                    ? 'bg-emerald-500/15 text-emerald-400'
                                                    : 'bg-secondary text-muted-foreground'
                                            }`}>
                                                {a.isPublished ? 'Published' : 'Draft'}
                                            </span>
                                            {a.showAsModal && (
                                                <span title="Interrupts users with a popup"
                                                    className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                                                    Popup
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-words">{a.body}</p>
                                        <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                                            {a.linkUrl && <span className="font-mono truncate">{a.linkLabel || 'Open'} → {a.linkUrl}</span>}
                                            <span className="inline-flex items-center gap-1 ml-auto flex-shrink-0">
                                                <Users className="w-3 h-3" /> {a._count?.reads ?? 0} read
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                        <button onClick={() => togglePublish(a)}
                                            title={a.isPublished ? 'Unpublish' : 'Publish'}
                                            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                                            {a.isPublished ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                        <button onClick={() => {
                                            setEditing({
                                                id: a.id, title: a.title, body: a.body,
                                                kind: a.kind as Kind,
                                                linkUrl: a.linkUrl || '', linkLabel: a.linkLabel || '',
                                                isPublished: a.isPublished,
                                                showAsModal: a.showAsModal,
                                            });
                                            setError(null);
                                        }}
                                            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                                            <Save className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => remove(a)}
                                            className="p-2 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {editing && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
                    <div className="bg-card border border-border rounded-2xl w-full max-w-lg p-5 space-y-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h2 className="font-semibold">{editing.id ? 'Edit announcement' : 'New announcement'}</h2>
                            <button onClick={() => setEditing(null)} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {error && (
                            <div className="text-xs bg-red-500/10 border border-red-500/25 text-red-400 rounded-lg px-3 py-2">{error}</div>
                        )}

                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Title</label>
                            <input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })}
                                placeholder="Copy an agent between accounts"
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                        </div>

                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Body</label>
                            <textarea value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })}
                                rows={4}
                                placeholder="Say what changed and why it matters, in a sentence or two."
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm resize-none" />
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                            {(['feature', 'fix', 'notice'] as const).map(k => {
                                const m = KIND_META[k];
                                const Icon = m.icon;
                                return (
                                    <button key={k} type="button" onClick={() => setEditing({ ...editing, kind: k })}
                                        className={`p-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 ${
                                            editing.kind === k ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-secondary/40'
                                        }`}>
                                        <Icon className="w-3.5 h-3.5" /> {m.label}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Link (optional)</label>
                                <input value={editing.linkUrl} onChange={e => setEditing({ ...editing, linkUrl: e.target.value })}
                                    placeholder="/dashboard/ai/agents"
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm font-mono" />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Link label</label>
                                <input value={editing.linkLabel} onChange={e => setEditing({ ...editing, linkLabel: e.target.value })}
                                    placeholder="Try it"
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                            </div>
                        </div>

                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={editing.isPublished}
                                onChange={e => setEditing({ ...editing, isPublished: e.target.checked })}
                                className="w-4 h-4 accent-primary" />
                            <span className="text-sm">Publish now — everyone sees it immediately</span>
                        </label>

                        <label className="flex items-start gap-2 p-3 rounded-xl border border-border cursor-pointer hover:bg-secondary/40">
                            <input type="checkbox" checked={editing.showAsModal}
                                onChange={e => setEditing({ ...editing, showAsModal: e.target.checked })}
                                className="w-4 h-4 accent-primary mt-0.5" />
                            <div>
                                <div className="text-sm font-medium">Also interrupt with a popup</div>
                                <div className="text-[11px] text-muted-foreground">
                                    Shows once, centre-screen, on each user's next page load. Save it for things
                                    people need to know today — a popup on every notice teaches them to dismiss
                                    without reading.
                                </div>
                            </div>
                        </label>

                        <div className="flex justify-end gap-2 pt-1">
                            <button onClick={() => setEditing(null)}
                                className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-secondary/50">Cancel</button>
                            <button onClick={save} disabled={saving || !editing.title.trim() || !editing.body.trim()}
                                className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-5 py-2 text-sm font-medium flex items-center gap-2 disabled:opacity-60">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

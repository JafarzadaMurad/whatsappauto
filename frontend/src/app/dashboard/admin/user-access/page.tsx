"use client";

import { useEffect, useState } from "react";
import { UserCog, Loader2, Save, Eye, EyeOff, Lock, Search, Check } from "lucide-react";
import api from "@/lib/api";

// Full list of app sections. Keep in sync with the `section` keys used in
// the sidebar (frontend/src/app/dashboard/layout.tsx). Admin flips each
// row between VISIBLE / LOCKED / HIDDEN per user.
const SECTIONS: { key: string; label: string; group: string }[] = [
    { key: 'dashboard',   label: 'Dashboard',          group: 'Overview' },
    { key: 'analytics',   label: 'Analytics',          group: 'Overview' },
    { key: 'inbox',       label: 'Inbox',              group: 'Overview' },
    { key: 'whatsapp',    label: 'WhatsApp',           group: 'Networks' },
    { key: 'instagram',   label: 'Instagram',          group: 'Networks' },
    { key: 'contacts',    label: 'Contacts',           group: 'CRM' },
    { key: 'deals',       label: 'Deals',              group: 'CRM' },
    { key: 'agents',      label: 'AI Agents / Routers', group: 'AI Workspace' },
    { key: 'oversight',   label: 'Oversight',          group: 'AI Workspace' },
    { key: 'tables',      label: 'Data Tables',        group: 'AI Workspace' },
    { key: 'providers',   label: 'AI Providers',       group: 'AI Workspace' },
    { key: 'automations', label: 'Automations',        group: 'Automation' },
    { key: 'campaigns',   label: 'Campaigns',          group: 'Growth' },
    { key: 'apikeys',     label: 'API Keys',           group: 'Developer' },
    { key: 'mcp',         label: 'MCP',                group: 'Developer' },
    { key: 'webhooks',    label: 'Webhooks',           group: 'Developer' },
    { key: 'billing',     label: 'Billing',            group: 'Account' },
];

const GROUPS = Array.from(new Set(SECTIONS.map(s => s.group)));

type User = {
    id: string;
    email: string;
    name: string | null;
    role: 'USER' | 'ADMIN';
    hiddenSections: string[];
    lockedSections: string[];
};

type Access = 'visible' | 'locked' | 'hidden';

function accessFor(user: User, section: string): Access {
    if (user.hiddenSections?.includes(section)) return 'hidden';
    if (user.lockedSections?.includes(section)) return 'locked';
    return 'visible';
}

export default function AdminUserAccessPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [selected, setSelected] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [query, setQuery] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [savedAt, setSavedAt] = useState<Date | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const r = await api.get('/admin/users');
            if (r.data?.success) {
                const list = r.data.users as User[];
                setUsers(list);
                if (!selected && list.length) setSelected(list[0]);
            }
        } catch (e: any) {
            setError(e.response?.data?.message || e.message);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    const filtered = users.filter(u => {
        if (!query.trim()) return true;
        const q = query.trim().toLowerCase();
        return u.email.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q);
    });

    const cycleAccess = (section: string) => {
        if (!selected) return;
        const cur = accessFor(selected, section);
        const next: Access = cur === 'visible' ? 'locked' : cur === 'locked' ? 'hidden' : 'visible';
        setSelected(u => {
            if (!u) return u;
            const hiddenSet = new Set(u.hiddenSections);
            const lockedSet = new Set(u.lockedSections);
            hiddenSet.delete(section);
            lockedSet.delete(section);
            if (next === 'hidden') hiddenSet.add(section);
            if (next === 'locked') lockedSet.add(section);
            return { ...u, hiddenSections: Array.from(hiddenSet), lockedSections: Array.from(lockedSet) };
        });
    };

    const save = async () => {
        if (!selected) return;
        setSaving(true);
        setError(null);
        try {
            const r = await api.put(`/admin/users/${selected.id}`, {
                hiddenSections: selected.hiddenSections,
                lockedSections: selected.lockedSections,
            });
            if (r.data?.success) {
                setSavedAt(new Date());
                setUsers(prev => prev.map(u => u.id === selected.id ? { ...u, hiddenSections: selected.hiddenSections, lockedSections: selected.lockedSections } : u));
            } else {
                setError(r.data?.message || 'Save failed.');
            }
        } catch (e: any) {
            setError(e.response?.data?.message || e.message);
        } finally { setSaving(false); }
    };

    const resetAll = () => {
        if (!selected) return;
        setSelected({ ...selected, hiddenSections: [], lockedSections: [] });
    };

    if (loading) return (
        <div className="flex justify-center items-center h-96">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
    );

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-3">
                    <div className="p-2 bg-primary/10 text-primary rounded-xl"><UserCog className="w-6 h-6" /></div>
                    User Access
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Control which sidebar sections each non-admin user can reach. Click a row to cycle through <strong>Visible → Locked → Hidden</strong>.
                    Locked rows still appear in the sidebar with a padlock; hidden rows disappear entirely.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
                {/* Users list */}
                <div className="bg-card border border-border rounded-2xl overflow-hidden">
                    <div className="p-3 border-b border-border">
                        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-secondary/50 border border-border">
                            <Search className="w-3.5 h-3.5 text-muted-foreground" />
                            <input value={query} onChange={e => setQuery(e.target.value)}
                                placeholder="Search users…"
                                className="flex-1 bg-transparent outline-none text-sm" />
                        </div>
                    </div>
                    <div className="max-h-[70vh] overflow-y-auto divide-y divide-border/50">
                        {filtered.map(u => (
                            <button key={u.id} onClick={() => setSelected(u)}
                                className={`w-full text-left px-3 py-2.5 transition-colors ${selected?.id === u.id ? 'bg-primary/10' : 'hover:bg-secondary/40'}`}>
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-full bg-secondary/60 border border-border flex items-center justify-center text-xs font-semibold text-foreground/80">
                                        {(u.name || u.email).slice(0, 1).toUpperCase()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium truncate">{u.name || u.email.split('@')[0]}</div>
                                        <div className="text-[11px] text-muted-foreground truncate">{u.email}</div>
                                    </div>
                                    {u.role === 'ADMIN' && (
                                        <span className="text-[9px] font-semibold uppercase tracking-widest text-primary">Admin</span>
                                    )}
                                </div>
                                {(u.hiddenSections?.length || u.lockedSections?.length) ? (
                                    <div className="mt-1.5 flex gap-2 text-[10px]">
                                        {u.hiddenSections?.length > 0 && (
                                            <span className="text-red-400/80">{u.hiddenSections.length} hidden</span>
                                        )}
                                        {u.lockedSections?.length > 0 && (
                                            <span className="text-amber-400/80">{u.lockedSections.length} locked</span>
                                        )}
                                    </div>
                                ) : null}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Access matrix for selected user */}
                {selected ? (
                    <div className="bg-card border border-border rounded-2xl">
                        <div className="p-4 border-b border-border flex items-center justify-between flex-wrap gap-2">
                            <div>
                                <div className="text-xs uppercase tracking-widest text-muted-foreground">Editing</div>
                                <div className="text-sm font-semibold">{selected.name || selected.email}</div>
                                <div className="text-xs text-muted-foreground">{selected.email}</div>
                            </div>
                            <div className="flex items-center gap-2">
                                {selected.role === 'ADMIN' && (
                                    <span className="text-[10px] font-semibold uppercase tracking-widest text-primary bg-primary/10 border border-primary/30 rounded-md px-2 py-1">
                                        Admin — bypasses all rules
                                    </span>
                                )}
                                {savedAt && <span className="text-[10px] text-emerald-400">Saved {savedAt.toLocaleTimeString()}</span>}
                                <button onClick={resetAll}
                                    className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/40">
                                    Reset all
                                </button>
                                <button onClick={save} disabled={saving}
                                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                    Save
                                </button>
                            </div>
                        </div>
                        {error && (
                            <div className="m-4 bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded-lg">
                                {error}
                            </div>
                        )}
                        <div className="p-4">
                            <div className="grid gap-4">
                                {GROUPS.map(g => (
                                    <div key={g}>
                                        <div className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold mb-1.5">{g}</div>
                                        <div className="grid gap-1.5">
                                            {SECTIONS.filter(s => s.group === g).map(s => {
                                                const acc = accessFor(selected, s.key);
                                                return (
                                                    <button key={s.key}
                                                        onClick={() => cycleAccess(s.key)}
                                                        title="Click to cycle Visible → Locked → Hidden"
                                                        className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors flex items-center gap-3 ${
                                                            acc === 'hidden'
                                                                ? 'border-red-500/30 bg-red-500/5'
                                                                : acc === 'locked'
                                                                    ? 'border-amber-500/30 bg-amber-500/5'
                                                                    : 'border-border hover:bg-secondary/40'
                                                        }`}>
                                                        <span className="text-sm font-medium flex-1">{s.label}</span>
                                                        <span className="text-[10px] font-mono text-muted-foreground/50 mr-2">{s.key}</span>
                                                        {acc === 'visible' && (
                                                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300">
                                                                <Eye className="w-3.5 h-3.5" /> Visible
                                                            </span>
                                                        )}
                                                        {acc === 'locked' && (
                                                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300">
                                                                <Lock className="w-3.5 h-3.5" /> Locked
                                                            </span>
                                                        )}
                                                        {acc === 'hidden' && (
                                                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-300">
                                                                <EyeOff className="w-3.5 h-3.5" /> Hidden
                                                            </span>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="bg-card border border-border rounded-2xl p-10 text-center text-muted-foreground text-sm">
                        Pick a user to edit their access matrix.
                    </div>
                )}
            </div>
        </div>
    );
}

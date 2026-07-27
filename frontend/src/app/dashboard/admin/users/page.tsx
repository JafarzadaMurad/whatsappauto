"use client";

// Admin → Users list.
// Redesigned: click a card → dedicated /admin/users/[id] page (not a
// drawer). Same overview stats + credit meter on the card. New button
// opens an inline "create user" modal that provisions an account +
// (optionally) an initial workspace in one round-trip.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    Users, Loader2, Coins, Zap, Plus, Search, ChevronRight,
    Building2, X, Loader,
} from "lucide-react";
import api from "@/lib/api";

type Plan = {
    id: string; name: string; price: number; currency: string; interval: string;
    monthlyCredits?: number;
};

type Workspace = {
    id: string; name: string;
    creditsUsedThisPeriod: number;
    creditTopUp: number;
    plan: { id: string; name: string; monthlyCredits: number } | null;
};

type AdminUser = {
    id: string; email: string; name: string | null; role: string;
    emailVerified: boolean;
    planId: string | null;
    subscriptionStatus: string;
    unlimitedInstances: boolean;
    createdAt: string;
    plan: Plan | null;
    ownedWorkspaces: Workspace[];
    _count?: { ownedWorkspaces: number; instances: number; agents: number };
};

export default function AdminUsersPage() {
    const router = useRouter();
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [plans, setPlans] = useState<Plan[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState<'all' | 'USER' | 'ADMIN'>('all');
    const [showCreate, setShowCreate] = useState(false);

    const load = async () => {
        try {
            const [u, p] = await Promise.all([api.get('/admin/users'), api.get('/plans')]);
            if (u.data.success) setUsers(u.data.users);
            if (p.data.success) setPlans(p.data.plans);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return users.filter(u => {
            if (roleFilter !== 'all' && u.role !== roleFilter) return false;
            if (!q) return true;
            return (u.email + ' ' + (u.name || '') + ' ' + (u.plan?.name || '')).toLowerCase().includes(q);
        });
    }, [users, query, roleFilter]);

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    const userCredit = (u: AdminUser) => {
        const total = u.ownedWorkspaces.reduce((s, w) => s + (w.plan?.monthlyCredits || 0) + (w.creditTopUp || 0), 0);
        const used = u.ownedWorkspaces.reduce((s, w) => s + (w.creditsUsedThisPeriod || 0), 0);
        return { total, used };
    };

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-xl"><Users className="w-6 h-6" /></div>
                        Users
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        {users.length} account{users.length === 1 ? '' : 's'} · manage plans, credits, workspaces, and access.
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input value={query} onChange={e => setQuery(e.target.value)}
                            placeholder="Search email, name, plan…"
                            className="pl-9 pr-3 py-2 bg-card border border-border rounded-xl text-sm w-72 focus:outline-none focus:ring-2 focus:ring-primary/50" />
                    </div>
                    <select value={roleFilter} onChange={e => setRoleFilter(e.target.value as any)}
                        className="bg-card border border-border rounded-xl px-3 py-2 text-sm">
                        <option value="all" className="bg-card">All roles</option>
                        <option value="USER" className="bg-card">Users</option>
                        <option value="ADMIN" className="bg-card">Admins</option>
                    </select>
                    <button onClick={() => setShowCreate(true)}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-4 py-2 text-sm flex items-center gap-2">
                        <Plus className="w-4 h-4" /> New user
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {filtered.map(u => {
                    const c = userCredit(u);
                    const pct = c.total > 0 ? Math.min(100, (c.used / c.total) * 100) : 0;
                    const nearLimit = pct >= 80;
                    return (
                        <Link key={u.id} href={`/dashboard/admin/users/${u.id}`}
                            className="group text-left bg-card border border-border rounded-2xl p-4 hover:border-primary/40 hover:bg-secondary/20 transition-all block">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <div className={`w-11 h-11 flex-shrink-0 rounded-xl flex items-center justify-center text-sm font-bold ${u.role === 'ADMIN' ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                                        {(u.name || u.email)[0]?.toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-semibold truncate">{u.name || u.email.split('@')[0]}</span>
                                            {u.role === 'ADMIN' && (
                                                <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary">Admin</span>
                                            )}
                                            {!u.emailVerified && (
                                                <span title="Email not verified" className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">Unverified</span>
                                            )}
                                            {u.unlimitedInstances && (
                                                <span title="Bypasses instance limits" className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                                                    <Zap className="w-3 h-3 inline" />
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                                    </div>
                                </div>
                                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0" />
                            </div>
                            <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
                                <div className="bg-secondary/30 rounded-lg p-2">
                                    <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Plan</div>
                                    <div className="font-medium truncate mt-0.5">{u.plan?.name || 'none'}</div>
                                </div>
                                <div className="bg-secondary/30 rounded-lg p-2">
                                    <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Status</div>
                                    <div className={`font-medium mt-0.5 ${u.subscriptionStatus === 'active' || u.subscriptionStatus === 'trialing' ? 'text-emerald-400' : ''}`}>
                                        {u.subscriptionStatus}
                                    </div>
                                </div>
                                <div className="bg-secondary/30 rounded-lg p-2">
                                    <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Workspaces</div>
                                    <div className="font-medium mt-0.5 flex items-center gap-1">
                                        <Building2 className="w-3 h-3" /> {u.ownedWorkspaces.length}
                                    </div>
                                </div>
                            </div>
                            {c.total > 0 && (
                                <div className="mt-3 space-y-1">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="flex items-center gap-1.5 text-muted-foreground">
                                            <Coins className="w-3 h-3 text-amber-400" /> Credits
                                        </span>
                                        <span className={`font-mono ${nearLimit ? 'text-amber-400' : 'text-foreground'}`}>
                                            {c.used.toLocaleString()} / {c.total.toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="h-1.5 bg-secondary/60 rounded-full overflow-hidden">
                                        <div className={`h-full transition-all ${nearLimit ? 'bg-amber-400' : 'bg-primary'}`}
                                            style={{ width: `${pct}%` }} />
                                    </div>
                                </div>
                            )}
                        </Link>
                    );
                })}
                {filtered.length === 0 && (
                    <div className="lg:col-span-2 bg-card border border-dashed border-border rounded-2xl p-12 text-center text-sm text-muted-foreground">
                        No users match the current filters.
                    </div>
                )}
            </div>

            {showCreate && (
                <CreateUserModal plans={plans} onClose={() => setShowCreate(false)}
                    onCreated={(id) => {
                        setShowCreate(false);
                        router.push(`/dashboard/admin/users/${id}`);
                    }} />
            )}
        </div>
    );
}

// ─── Create-user modal ─────────────────────────────────────────────
function CreateUserModal({ plans, onClose, onCreated }: {
    plans: Plan[];
    onClose: () => void;
    onCreated: (userId: string) => void;
}) {
    const [form, setForm] = useState({
        email: '', name: '', password: '',
        role: 'USER' as 'USER' | 'ADMIN',
        planId: '' as string,
        emailVerified: true,
        createDefaultWorkspace: true,
        workspaceName: '',
    });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            const res = await api.post('/admin/users', {
                email: form.email.trim(),
                name: form.name.trim() || undefined,
                password: form.password,
                role: form.role,
                planId: form.planId || null,
                emailVerified: form.emailVerified,
                createDefaultWorkspace: form.createDefaultWorkspace,
                workspaceName: form.workspaceName.trim() || undefined,
            });
            if (res.data.success && res.data.user?.id) onCreated(res.data.user.id);
        } catch (err: any) {
            setError(err.response?.data?.errors?.[0]?.message || err.response?.data?.message || err.message);
        } finally { setSaving(false); }
    };

    const randomPwd = () => {
        const chars = 'abcdefghijklmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
        let out = '';
        for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
        setForm(f => ({ ...f, password: out }));
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-border flex items-center justify-between">
                    <h2 className="font-semibold flex items-center gap-2"><Plus className="w-4 h-4" /> New user</h2>
                    <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <form onSubmit={submit} className="p-5 space-y-4">
                    {error && (
                        <div className="text-xs bg-red-500/10 border border-red-500/25 text-red-400 rounded-lg px-3 py-2">{error}</div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="block">
                            <span className="text-xs font-medium text-muted-foreground">Email</span>
                            <input type="email" required value={form.email}
                                onChange={e => setForm({ ...form, email: e.target.value })}
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-muted-foreground">Name (optional)</span>
                            <input type="text" value={form.name}
                                onChange={e => setForm({ ...form, name: e.target.value })}
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                        </label>
                    </div>
                    <div>
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">Password</span>
                            <button type="button" onClick={randomPwd} className="text-[11px] text-primary hover:underline">Generate</button>
                        </div>
                        <input type="text" required minLength={6} value={form.password}
                            onChange={e => setForm({ ...form, password: e.target.value })}
                            placeholder="Min 6 chars"
                            className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm font-mono" />
                        <p className="text-[10px] text-muted-foreground mt-1">Share this with the user out-of-band. They can change it after logging in.</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="block">
                            <span className="text-xs font-medium text-muted-foreground">Role</span>
                            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as any })}
                                className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-2 text-sm">
                                <option value="USER" className="bg-card">User</option>
                                <option value="ADMIN" className="bg-card">Admin</option>
                            </select>
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-muted-foreground">Plan</span>
                            <select value={form.planId} onChange={e => setForm({ ...form, planId: e.target.value })}
                                className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-2 text-sm">
                                <option value="" className="bg-card">— default / free</option>
                                {plans.map(p => <option key={p.id} value={p.id} className="bg-card">{p.name}</option>)}
                            </select>
                        </label>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={form.emailVerified}
                            onChange={e => setForm({ ...form, emailVerified: e.target.checked })}
                            className="w-4 h-4 accent-primary" />
                        <span className="text-sm">Mark email as verified</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={form.createDefaultWorkspace}
                            onChange={e => setForm({ ...form, createDefaultWorkspace: e.target.checked })}
                            className="w-4 h-4 accent-primary" />
                        <span className="text-sm">Create initial workspace</span>
                    </label>
                    {form.createDefaultWorkspace && (
                        <label className="block">
                            <span className="text-xs font-medium text-muted-foreground">Workspace name (optional)</span>
                            <input type="text" value={form.workspaceName}
                                onChange={e => setForm({ ...form, workspaceName: e.target.value })}
                                placeholder="Defaults to \"<name>'s Workspace\""
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                        </label>
                    )}
                    <div className="pt-2 flex justify-end gap-2">
                        <button type="button" onClick={onClose}
                            className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-secondary/50">Cancel</button>
                        <button type="submit" disabled={saving || !form.email.trim() || !form.password.trim()}
                            className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2 disabled:opacity-60">
                            {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            Create user
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

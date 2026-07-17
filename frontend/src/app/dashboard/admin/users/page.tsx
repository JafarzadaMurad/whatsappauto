"use client";

// Admin → Users. Redesigned surface with:
//   - Search + role/plan filters on top
//   - Cards showing each user with role, plan, and their owner-workspace's
//     credit meter (live from the same rows the Usage widget reads).
//   - Slide-in detail drawer with tabbed sections:
//       Overview  — role, subscription, verify-email, unlimited-instances
//       Credits   — per-workspace balance + reset + top-up buttons
//       Activity  — last 20 LLM calls across the user's workspaces
//       Danger    — hard delete
//   - Every mutation refreshes the list without a page reload.

import { useEffect, useMemo, useState } from "react";
import {
    Users, Loader2, X, Coins, ShieldCheck, ShieldAlert, Zap, Trash2, RotateCcw,
    Plus, Mail, CheckCircle2, Ban, Search, ChevronRight, Bot, MessageSquare,
    Building2, AlertTriangle,
} from "lucide-react";
import api from "@/lib/api";

type Plan = {
    id: string; name: string; price: number; currency: string; interval: string;
    monthlyCredits?: number; copilotEnabled?: boolean; copilotVoiceEnabled?: boolean;
};

type Workspace = {
    id: string; name: string;
    creditsUsedThisPeriod: number;
    creditTopUp: number;
    periodResetAt: string | null;
    subscriptionStatus: string;
    plan: { id: string; name: string; monthlyCredits: number } | null;
};

type AdminUser = {
    id: string; email: string; name: string | null; role: string;
    emailVerified: boolean;
    planId: string | null;
    subscriptionStatus: string;
    subscriptionEndsAt: string | null;
    stripeCustomerId: string | null;
    unlimitedInstances: boolean;
    createdAt: string;
    plan: Plan | null;
    ownedWorkspaces: Workspace[];
    _count?: { ownedWorkspaces: number; instances: number; agents: number };
};

type LedgerRow = {
    id: string; workspaceId: string; cause: string; provider: string; model: string;
    inputTokens: number; outputTokens: number; creditsUsed: number;
    usedOwnKey: boolean; createdAt: string;
    agent: { id: string; name: string } | null;
};

const CAUSE_LABEL: Record<string, string> = {
    whatsapp_reply: 'WhatsApp reply',
    instagram_dm: 'Instagram DM',
    campaign: 'Campaign',
    oversight: 'Oversight',
    ads_gen: 'Ads generator',
    mcp_tool: 'MCP tool',
    router: 'Router',
    whisper: 'Whisper',
    other: 'Copilot / other',
};

export default function AdminUsersPage() {
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [plans, setPlans] = useState<Plan[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState<'all' | 'USER' | 'ADMIN'>('all');
    const [selectedId, setSelectedId] = useState<string | null>(null);

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

    const selected = users.find(u => u.id === selectedId) || null;

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    // Aggregate a user's workspace usage into a single number pair for the row.
    const userCredit = (u: AdminUser) => {
        const total = u.ownedWorkspaces.reduce((s, w) => s + (w.plan?.monthlyCredits || 0) + (w.creditTopUp || 0), 0);
        const used = u.ownedWorkspaces.reduce((s, w) => s + (w.creditsUsedThisPeriod || 0), 0);
        return { total, used };
    };

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-xl"><Users className="w-6 h-6" /></div>
                        Users
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        {users.length} account{users.length === 1 ? '' : 's'} · manage plans, credits, and access.
                    </p>
                </div>
                <div className="flex items-center gap-2">
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
                </div>
            </div>

            {/* User cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {filtered.map(u => {
                    const c = userCredit(u);
                    const pct = c.total > 0 ? Math.min(100, (c.used / c.total) * 100) : 0;
                    const nearLimit = pct >= 80;
                    return (
                        <button key={u.id} onClick={() => setSelectedId(u.id)}
                            className="group text-left bg-card border border-border rounded-2xl p-4 hover:border-primary/40 hover:bg-secondary/20 transition-all">
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
                                                <span title="Bypasses instance limits" className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">∞</span>
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
                                    <div className="text-muted-foreground text-[10px] uppercase tracking-wide">Joined</div>
                                    <div className="font-medium mt-0.5">{new Date(u.createdAt).toLocaleDateString()}</div>
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
                        </button>
                    );
                })}
                {filtered.length === 0 && (
                    <div className="lg:col-span-2 bg-card border border-dashed border-border rounded-2xl p-12 text-center text-sm text-muted-foreground">
                        No users match the current filters.
                    </div>
                )}
            </div>

            {selected && (
                <UserDrawer
                    userId={selected.id}
                    plans={plans}
                    onClose={() => setSelectedId(null)}
                    onChanged={load}
                />
            )}
        </div>
    );
}

// ─── Drawer ────────────────────────────────────────────────────────

function UserDrawer({ userId, plans, onClose, onChanged }: {
    userId: string;
    plans: Plan[];
    onClose: () => void;
    onChanged: () => void;
}) {
    const [tab, setTab] = useState<'overview' | 'credits' | 'activity' | 'danger'>('overview');
    const [user, setUser] = useState<AdminUser | null>(null);
    const [ledger, setLedger] = useState<LedgerRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

    const load = async () => {
        try {
            const res = await api.get(`/admin/users/${userId}`);
            if (res.data.success) {
                setUser(res.data.user);
                setLedger(res.data.recentLedger || []);
            }
        } catch (err: any) {
            setMsg({ ok: false, text: err.response?.data?.message || err.message });
        } finally { setLoading(false); }
    };
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

    const flash = (text: string, ok = true) => {
        setMsg({ ok, text });
        setTimeout(() => setMsg(null), 3000);
    };

    const patch = async (patch: Partial<AdminUser>) => {
        setSaving(true);
        try {
            await api.put(`/admin/users/${userId}`, patch);
            await load();
            onChanged();
            flash('Saved');
        } catch (err: any) {
            flash(err.response?.data?.message || err.message, false);
        } finally { setSaving(false); }
    };

    const resetWs = async (wsId: string) => {
        if (!confirm('Reset this workspace\'s credit usage to 0?')) return;
        setSaving(true);
        try {
            await api.post(`/admin/credits/workspaces/${wsId}/reset`);
            await load();
            onChanged();
            flash('Credits reset');
        } catch (err: any) {
            flash(err.response?.data?.message || err.message, false);
        } finally { setSaving(false); }
    };

    const topUpWs = async (wsId: string, amount: number) => {
        if (amount <= 0) return;
        setSaving(true);
        try {
            await api.post(`/admin/credits/workspaces/${wsId}/top-up`, { amount });
            await load();
            onChanged();
            flash(`Added ${amount.toLocaleString()} credits`);
        } catch (err: any) {
            flash(err.response?.data?.message || err.message, false);
        } finally { setSaving(false); }
    };

    const verifyEmail = async () => {
        setSaving(true);
        try {
            await api.post(`/admin/users/${userId}/verify-email`);
            await load();
            onChanged();
            flash('Email marked as verified');
        } catch (err: any) {
            flash(err.response?.data?.message || err.message, false);
        } finally { setSaving(false); }
    };

    const deleteUser = async () => {
        if (!user) return;
        if (!confirm(`Permanently delete ${user.email} and every workspace they own? This CANNOT be undone.`)) return;
        setSaving(true);
        try {
            await api.delete(`/admin/users/${userId}`);
            onChanged();
            onClose();
        } catch (err: any) {
            flash(err.response?.data?.message || err.message, false);
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex" onClick={onClose}>
            <div className="flex-1 bg-black/60 backdrop-blur-sm" />
            <div className="w-full max-w-2xl h-full bg-card border-l border-border overflow-y-auto animate-in slide-in-from-right duration-200"
                onClick={e => e.stopPropagation()}>
                {loading || !user ? (
                    <div className="flex justify-center items-center h-96">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div className="sticky top-0 bg-card border-b border-border z-10">
                            <div className="p-5 flex items-start gap-4">
                                <div className={`w-14 h-14 flex-shrink-0 rounded-2xl flex items-center justify-center text-xl font-bold ${user.role === 'ADMIN' ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                                    {(user.name || user.email)[0]?.toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h2 className="text-lg font-bold">{user.name || user.email.split('@')[0]}</h2>
                                        {user.role === 'ADMIN' && (
                                            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary">Admin</span>
                                        )}
                                    </div>
                                    <div className="text-sm text-muted-foreground flex items-center gap-1.5">
                                        <Mail className="w-3.5 h-3.5" />
                                        {user.email}
                                        {user.emailVerified ? (
                                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                        ) : (
                                            <span className="text-amber-400">· unverified</span>
                                        )}
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1">
                                        Joined {new Date(user.createdAt).toLocaleDateString()}
                                    </div>
                                </div>
                                <button onClick={onClose}
                                    className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            {/* Tabs */}
                            <div className="flex px-5 border-t border-border">
                                {[
                                    { key: 'overview', label: 'Overview' },
                                    { key: 'credits', label: 'Credits' },
                                    { key: 'activity', label: 'Activity' },
                                    { key: 'danger', label: 'Danger' },
                                ].map(t => (
                                    <button key={t.key} onClick={() => setTab(t.key as any)}
                                        className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                                            tab === t.key
                                                ? 'border-primary text-primary'
                                                : 'border-transparent text-muted-foreground hover:text-foreground'
                                        }`}>
                                        {t.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {msg && (
                            <div className={`mx-5 mt-3 text-xs rounded-lg px-3 py-2 ${msg.ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                                {msg.text}
                            </div>
                        )}

                        <div className="p-5 space-y-5">
                            {tab === 'overview' && (
                                <>
                                    {/* Role */}
                                    <Section title="Role & access">
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => user.role !== 'USER' && patch({ role: 'USER' })}
                                                disabled={saving}
                                                className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${user.role === 'USER' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                                                User
                                            </button>
                                            <button onClick={() => user.role !== 'ADMIN' && patch({ role: 'ADMIN' })}
                                                disabled={saving}
                                                className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${user.role === 'ADMIN' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                                                Admin
                                            </button>
                                        </div>
                                        <label className="flex items-center gap-2 pt-2 cursor-pointer">
                                            <input type="checkbox" checked={user.unlimitedInstances}
                                                onChange={e => patch({ unlimitedInstances: e.target.checked } as any)}
                                                disabled={saving}
                                                className="w-4 h-4 accent-primary" />
                                            <span className="text-sm flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-emerald-400" /> Unlimited instances (bypass plan limits)</span>
                                        </label>
                                        {!user.emailVerified && (
                                            <button onClick={verifyEmail} disabled={saving}
                                                className="mt-2 w-full bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 rounded-lg px-3 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-60">
                                                <CheckCircle2 className="w-4 h-4" /> Manually verify email
                                            </button>
                                        )}
                                    </Section>

                                    {/* Plan */}
                                    <Section title="Subscription">
                                        <select value={user.planId || ''}
                                            onChange={e => patch({ planId: e.target.value || null } as any)}
                                            disabled={saving}
                                            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm">
                                            <option value="" className="bg-card">No plan (grandfathered / unlimited)</option>
                                            {plans.map(p => (
                                                <option key={p.id} value={p.id} className="bg-card">
                                                    {p.name} — {p.price} {p.currency}/{p.interval}
                                                </option>
                                            ))}
                                        </select>
                                        <div className="grid grid-cols-2 gap-2">
                                            <select value={user.subscriptionStatus}
                                                onChange={e => patch({ subscriptionStatus: e.target.value } as any)}
                                                disabled={saving}
                                                className="bg-card border border-border rounded-lg px-3 py-2 text-sm">
                                                {['none', 'trialing', 'active', 'past_due', 'canceled'].map(s => (
                                                    <option key={s} value={s} className="bg-card">{s}</option>
                                                ))}
                                            </select>
                                            <input type="date"
                                                value={user.subscriptionEndsAt ? new Date(user.subscriptionEndsAt).toISOString().slice(0, 10) : ''}
                                                onChange={e => patch({ subscriptionEndsAt: e.target.value ? new Date(e.target.value).toISOString() : null } as any)}
                                                disabled={saving}
                                                className="bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                                        </div>
                                    </Section>

                                    {/* Assets */}
                                    <Section title="Owned">
                                        <div className="grid grid-cols-3 gap-2">
                                            <Stat icon={Building2} label="Workspaces" value={user.ownedWorkspaces.length} />
                                            <Stat icon={MessageSquare} label="WhatsApp" value={user._count?.instances ?? 0} />
                                            <Stat icon={Bot} label="AI agents" value={user._count?.agents ?? 0} />
                                        </div>
                                    </Section>
                                </>
                            )}

                            {tab === 'credits' && (
                                <>
                                    {user.ownedWorkspaces.length === 0 ? (
                                        <div className="bg-card border border-dashed border-border rounded-xl p-6 text-center text-sm text-muted-foreground">
                                            This user doesn't own any workspaces yet.
                                        </div>
                                    ) : (
                                        user.ownedWorkspaces.map(ws => (
                                            <WorkspaceCreditCard key={ws.id} ws={ws}
                                                onReset={() => resetWs(ws.id)}
                                                onTopUp={amount => topUpWs(ws.id, amount)}
                                                saving={saving} />
                                        ))
                                    )}
                                </>
                            )}

                            {tab === 'activity' && (
                                <>
                                    {ledger.length === 0 ? (
                                        <div className="bg-card border border-dashed border-border rounded-xl p-6 text-center text-sm text-muted-foreground">
                                            No LLM activity recorded yet.
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {ledger.map(row => (
                                                <div key={row.id} className="bg-secondary/20 border border-border rounded-xl p-3 flex items-start gap-3">
                                                    <div className={`w-8 h-8 flex-shrink-0 rounded-lg flex items-center justify-center ${row.usedOwnKey ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                                        <Coins className="w-4 h-4" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                                                            {CAUSE_LABEL[row.cause] || row.cause}
                                                            {row.agent?.name && <span className="text-xs text-muted-foreground">· {row.agent.name}</span>}
                                                        </div>
                                                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                                                            {row.provider}/{row.model} · {row.inputTokens.toLocaleString()} in / {row.outputTokens.toLocaleString()} out
                                                        </div>
                                                        <div className="text-[10px] text-muted-foreground">
                                                            {new Date(row.createdAt).toLocaleString()}
                                                        </div>
                                                    </div>
                                                    <div className="text-right flex-shrink-0">
                                                        <div className={`text-sm font-bold font-mono ${row.usedOwnKey ? 'text-emerald-400' : 'text-foreground'}`}>
                                                            {row.usedOwnKey ? 'BYOK' : row.creditsUsed.toLocaleString()}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}

                            {tab === 'danger' && (
                                <div className="bg-red-500/5 border border-red-500/30 rounded-2xl p-5 space-y-3">
                                    <h3 className="font-semibold flex items-center gap-2 text-red-400">
                                        <AlertTriangle className="w-4 h-4" /> Danger zone
                                    </h3>
                                    <p className="text-xs text-muted-foreground">
                                        Deleting this account cascades through every workspace, WhatsApp instance, agent, campaign, and message they own. There is no undo.
                                    </p>
                                    <button onClick={deleteUser} disabled={saving}
                                        className="w-full bg-red-500/10 hover:bg-red-500/20 border border-red-500/40 text-red-400 rounded-lg px-3 py-2.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-60">
                                        <Trash2 className="w-4 h-4" /> Delete account permanently
                                    </button>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ─── Small primitives ──────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="bg-secondary/10 border border-border rounded-2xl p-4 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
            {children}
        </div>
    );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
    return (
        <div className="bg-card border border-border rounded-xl p-3 text-center">
            <Icon className="w-4 h-4 text-primary mx-auto" />
            <div className="text-lg font-bold mt-1">{value}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        </div>
    );
}

function WorkspaceCreditCard({ ws, onReset, onTopUp, saving }: {
    ws: Workspace;
    onReset: () => void;
    onTopUp: (amount: number) => void;
    saving: boolean;
}) {
    const [topUpValue, setTopUpValue] = useState('');
    const budget = (ws.plan?.monthlyCredits || 0) + (ws.creditTopUp || 0);
    const used = ws.creditsUsedThisPeriod || 0;
    const remaining = Math.max(0, budget - used);
    const pct = budget > 0 ? Math.min(100, (used / budget) * 100) : 0;
    const nearLimit = pct >= 80;

    return (
        <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
            <div className="flex items-start justify-between">
                <div>
                    <div className="text-sm font-semibold flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-primary" /> {ws.name}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                        Plan: {ws.plan?.name || 'none'} · {(ws.plan?.monthlyCredits || 0).toLocaleString()} / mo
                        {ws.creditTopUp > 0 && <> · +{ws.creditTopUp.toLocaleString()} top-up</>}
                    </div>
                </div>
            </div>

            <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                    <div className="text-2xl font-bold flex items-center gap-2">
                        <Coins className="w-5 h-5 text-amber-400" />
                        {used.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">/ {budget.toLocaleString()}</span>
                    </div>
                    <div className={`text-sm font-semibold ${nearLimit ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {remaining.toLocaleString()} left
                    </div>
                </div>
                <div className="h-2 bg-secondary/60 rounded-full overflow-hidden">
                    <div className={`h-full transition-all ${nearLimit ? 'bg-amber-400' : 'bg-primary'}`}
                        style={{ width: `${pct}%` }} />
                </div>
                {ws.periodResetAt && (
                    <div className="text-[10px] text-muted-foreground">
                        Auto-resets on {new Date(ws.periodResetAt).toLocaleDateString()}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-2 gap-2">
                <button onClick={onReset} disabled={saving}
                    className="bg-secondary/50 hover:bg-secondary border border-border rounded-lg px-3 py-2 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60">
                    <RotateCcw className="w-3.5 h-3.5" /> Reset to 0
                </button>
                <div className="flex gap-1">
                    <input type="number" min={1} step={100} value={topUpValue}
                        onChange={e => setTopUpValue(e.target.value)}
                        placeholder="+1000"
                        className="flex-1 min-w-0 bg-secondary/50 border border-border rounded-lg px-2 py-2 text-xs" />
                    <button onClick={() => { const n = Number(topUpValue); if (n > 0) { onTopUp(n); setTopUpValue(''); } }}
                        disabled={saving || !topUpValue || Number(topUpValue) <= 0}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-2.5 text-xs font-medium flex items-center gap-1 transition-colors disabled:opacity-60">
                        <Plus className="w-3.5 h-3.5" /> Top-up
                    </button>
                </div>
            </div>
        </div>
    );
}

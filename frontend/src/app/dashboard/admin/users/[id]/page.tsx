"use client";

// Admin → User detail. Dedicated per-user page with left-rail tab nav
// (Overview / Subscription / Credits / Workspaces / Activity / Access /
// Danger). Every action is inline — no modal-in-modal.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
    Loader2, X, Mail, CheckCircle2, ChevronLeft, User as UserIcon,
    CreditCard, Coins, Building2, Activity, Shield, AlertTriangle,
    Trash2, RotateCcw, Plus, Zap, Bot, MessageSquare, Save,
    UserPlus, ArrowRightLeft, Search,
} from "lucide-react";
import api from "@/lib/api";

type Plan = { id: string; name: string; price: number; currency: string; interval: string; monthlyCredits?: number };
type Workspace = {
    id: string; name: string;
    creditsUsedThisPeriod: number; creditTopUp: number; periodResetAt: string | null;
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
    hiddenSections?: string[];
    lockedSections?: string[];
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
    whatsapp_reply: 'WhatsApp reply', instagram_dm: 'Instagram DM',
    campaign: 'Campaign', oversight: 'Oversight', ads_gen: 'Ads generator',
    mcp_tool: 'MCP tool', router: 'Router', whisper: 'Whisper',
    voice_call: 'Voice call', other: 'Copilot / other',
};

const SECTIONS = [
    { key: 'overview', label: 'Overview', icon: UserIcon },
    { key: 'subscription', label: 'Subscription', icon: CreditCard },
    { key: 'credits', label: 'Credits', icon: Coins },
    { key: 'workspaces', label: 'Workspaces', icon: Building2 },
    { key: 'activity', label: 'Activity', icon: Activity },
    { key: 'access', label: 'Access control', icon: Shield },
    { key: 'danger', label: 'Danger', icon: AlertTriangle },
] as const;
type SectionKey = typeof SECTIONS[number]['key'];

export default function AdminUserDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const userId = params?.id;

    const [user, setUser] = useState<AdminUser | null>(null);
    const [plans, setPlans] = useState<Plan[]>([]);
    const [ledger, setLedger] = useState<LedgerRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const [section, setSection] = useState<SectionKey>('overview');

    const load = async () => {
        if (!userId) return;
        try {
            const [u, p] = await Promise.all([
                api.get(`/admin/users/${userId}`),
                api.get('/plans'),
            ]);
            if (u.data.success) {
                setUser(u.data.user);
                setLedger(u.data.recentLedger || []);
            }
            if (p.data.success) setPlans(p.data.plans);
        } catch (err: any) {
            setMsg({ ok: false, text: err.response?.data?.message || err.message });
        } finally { setLoading(false); }
    };
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

    const flash = (text: string, ok = true) => {
        setMsg({ ok, text });
        setTimeout(() => setMsg(null), 3000);
    };

    const patch = async (delta: Partial<AdminUser>) => {
        if (!user) return;
        setSaving(true);
        try {
            await api.put(`/admin/users/${user.id}`, delta);
            await load();
            flash('Saved');
        } catch (err: any) {
            flash(err.response?.data?.message || err.message, false);
        } finally { setSaving(false); }
    };

    const verifyEmail = async () => {
        if (!user) return;
        setSaving(true);
        try {
            await api.post(`/admin/users/${user.id}/verify-email`);
            await load();
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
            await api.delete(`/admin/users/${user.id}`);
            router.push('/dashboard/admin/users');
        } catch (err: any) {
            flash(err.response?.data?.message || err.message, false);
            setSaving(false);
        }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );
    if (!user) return (
        <div className="max-w-2xl mx-auto bg-red-500/5 border border-red-500/25 rounded-2xl p-6 text-sm text-red-400">
            User not found.
        </div>
    );

    return (
        <div className="max-w-6xl mx-auto space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <button onClick={() => router.push('/dashboard/admin/users')}
                        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div className={`w-12 h-12 flex-shrink-0 rounded-2xl flex items-center justify-center text-lg font-bold ${user.role === 'ADMIN' ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                        {(user.name || user.email)[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h1 className="text-xl font-bold truncate">{user.name || user.email.split('@')[0]}</h1>
                            {user.role === 'ADMIN' && (
                                <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary">Admin</span>
                            )}
                            {!user.emailVerified && (
                                <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">Unverified</span>
                            )}
                            {user.unlimitedInstances && (
                                <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 inline-flex items-center gap-0.5">
                                    <Zap className="w-3 h-3" /> ∞
                                </span>
                            )}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Mail className="w-3 h-3" /> {user.email} · joined {new Date(user.createdAt).toLocaleDateString()}
                        </div>
                    </div>
                </div>
                {msg && (
                    <div className={`text-xs rounded-lg px-3 py-1.5 ${msg.ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                        {msg.text}
                    </div>
                )}
            </div>

            {/* Layout: left tabs / right content */}
            <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4 items-start">
                <nav className="bg-card border border-border rounded-2xl p-2 space-y-0.5 lg:sticky top-4">
                    {SECTIONS.map(s => {
                        const Icon = s.icon;
                        const active = section === s.key;
                        const isDanger = s.key === 'danger';
                        return (
                            <button key={s.key} onClick={() => setSection(s.key)}
                                className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 text-sm transition-colors ${
                                    active
                                        ? (isDanger ? 'bg-red-500/10 text-red-400 font-medium' : 'bg-primary/10 text-primary font-medium')
                                        : (isDanger ? 'text-muted-foreground hover:bg-red-500/5 hover:text-red-400' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground')
                                }`}>
                                <Icon className="w-4 h-4 flex-shrink-0" />
                                <span className="truncate">{s.label}</span>
                            </button>
                        );
                    })}
                </nav>

                <div className="bg-card border border-border rounded-2xl p-5">
                    {section === 'overview' && <OverviewSection user={user} onPatch={patch} onVerify={verifyEmail} saving={saving} />}
                    {section === 'subscription' && <SubscriptionSection user={user} plans={plans} onPatch={patch} saving={saving} />}
                    {section === 'credits' && <CreditsSection user={user} onReload={load} onFlash={flash} />}
                    {section === 'workspaces' && <WorkspacesSection user={user} plans={plans} onReload={load} onFlash={flash} />}
                    {section === 'activity' && <ActivitySection ledger={ledger} />}
                    {section === 'access' && <AccessSection user={user} onPatch={patch} saving={saving} />}
                    {section === 'danger' && <DangerSection onDelete={deleteUser} saving={saving} />}
                </div>
            </div>
        </div>
    );
}

// ─── Section helpers ───────────────────────────────────────────────
function Header({ icon: Icon, title, hint }: { icon: any; title: string; hint: string }) {
    return (
        <div className="pb-3 mb-4 border-b border-border">
            <h2 className="font-semibold flex items-center gap-2">
                <Icon className="w-4 h-4 text-primary" /> {title}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">{hint}</p>
        </div>
    );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
    return (
        <div className="bg-secondary/30 border border-border rounded-xl p-3 text-center">
            <Icon className="w-4 h-4 text-primary mx-auto" />
            <div className="text-lg font-bold mt-1">{value.toLocaleString()}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        </div>
    );
}

// ─── Overview ──────────────────────────────────────────────────────
function OverviewSection({ user, onPatch, onVerify, saving }: {
    user: AdminUser; onPatch: (p: Partial<AdminUser>) => void; onVerify: () => void; saving: boolean;
}) {
    return (
        <div className="space-y-5">
            <Header icon={UserIcon} title="Overview" hint="Role, verification, and quick stats." />
            <div className="grid grid-cols-3 gap-3">
                <Stat icon={Building2} label="Workspaces" value={user.ownedWorkspaces.length} />
                <Stat icon={MessageSquare} label="WhatsApp" value={user._count?.instances ?? 0} />
                <Stat icon={Bot} label="AI agents" value={user._count?.agents ?? 0} />
            </div>
            <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Role</div>
                <div className="flex gap-2">
                    {(['USER', 'ADMIN'] as const).map(r => (
                        <button key={r} onClick={() => user.role !== r && onPatch({ role: r } as any)}
                            disabled={saving}
                            className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${user.role === r ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                            {r === 'USER' ? 'User' : 'Admin'}
                        </button>
                    ))}
                </div>
            </div>
            <label className="flex items-start gap-3 p-3 rounded-xl border border-border cursor-pointer hover:bg-secondary/40">
                <input type="checkbox" checked={user.unlimitedInstances}
                    onChange={e => onPatch({ unlimitedInstances: e.target.checked } as any)}
                    disabled={saving}
                    className="w-4 h-4 accent-primary mt-0.5" />
                <div>
                    <div className="text-sm font-medium flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-emerald-400" /> Unlimited instances
                    </div>
                    <div className="text-[11px] text-muted-foreground">Bypasses the plan's per-workspace WhatsApp / Instagram / agent caps.</div>
                </div>
            </label>
            {!user.emailVerified && (
                <button onClick={onVerify} disabled={saving}
                    className="w-full bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-400 rounded-lg px-3 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-60">
                    <CheckCircle2 className="w-4 h-4" /> Manually verify email
                </button>
            )}
        </div>
    );
}

// ─── Subscription ──────────────────────────────────────────────────
function SubscriptionSection({ user, plans, onPatch, saving }: {
    user: AdminUser; plans: Plan[]; onPatch: (p: Partial<AdminUser>) => void; saving: boolean;
}) {
    return (
        <div className="space-y-4">
            <Header icon={CreditCard} title="Subscription" hint="Plan, status, and cycle end date. Applies to every workspace the user owns." />
            <label className="block">
                <span className="text-xs font-medium text-muted-foreground">Plan</span>
                <select value={user.planId || ''}
                    onChange={e => onPatch({ planId: e.target.value || null } as any)}
                    disabled={saving}
                    className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-2 text-sm">
                    <option value="" className="bg-card">No plan (grandfathered / unlimited)</option>
                    {plans.map(p => (
                        <option key={p.id} value={p.id} className="bg-card">
                            {p.name} — {p.price} {p.currency}/{p.interval}
                        </option>
                    ))}
                </select>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">Status</span>
                    <select value={user.subscriptionStatus}
                        onChange={e => onPatch({ subscriptionStatus: e.target.value } as any)}
                        disabled={saving}
                        className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-2 text-sm">
                        {['none', 'trialing', 'active', 'past_due', 'canceled'].map(s => (
                            <option key={s} value={s} className="bg-card">{s}</option>
                        ))}
                    </select>
                </label>
                <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">Ends at</span>
                    <input type="date"
                        value={user.subscriptionEndsAt ? new Date(user.subscriptionEndsAt).toISOString().slice(0, 10) : ''}
                        onChange={e => onPatch({ subscriptionEndsAt: e.target.value ? new Date(e.target.value).toISOString() : null } as any)}
                        disabled={saving}
                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                </label>
            </div>
            {user.stripeCustomerId && (
                <div className="text-[11px] text-muted-foreground">
                    Stripe customer: <span className="font-mono">{user.stripeCustomerId}</span>
                </div>
            )}
        </div>
    );
}

// ─── Credits (per-workspace) ───────────────────────────────────────
function CreditsSection({ user, onReload, onFlash }: {
    user: AdminUser; onReload: () => Promise<void>; onFlash: (msg: string, ok?: boolean) => void;
}) {
    return (
        <div className="space-y-4">
            <Header icon={Coins} title="Credits" hint="Per-workspace credit meter. Reset flushes usage to 0; top-up adds one-off credits on top of the plan's monthly pool." />
            {user.ownedWorkspaces.length === 0 ? (
                <div className="bg-secondary/20 border border-dashed border-border rounded-xl p-6 text-center text-sm text-muted-foreground">
                    This user doesn't own any workspaces yet — head to the Workspaces tab to create one.
                </div>
            ) : (
                user.ownedWorkspaces.map(ws => (
                    <WorkspaceCreditCard key={ws.id} ws={ws} onReload={onReload} onFlash={onFlash} />
                ))
            )}
        </div>
    );
}

function WorkspaceCreditCard({ ws, onReload, onFlash }: {
    ws: Workspace; onReload: () => Promise<void>; onFlash: (msg: string, ok?: boolean) => void;
}) {
    const [topUp, setTopUp] = useState('');
    const [saving, setSaving] = useState(false);
    const budget = (ws.plan?.monthlyCredits || 0) + (ws.creditTopUp || 0);
    const used = ws.creditsUsedThisPeriod || 0;
    const remaining = Math.max(0, budget - used);
    const pct = budget > 0 ? Math.min(100, (used / budget) * 100) : 0;
    const nearLimit = pct >= 80;

    const reset = async () => {
        if (!confirm(`Reset ${ws.name}'s credit usage to 0?`)) return;
        setSaving(true);
        try {
            await api.post(`/admin/credits/workspaces/${ws.id}/reset`);
            await onReload();
            onFlash('Credits reset');
        } catch (err: any) { onFlash(err.response?.data?.message || err.message, false); }
        finally { setSaving(false); }
    };
    const doTopUp = async () => {
        const n = Number(topUp);
        if (n <= 0) return;
        setSaving(true);
        try {
            await api.post(`/admin/credits/workspaces/${ws.id}/top-up`, { amount: n });
            await onReload();
            onFlash(`Added ${n.toLocaleString()} credits`);
            setTopUp('');
        } catch (err: any) { onFlash(err.response?.data?.message || err.message, false); }
        finally { setSaving(false); }
    };

    return (
        <div className="bg-secondary/20 border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="text-sm font-semibold flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-primary" /> {ws.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                        Plan: {ws.plan?.name || 'none'} · {(ws.plan?.monthlyCredits || 0).toLocaleString()} / mo
                        {ws.creditTopUp > 0 && <> · +{ws.creditTopUp.toLocaleString()} top-up</>}
                    </div>
                </div>
                <span className={`text-xs font-semibold ${nearLimit ? 'text-amber-400' : 'text-emerald-400'}`}>{remaining.toLocaleString()} left</span>
            </div>
            <div className="space-y-1">
                <div className="flex items-baseline justify-between text-xs">
                    <span className="font-mono">{used.toLocaleString()} / {budget.toLocaleString()}</span>
                    {ws.periodResetAt && (
                        <span className="text-muted-foreground">resets {new Date(ws.periodResetAt).toLocaleDateString()}</span>
                    )}
                </div>
                <div className="h-1.5 bg-secondary/60 rounded-full overflow-hidden">
                    <div className={`h-full transition-all ${nearLimit ? 'bg-amber-400' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
                </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <button onClick={reset} disabled={saving}
                    className="bg-card hover:bg-secondary border border-border rounded-lg px-3 py-2 text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-60">
                    <RotateCcw className="w-3.5 h-3.5" /> Reset to 0
                </button>
                <div className="flex gap-1">
                    <input type="number" min={1} step={100} value={topUp}
                        onChange={e => setTopUp(e.target.value)} placeholder="+1000"
                        className="flex-1 min-w-0 bg-secondary/50 border border-border rounded-lg px-2 py-2 text-xs" />
                    <button onClick={doTopUp} disabled={saving || !topUp || Number(topUp) <= 0}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-2.5 text-xs font-medium flex items-center gap-1 disabled:opacity-60">
                        <Plus className="w-3.5 h-3.5" /> Top-up
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Workspaces (new — create + members + transfer) ────────────────
function WorkspacesSection({ user, plans, onReload, onFlash }: {
    user: AdminUser; plans: Plan[];
    onReload: () => Promise<void>;
    onFlash: (msg: string, ok?: boolean) => void;
}) {
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [newPlanId, setNewPlanId] = useState<string>('');
    const [expandedWsId, setExpandedWsId] = useState<string | null>(null);

    const create = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newName.trim()) return;
        setCreating(true);
        try {
            await api.post(`/admin/users/${user.id}/workspaces`, {
                name: newName.trim(),
                planId: newPlanId || null,
            });
            setNewName(''); setNewPlanId('');
            await onReload();
            onFlash('Workspace created');
        } catch (err: any) { onFlash(err.response?.data?.message || err.message, false); }
        finally { setCreating(false); }
    };

    return (
        <div className="space-y-5">
            <Header icon={Building2} title="Workspaces"
                hint={`${user.ownedWorkspaces.length} owned. Create a new one, share it with other users, or transfer ownership.`} />

            {/* Create workspace */}
            <form onSubmit={create} className="bg-secondary/20 border border-border rounded-xl p-3 flex flex-col sm:flex-row gap-2">
                <input value={newName} onChange={e => setNewName(e.target.value)}
                    placeholder="New workspace name"
                    className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                <select value={newPlanId} onChange={e => setNewPlanId(e.target.value)}
                    className="bg-card border border-border rounded-lg px-3 py-2 text-sm">
                    <option value="" className="bg-card">— inherit user's plan</option>
                    {plans.map(p => <option key={p.id} value={p.id} className="bg-card">{p.name}</option>)}
                </select>
                <button type="submit" disabled={creating || !newName.trim()}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-1.5 disabled:opacity-60">
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Create
                </button>
            </form>

            {/* Owned workspace list — expandable rows */}
            {user.ownedWorkspaces.length === 0 ? (
                <div className="bg-secondary/20 border border-dashed border-border rounded-xl p-6 text-center text-sm text-muted-foreground">
                    No workspaces yet.
                </div>
            ) : (
                <div className="space-y-2">
                    {user.ownedWorkspaces.map(ws => (
                        <WorkspaceRow key={ws.id} ws={ws}
                            expanded={expandedWsId === ws.id}
                            onToggle={() => setExpandedWsId(prev => prev === ws.id ? null : ws.id)}
                            onFlash={onFlash} onReload={onReload} />
                    ))}
                </div>
            )}
        </div>
    );
}

function WorkspaceRow({ ws, expanded, onToggle, onFlash, onReload }: {
    ws: Workspace;
    expanded: boolean;
    onToggle: () => void;
    onFlash: (msg: string, ok?: boolean) => void;
    onReload: () => Promise<void>;
}) {
    return (
        <div className="bg-secondary/20 border border-border rounded-xl overflow-hidden">
            <button onClick={onToggle}
                className="w-full text-left p-3 flex items-center justify-between hover:bg-secondary/30">
                <div className="min-w-0 flex-1 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-primary flex-shrink-0" />
                    <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{ws.name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                            {ws.plan?.name || 'no plan'} · {ws.creditsUsedThisPeriod.toLocaleString()} / {((ws.plan?.monthlyCredits || 0) + ws.creditTopUp).toLocaleString()} credits
                        </div>
                    </div>
                </div>
                <ChevronLeft className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? '-rotate-90' : 'rotate-180'}`} />
            </button>
            {expanded && (
                <div className="border-t border-border">
                    <WorkspaceDetail wsId={ws.id} onFlash={onFlash} onReload={onReload} />
                </div>
            )}
        </div>
    );
}

// Expanded workspace: members, add-member, transfer, rename, delete.
type WsDetail = {
    id: string; name: string; ownerId: string;
    owner: { id: string; email: string; name: string | null };
    members: {
        id: string; role: string; roleId: string | null;
        user: { id: string; email: string; name: string | null };
        customRole: { id: string; name: string } | null;
    }[];
    invitations: { id: string; email: string; expiresAt: string }[];
    roles: { id: string; name: string; isSystem: boolean }[];
    _count?: { instances: number; agents: number; campaigns: number };
};

function WorkspaceDetail({ wsId, onFlash, onReload }: {
    wsId: string;
    onFlash: (msg: string, ok?: boolean) => void;
    onReload: () => Promise<void>;
}) {
    const [detail, setDetail] = useState<WsDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = async () => {
        try {
            const res = await api.get(`/admin/workspaces/${wsId}`);
            if (res.data.success) setDetail(res.data.workspace);
        } catch (err: any) { onFlash(err.response?.data?.message || err.message, false); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wsId]);

    const rename = async (name: string) => {
        setSaving(true);
        try {
            await api.put(`/admin/workspaces/${wsId}`, { name });
            await load();
            await onReload();
            onFlash('Renamed');
        } catch (err: any) { onFlash(err.response?.data?.message || err.message, false); }
        finally { setSaving(false); }
    };
    const del = async () => {
        if (!confirm(`Delete workspace "${detail?.name}"? Every instance, campaign, and message inside it is dropped. No undo.`)) return;
        setSaving(true);
        try {
            await api.delete(`/admin/workspaces/${wsId}`);
            await onReload();
            onFlash('Workspace deleted');
        } catch (err: any) {
            onFlash(err.response?.data?.message || err.message, false);
            setSaving(false);
        }
    };

    if (loading) return (
        <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
    );
    if (!detail) return (
        <div className="p-4 text-xs text-red-400">Failed to load workspace.</div>
    );

    return (
        <div className="p-4 space-y-4">
            {/* Rename + delete */}
            <div className="flex flex-col sm:flex-row gap-2">
                <RenameInput initial={detail.name} onSave={rename} saving={saving} />
                <button onClick={del} disabled={saving}
                    className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg px-3 py-2 text-xs font-medium flex items-center gap-1.5 disabled:opacity-60 flex-shrink-0">
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
            </div>
            <div className="text-[10px] text-muted-foreground">
                Owned by {detail.owner.name || detail.owner.email} · {detail._count?.instances ?? 0} WhatsApp · {detail._count?.agents ?? 0} agents · {detail._count?.campaigns ?? 0} campaigns
            </div>

            {/* Members */}
            <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                    Members ({detail.members.length})
                </div>
                <div className="space-y-1.5">
                    {detail.members.map(m => (
                        <MemberRow key={m.id} member={m}
                            isOwner={m.user.id === detail.ownerId}
                            wsId={detail.id}
                            roles={detail.roles}
                            onChanged={async () => { await load(); await onReload(); }}
                            onFlash={onFlash} />
                    ))}
                </div>
            </div>

            {/* Add member */}
            <AddMemberForm wsId={detail.id} roles={detail.roles}
                onAdded={async () => { await load(); await onReload(); }}
                onFlash={onFlash} />

            {/* Transfer */}
            <TransferForm wsId={detail.id} currentOwnerId={detail.ownerId}
                onDone={async () => { await load(); await onReload(); }}
                onFlash={onFlash} />

            {/* Pending invitations */}
            {detail.invitations.length > 0 && (
                <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                        Pending invitations ({detail.invitations.length})
                    </div>
                    <div className="space-y-1">
                        {detail.invitations.map(i => (
                            <div key={i.id} className="text-xs bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-1.5 flex items-center justify-between">
                                <span className="truncate">{i.email}</span>
                                <span className="text-[10px] text-muted-foreground">expires {new Date(i.expiresAt).toLocaleDateString()}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function RenameInput({ initial, onSave, saving }: { initial: string; onSave: (n: string) => void; saving: boolean }) {
    const [name, setName] = useState(initial);
    useEffect(() => { setName(initial); }, [initial]);
    const dirty = name.trim() && name.trim() !== initial;
    return (
        <div className="flex gap-1 flex-1">
            <input value={name} onChange={e => setName(e.target.value)}
                className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-xs" />
            <button onClick={() => dirty && onSave(name.trim())} disabled={!dirty || saving}
                className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-3 py-2 text-xs font-medium flex items-center gap-1 disabled:opacity-60">
                <Save className="w-3.5 h-3.5" /> Save
            </button>
        </div>
    );
}

function MemberRow({ member, isOwner, wsId, roles, onChanged, onFlash }: {
    member: WsDetail['members'][number];
    isOwner: boolean;
    wsId: string;
    roles: { id: string; name: string; isSystem: boolean }[];
    onChanged: () => Promise<void>;
    onFlash: (msg: string, ok?: boolean) => void;
}) {
    const [saving, setSaving] = useState(false);

    const changeRole = async (roleId: string) => {
        setSaving(true);
        try {
            await api.put(`/admin/workspaces/${wsId}/members/${member.id}`, { roleId });
            await onChanged();
            onFlash('Role updated');
        } catch (err: any) { onFlash(err.response?.data?.message || err.message, false); }
        finally { setSaving(false); }
    };
    const remove = async () => {
        if (!confirm(`Remove ${member.user.email} from this workspace?`)) return;
        setSaving(true);
        try {
            await api.delete(`/admin/workspaces/${wsId}/members/${member.id}`);
            await onChanged();
            onFlash('Removed');
        } catch (err: any) { onFlash(err.response?.data?.message || err.message, false); setSaving(false); }
    };

    return (
        <div className="bg-card border border-border rounded-lg p-2.5 flex items-center gap-2 flex-wrap">
            <div className="w-7 h-7 bg-secondary rounded-lg flex items-center justify-center text-[10px] font-bold text-muted-foreground flex-shrink-0">
                {(member.user.name || member.user.email)[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{member.user.name || member.user.email.split('@')[0]}</div>
                <div className="text-[10px] text-muted-foreground truncate">{member.user.email}</div>
            </div>
            {isOwner ? (
                <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-400">Owner</span>
            ) : (
                <>
                    <select value={member.roleId || ''} onChange={e => changeRole(e.target.value)} disabled={saving}
                        className="bg-secondary/50 border border-border rounded-md px-2 py-1 text-[11px]">
                        {roles.map(r => <option key={r.id} value={r.id} className="bg-card">{r.name}</option>)}
                    </select>
                    <button onClick={remove} disabled={saving}
                        title="Remove from workspace"
                        className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40">
                        <X className="w-3.5 h-3.5" />
                    </button>
                </>
            )}
        </div>
    );
}

// Add existing user as member by email or picker.
function AddMemberForm({ wsId, roles, onAdded, onFlash }: {
    wsId: string;
    roles: { id: string; name: string; isSystem: boolean }[];
    onAdded: () => Promise<void>;
    onFlash: (msg: string, ok?: boolean) => void;
}) {
    const [email, setEmail] = useState('');
    const [roleId, setRoleId] = useState<string>(() => roles.find(r => r.name === 'Member')?.id || roles[0]?.id || '');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!roleId) setRoleId(roles.find(r => r.name === 'Member')?.id || roles[0]?.id || '');
    }, [roles, roleId]);

    const add = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.trim()) return;
        setSaving(true);
        try {
            await api.post(`/admin/workspaces/${wsId}/members`, {
                email: email.trim(),
                roleId: roleId || undefined,
            });
            setEmail('');
            await onAdded();
            onFlash('Member added');
        } catch (err: any) { onFlash(err.response?.data?.message || err.message, false); }
        finally { setSaving(false); }
    };

    return (
        <form onSubmit={add} className="bg-secondary/20 border border-border rounded-xl p-3 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <UserPlus className="w-3 h-3" /> Add member
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 relative">
                    <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input value={email} onChange={e => setEmail(e.target.value)}
                        type="email" placeholder="user@example.com"
                        className="w-full bg-card border border-border rounded-lg pl-8 pr-3 py-2 text-xs" />
                </div>
                <select value={roleId} onChange={e => setRoleId(e.target.value)}
                    className="bg-card border border-border rounded-lg px-3 py-2 text-xs">
                    {roles.map(r => <option key={r.id} value={r.id} className="bg-card">{r.name}</option>)}
                </select>
                <button type="submit" disabled={saving || !email.trim()}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-4 py-2 text-xs font-medium flex items-center gap-1.5 disabled:opacity-60">
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Add
                </button>
            </div>
            <p className="text-[10px] text-muted-foreground">Must be an existing user. To invite by email with a signup link, use the workspace's own Settings → Members.</p>
        </form>
    );
}

function TransferForm({ wsId, currentOwnerId, onDone, onFlash }: {
    wsId: string;
    currentOwnerId: string;
    onDone: () => Promise<void>;
    onFlash: (msg: string, ok?: boolean) => void;
}) {
    const [newOwnerEmail, setNewOwnerEmail] = useState('');
    const [removeOldOwner, setRemoveOldOwner] = useState(false);
    const [saving, setSaving] = useState(false);

    const transfer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newOwnerEmail.trim()) return;
        if (!confirm(`Transfer this workspace to ${newOwnerEmail}? The current owner will be ${removeOldOwner ? 'removed' : 'downgraded to Member'}.`)) return;
        setSaving(true);
        try {
            // Look up user by email to grab their id.
            const users = await api.get('/admin/users');
            const target = users.data?.users?.find((u: any) => u.email === newOwnerEmail.trim().toLowerCase());
            if (!target) throw new Error('No user with that email');
            if (target.id === currentOwnerId) throw new Error('That user already owns this workspace');
            await api.put(`/admin/workspaces/${wsId}/transfer`, {
                newOwnerId: target.id,
                removeOldOwner,
            });
            setNewOwnerEmail('');
            await onDone();
            onFlash('Ownership transferred');
        } catch (err: any) { onFlash(err.response?.data?.message || err.message, false); }
        finally { setSaving(false); }
    };

    return (
        <form onSubmit={transfer} className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-amber-400/80 flex items-center gap-1.5">
                <ArrowRightLeft className="w-3 h-3" /> Transfer ownership
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
                <input value={newOwnerEmail} onChange={e => setNewOwnerEmail(e.target.value)}
                    type="email" placeholder="new-owner@example.com"
                    className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-xs" />
                <button type="submit" disabled={saving || !newOwnerEmail.trim()}
                    className="bg-amber-500 hover:bg-amber-500/90 text-amber-950 rounded-lg px-4 py-2 text-xs font-medium flex items-center gap-1.5 disabled:opacity-60">
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5" />}
                    Transfer
                </button>
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={removeOldOwner} onChange={e => setRemoveOldOwner(e.target.checked)}
                    className="w-3.5 h-3.5 accent-amber-500" />
                Also remove current owner from members
            </label>
        </form>
    );
}

// ─── Activity ──────────────────────────────────────────────────────
function ActivitySection({ ledger }: { ledger: LedgerRow[] }) {
    return (
        <div className="space-y-3">
            <Header icon={Activity} title="Recent activity" hint="Last 20 LLM calls across every workspace the user owns." />
            {ledger.length === 0 ? (
                <div className="bg-secondary/20 border border-dashed border-border rounded-xl p-6 text-center text-sm text-muted-foreground">
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
        </div>
    );
}

// ─── Access control (sidebar visibility) ──────────────────────────
const SIDEBAR_SECTIONS = [
    'inbox', 'clients', 'campaigns', 'automations', 'agents', 'analytics',
    'whatsapp', 'instagram', 'voice', 'calls', 'deals', 'calendar',
    'oversight', 'ads', 'settings', 'billing',
];
function AccessSection({ user, onPatch, saving }: {
    user: AdminUser;
    onPatch: (p: Partial<AdminUser>) => void;
    saving: boolean;
}) {
    const hidden = new Set(user.hiddenSections || []);
    const locked = new Set(user.lockedSections || []);
    const toggle = (set: 'hiddenSections' | 'lockedSections', key: string) => {
        const cur = new Set(user[set] || []);
        if (cur.has(key)) cur.delete(key); else cur.add(key);
        onPatch({ [set]: Array.from(cur) } as any);
    };
    return (
        <div className="space-y-4">
            <Header icon={Shield} title="Access control" hint="Hide sidebar items entirely, or leave them visible but locked with a padlock. Empty = default full access." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SIDEBAR_SECTIONS.map(s => {
                    const isHidden = hidden.has(s);
                    const isLocked = locked.has(s);
                    return (
                        <div key={s} className="bg-secondary/20 border border-border rounded-lg p-2.5 flex items-center gap-2">
                            <span className="text-xs font-medium flex-1 capitalize">{s}</span>
                            <button onClick={() => toggle('lockedSections', s)} disabled={saving}
                                className={`text-[10px] font-medium px-2 py-1 rounded ${isLocked ? 'bg-amber-500/15 text-amber-400' : 'bg-secondary text-muted-foreground'}`}>
                                {isLocked ? 'Locked' : 'Unlocked'}
                            </button>
                            <button onClick={() => toggle('hiddenSections', s)} disabled={saving}
                                className={`text-[10px] font-medium px-2 py-1 rounded ${isHidden ? 'bg-red-500/15 text-red-400' : 'bg-secondary text-muted-foreground'}`}>
                                {isHidden ? 'Hidden' : 'Visible'}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Danger ────────────────────────────────────────────────────────
function DangerSection({ onDelete, saving }: { onDelete: () => void; saving: boolean }) {
    return (
        <div className="bg-red-500/5 border border-red-500/30 rounded-2xl p-5 space-y-3">
            <h3 className="font-semibold flex items-center gap-2 text-red-400">
                <AlertTriangle className="w-4 h-4" /> Danger zone
            </h3>
            <p className="text-xs text-muted-foreground">
                Deleting this account cascades through every workspace, WhatsApp instance, agent, campaign, and message they own. There is no undo.
            </p>
            <button onClick={onDelete} disabled={saving}
                className="w-full bg-red-500/10 hover:bg-red-500/20 border border-red-500/40 text-red-400 rounded-lg px-3 py-2.5 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                <Trash2 className="w-4 h-4" /> Delete account permanently
            </button>
        </div>
    );
}

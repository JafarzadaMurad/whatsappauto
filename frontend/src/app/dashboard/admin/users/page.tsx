"use client";

import { useEffect, useState } from "react";
import { Users, Loader2, Pencil, X } from "lucide-react";
import api from "@/lib/api";

type Plan = { id: string; name: string; price: number; currency: string; interval: string };
type AdminUser = {
    id: string; email: string; name: string | null; role: string;
    planId: string | null;
    subscriptionStatus: string;
    subscriptionEndsAt: string | null;
    stripeCustomerId: string | null;
    createdAt: string;
    plan: Plan | null;
};

export default function AdminUsersPage() {
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [plans, setPlans] = useState<Plan[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<AdminUser | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        try {
            const [u, p] = await Promise.all([api.get('/admin/users'), api.get('/plans')]);
            if (u.data.success) setUsers(u.data.users);
            if (p.data.success) setPlans(p.data.plans);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const save = async () => {
        if (!editing) return;
        setSaving(true);
        setError(null);
        try {
            await api.put(`/admin/users/${editing.id}`, {
                role: editing.role,
                planId: editing.planId,
                subscriptionStatus: editing.subscriptionStatus,
                subscriptionEndsAt: editing.subscriptionEndsAt
            });
            setEditing(null);
            load();
        } catch (err: any) {
            setError(err.response?.data?.message || err.message);
        } finally { setSaving(false); }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    const statusColor = (s: string) => {
        if (s === 'active' || s === 'trialing') return 'bg-emerald-500/10 text-emerald-400';
        if (s === 'past_due') return 'bg-amber-500/10 text-amber-400';
        if (s === 'canceled') return 'bg-red-500/10 text-red-400';
        return 'bg-secondary text-muted-foreground';
    };

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-3">
                    <div className="p-2 bg-primary/10 text-primary rounded-xl"><Users className="w-6 h-6" /></div>
                    Users
                </h1>
                <p className="text-sm text-muted-foreground mt-1">All registered users. Assign plans and change roles.</p>
            </div>

            <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-secondary/50 border-b border-border text-left">
                            <th className="px-4 py-3 font-semibold text-muted-foreground">User</th>
                            <th className="px-4 py-3 font-semibold text-muted-foreground">Role</th>
                            <th className="px-4 py-3 font-semibold text-muted-foreground">Plan</th>
                            <th className="px-4 py-3 font-semibold text-muted-foreground">Subscription</th>
                            <th className="px-4 py-3 font-semibold text-muted-foreground">Joined</th>
                            <th className="px-4 py-3 font-semibold text-right text-muted-foreground w-20"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map(u => (
                            <tr key={u.id} className="border-b border-border/50 hover:bg-secondary/20">
                                <td className="px-4 py-3">
                                    <div className="font-medium">{u.name || '—'}</div>
                                    <div className="text-xs text-muted-foreground">{u.email}</div>
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${u.role === 'ADMIN' ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-secondary text-muted-foreground'}`}>
                                        {u.role}
                                    </span>
                                </td>
                                <td className="px-4 py-3">
                                    {u.plan ? (
                                        <div>
                                            <div className="font-medium">{u.plan.name}</div>
                                            <div className="text-xs text-muted-foreground">{u.plan.price} {u.plan.currency}/{u.plan.interval}</div>
                                        </div>
                                    ) : <span className="text-muted-foreground italic text-xs">none</span>}
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor(u.subscriptionStatus)}`}>{u.subscriptionStatus}</span>
                                    {u.subscriptionEndsAt && (
                                        <div className="text-[10px] text-muted-foreground mt-0.5">until {new Date(u.subscriptionEndsAt).toLocaleDateString()}</div>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                                <td className="px-4 py-3 text-right">
                                    <button onClick={() => { setEditing(u); setError(null); }}
                                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                                        <Pencil className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {editing && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
                    <div className="bg-card border border-border rounded-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-border">
                            <h3 className="font-semibold">Edit {editing.email}</h3>
                            <button onClick={() => setEditing(null)} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-4 space-y-3">
                            {error && <div className="text-xs text-red-400">{error}</div>}
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Role</label>
                                <select value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value })}
                                    className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                                    <option value="USER" className="bg-card">USER</option>
                                    <option value="ADMIN" className="bg-card">ADMIN</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Plan</label>
                                <select value={editing.planId || ''} onChange={e => setEditing({ ...editing, planId: e.target.value || null })}
                                    className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                                    <option value="" className="bg-card">No plan (unlimited / grandfathered)</option>
                                    {plans.map(p => <option key={p.id} value={p.id} className="bg-card">{p.name} — {p.price} {p.currency}/{p.interval}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Subscription status</label>
                                <select value={editing.subscriptionStatus} onChange={e => setEditing({ ...editing, subscriptionStatus: e.target.value })}
                                    className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                                    {['none', 'trialing', 'active', 'past_due', 'canceled'].map(s =>
                                        <option key={s} value={s} className="bg-card">{s}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Subscription ends at (optional)</label>
                                <input type="datetime-local"
                                    value={editing.subscriptionEndsAt ? new Date(editing.subscriptionEndsAt).toISOString().slice(0, 16) : ''}
                                    onChange={e => setEditing({ ...editing, subscriptionEndsAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                            </div>
                        </div>
                        <div className="p-4 border-t border-border flex justify-end gap-2">
                            <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl text-sm text-muted-foreground hover:bg-secondary/50">Cancel</button>
                            <button onClick={save} disabled={saving}
                                className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-5 py-2 flex items-center gap-2 text-sm transition-all disabled:opacity-60">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

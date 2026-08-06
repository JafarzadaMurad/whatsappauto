"use client";

// Admin → Referrals. The rules, and the commissions they produced.
//
// The two settings that decide what this costs — the percentage, and
// whether it applies to every payment or only the first — are the ones
// people change most and understand least, so each says what it means
// in money rather than in jargon.
//
// Changing a rate never rewrites commissions already recorded: each row
// keeps the percentage that was in force when it was earned. That's the
// difference between adjusting a setting and cutting someone's pay
// after the fact.

import { useEffect, useState } from "react";
import { Gift, Loader2, Check, X, Clock } from "lucide-react";
import api from "@/lib/api";
import UnsavedChangesBar from "@/components/UnsavedChangesBar";

type Settings = {
    enabled: boolean;
    percent: number;
    firstPaymentOnly: boolean;
    minPaymentUsd: number;
    holdbackDays: number;
    terms: string;
};

type Commission = {
    id: string; kind: string; paymentUsd: number; percent: number; amountUsd: number;
    status: string; paidAt: string | null; createdAt: string; note: string | null;
    referrer: { id: string; name: string | null; email: string };
    referral: { referred: { id: string; name: string | null; email: string } };
};

const STATUSES = ['pending', 'approved', 'paid', 'rejected', 'reversed'] as const;
const STATUS_STYLE: Record<string, string> = {
    pending: "bg-amber-500/10 text-amber-400 border-amber-500/25",
    approved: "bg-sky-500/10 text-sky-400 border-sky-500/25",
    paid: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
    rejected: "bg-red-500/10 text-red-400 border-red-500/25",
    reversed: "bg-zinc-500/10 text-zinc-400 border-zinc-500/25",
};

export default function AdminReferralsPage() {
    const [settings, setSettings] = useState<Settings | null>(null);
    const [baseline, setBaseline] = useState<Settings | null>(null);
    const [commissions, setCommissions] = useState<Commission[]>([]);
    const [totals, setTotals] = useState<Record<string, number>>({});
    const [filter, setFilter] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        try {
            const [s, c] = await Promise.all([
                api.get('/admin/referrals/settings'),
                api.get('/admin/referrals/commissions', { params: filter ? { status: filter } : {} }),
            ]);
            if (s.data?.success) { setSettings(s.data.settings); setBaseline(s.data.settings); }
            if (c.data?.success) { setCommissions(c.data.commissions || []); setTotals(c.data.totals || {}); }
        } catch (e: any) {
            setError(e.response?.data?.message || e.message);
        } finally { setLoading(false); }
    };
    useEffect(() => { load(); }, [filter]);

    const dirty = !!settings && !!baseline && JSON.stringify(settings) !== JSON.stringify(baseline);

    const save = async () => {
        if (!settings) return;
        setSaving(true);
        setError(null);
        try {
            const r = await api.put('/admin/referrals/settings', settings);
            if (r.data?.success) { setSettings(r.data.settings); setBaseline(r.data.settings); }
        } catch (e: any) {
            setError(e.response?.data?.message || e.message);
        } finally { setSaving(false); }
    };

    const setStatus = async (id: string, status: string) => {
        setBusy(id);
        try {
            await api.put(`/admin/referrals/commissions/${id}`, { status });
            await load();
        } catch (e: any) {
            setError(e.response?.data?.message || e.message);
        } finally { setBusy(null); }
    };

    if (loading || !settings) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    return (
        <div className="max-w-5xl mx-auto space-y-6 pb-24">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-3">
                    <div className="p-2 bg-primary/10 text-primary rounded-xl"><Gift className="w-6 h-6" /></div>
                    Referrals
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Users hand out a code; whoever signs up with it is tied to them permanently, and pays out a share
                    when they buy something.
                </p>
            </div>

            {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-2.5 rounded-xl">{error}</div>}

            {/* Rules */}
            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" checked={settings.enabled}
                        onChange={e => setSettings({ ...settings, enabled: e.target.checked })}
                        className="w-4 h-4 accent-primary mt-0.5" />
                    <div>
                        <div className="font-medium text-sm">Referral programme is on</div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Off means codes stop being attributed at sign-up. Commissions already recorded are untouched.
                        </p>
                    </div>
                </label>

                <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-border">
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Commission</label>
                        <div className="mt-1 flex items-center gap-2">
                            <input type="number" min={0} max={100} step="1" value={settings.percent}
                                onChange={e => setSettings({ ...settings, percent: Number(e.target.value) })}
                                className="w-24 bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-mono" />
                            <span className="text-sm text-muted-foreground">% of the payment</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                            On a $50 payment the referrer earns{' '}
                            <span className="text-foreground font-medium">${(50 * settings.percent / 100).toFixed(2)}</span>.
                        </p>
                    </div>

                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Minimum payment</label>
                        <div className="mt-1 flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">$</span>
                            <input type="number" min={0} step="1" value={settings.minPaymentUsd}
                                onChange={e => setSettings({ ...settings, minPaymentUsd: Number(e.target.value) })}
                                className="w-24 bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-mono" />
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                            Payments under this earn nothing, so small top-ups don&apos;t spawn cent-sized commissions.
                        </p>
                    </div>

                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Holdback</label>
                        <div className="mt-1 flex items-center gap-2">
                            <input type="number" min={0} max={365} step="1" value={settings.holdbackDays}
                                onChange={e => setSettings({ ...settings, holdbackDays: Number(e.target.value) })}
                                className="w-24 bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-mono" />
                            <span className="text-sm text-muted-foreground">days</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                            {settings.holdbackDays > 0
                                ? `A commission stays provisional for ${settings.holdbackDays} days. If the payment is refunded in that window it is reversed automatically and costs nothing.`
                                : 'No holdback — commissions are payable immediately, and a refund after payout has to be recovered by hand.'}
                        </p>
                    </div>
                </div>

                <div className="pt-2 border-t border-border">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Pays out on</div>
                    <div className="grid sm:grid-cols-2 gap-2">
                        <button onClick={() => setSettings({ ...settings, firstPaymentOnly: true })}
                            className={`text-left rounded-xl border p-3 transition-all ${
                                settings.firstPaymentOnly ? 'border-primary/50 bg-primary/5' : 'border-border bg-secondary/20 hover:bg-secondary/40'
                            }`}>
                            <div className="font-medium text-sm">First payment only</div>
                            <p className="text-xs text-muted-foreground mt-1">
                                One payout per referred customer, whenever they first buy. Predictable cost.
                            </p>
                        </button>
                        <button onClick={() => setSettings({ ...settings, firstPaymentOnly: false })}
                            className={`text-left rounded-xl border p-3 transition-all ${
                                !settings.firstPaymentOnly ? 'border-primary/50 bg-primary/5' : 'border-border bg-secondary/20 hover:bg-secondary/40'
                            }`}>
                            <div className="font-medium text-sm">Every payment</div>
                            <p className="text-xs text-muted-foreground mt-1">
                                Pays out for as long as the customer keeps paying — including every monthly renewal.
                                Stronger incentive, ongoing cost.
                            </p>
                        </button>
                    </div>
                </div>

                <div className="pt-2 border-t border-border">
                    <label className="text-xs font-medium text-muted-foreground">Terms shown to users</label>
                    <textarea value={settings.terms} rows={3}
                        onChange={e => setSettings({ ...settings, terms: e.target.value })}
                        placeholder="e.g. how and when payouts are made"
                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
            </div>

            {/* Commissions */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
                    <h2 className="font-semibold text-sm">Commissions</h2>
                    <div className="flex items-center gap-1.5">
                        {(['', ...STATUSES] as string[]).map(s => (
                            <button key={s || 'all'} onClick={() => setFilter(s)}
                                className={`text-xs rounded-lg px-2.5 py-1 border transition-all ${
                                    filter === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary/40 border-border hover:bg-secondary'
                                }`}>
                                {s || 'all'}
                                {totals[s || 'all'] != null && (
                                    <span className="ml-1 opacity-60">${(totals[s || 'all'] || 0).toFixed(0)}</span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {commissions.length === 0 ? (
                    <p className="px-5 py-12 text-center text-sm text-muted-foreground">Nothing here yet.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-secondary/40 text-[10px] uppercase text-muted-foreground">
                                <tr>
                                    <th className="px-5 py-2 text-left font-medium">Date</th>
                                    <th className="px-3 py-2 text-left font-medium">Referrer</th>
                                    <th className="px-3 py-2 text-left font-medium">Customer</th>
                                    <th className="px-3 py-2 text-right font-medium">Payment</th>
                                    <th className="px-3 py-2 text-right font-medium">Rate</th>
                                    <th className="px-3 py-2 text-right font-medium">Owed</th>
                                    <th className="px-5 py-2 text-right font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {commissions.map(c => (
                                    <tr key={c.id} className="border-t border-border/60">
                                        <td className="px-5 py-2 text-xs whitespace-nowrap">{new Date(c.createdAt).toLocaleDateString()}</td>
                                        <td className="px-3 py-2 text-xs truncate max-w-[160px]">{c.referrer.name || c.referrer.email}</td>
                                        <td className="px-3 py-2 text-xs truncate max-w-[160px] text-muted-foreground">
                                            {c.referral.referred.name || c.referral.referred.email}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-xs">${c.paymentUsd.toFixed(2)}</td>
                                        <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{c.percent}%</td>
                                        <td className="px-3 py-2 text-right font-mono text-xs text-emerald-400">${c.amountUsd.toFixed(2)}</td>
                                        <td className="px-5 py-2">
                                            <div className="flex items-center justify-end gap-1.5">
                                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${STATUS_STYLE[c.status] || ''}`}>
                                                    {c.status}
                                                </span>
                                                {busy === c.id ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                                                ) : (
                                                    <>
                                                        {c.status === 'pending' && (
                                                            <button onClick={() => setStatus(c.id, 'approved')} title="Approve"
                                                                className="p-1 rounded text-muted-foreground hover:text-sky-400">
                                                                <Clock className="w-3.5 h-3.5" />
                                                            </button>
                                                        )}
                                                        {c.status !== 'paid' && (
                                                            <button onClick={() => setStatus(c.id, 'paid')} title="Mark paid"
                                                                className="p-1 rounded text-muted-foreground hover:text-emerald-400">
                                                                <Check className="w-3.5 h-3.5" />
                                                            </button>
                                                        )}
                                                        {c.status !== 'rejected' && (
                                                            <button onClick={() => setStatus(c.id, 'rejected')} title="Reject"
                                                                className="p-1 rounded text-muted-foreground hover:text-red-400">
                                                                <X className="w-3.5 h-3.5" />
                                                            </button>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <p className="px-5 py-3 text-[11px] text-muted-foreground border-t border-border">
                    Marking paid records the decision — it does not move money. Pay out however you normally do.
                </p>
            </div>

            <UnsavedChangesBar dirty={dirty} saving={saving} onSave={save}
                onDiscard={() => baseline && setSettings(baseline)}
                label="Unsaved referral rules" />
        </div>
    );
}

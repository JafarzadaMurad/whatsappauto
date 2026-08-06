"use client";

// Your referral code, who came through it, and what you've earned.
//
// The number that matters is not "how many people signed up" — it's how
// many of them paid, because that's the gap people are surprised by.
// Both are shown side by side for that reason.

import { useEffect, useState } from "react";
import { Gift, Loader2, Copy, Check, Users, Coins, LinkIcon } from "lucide-react";
import api from "@/lib/api";

type Summary = {
    code: string;
    enabled: boolean;
    percent: number;
    firstPaymentOnly: boolean;
    holdbackDays: number;
    terms: string;
    clicks: number;
    uniqueClicks: number;
    signups: number;
    paying: number;
    earnedTotalUsd: number;
    earnedHeldUsd: number;
    earnedAvailableUsd: number;
    earnedPaidUsd: number;
    referrals: {
        id: string; createdAt: string; source: string;
        referred: { id: string; name: string | null; email: string; createdAt: string };
        commissions: { amountUsd: number; status: string }[];
    }[];
    commissions: {
        id: string; kind: string; paymentUsd: number; percent: number; amountUsd: number;
        status: string; paidAt: string | null; availableAt: string | null; createdAt: string;
    }[];
};

const STATUS_STYLE: Record<string, string> = {
    pending: "bg-amber-500/10 text-amber-400",
    approved: "bg-sky-500/10 text-sky-400",
    reversed: "bg-zinc-500/10 text-zinc-400",
    paid: "bg-emerald-500/10 text-emerald-400",
    rejected: "bg-red-500/10 text-red-400",
};

export default function ReferralsPage() {
    const [data, setData] = useState<Summary | null>(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState<string | null>(null);

    useEffect(() => {
        api.get('/referrals/me')
            .then(r => { if (r.data?.success) setData(r.data); })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const copy = async (text: string, what: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(what);
            setTimeout(() => setCopied(null), 1500);
        } catch { /* clipboard blocked — the value is on screen anyway */ }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );
    if (!data) return (
        <div className="max-w-3xl mx-auto text-center py-20 text-muted-foreground">Could not load your referrals.</div>
    );

    const link = typeof window !== 'undefined'
        ? `${window.location.origin}/register?ref=${data.code}`
        : `/register?ref=${data.code}`;

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-3">
                    <div className="p-2 bg-primary/10 text-primary rounded-xl"><Gift className="w-6 h-6" /></div>
                    Refer &amp; earn
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    {data.enabled
                        ? <>Share your link. When someone signs up through it and pays, you earn{' '}
                            <span className="text-foreground font-medium">{data.percent}%</span>
                            {data.firstPaymentOnly ? ' of their first payment.' : ' of every payment they make.'}</>
                        : 'The referral programme is currently switched off. Your code still works once it is enabled.'}
                </p>
            </div>

            {/* Code + link */}
            <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Your code</label>
                        <div className="mt-1 flex gap-2">
                            <div className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 font-mono text-lg tracking-widest">
                                {data.code}
                            </div>
                            <button onClick={() => copy(data.code, 'code')}
                                className="px-3 rounded-lg bg-secondary/60 border border-border hover:bg-secondary text-muted-foreground hover:text-foreground">
                                {copied === 'code' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Your link</label>
                        <div className="mt-1 flex gap-2">
                            <div className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-xs font-mono truncate flex items-center gap-2">
                                <LinkIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                {link}
                            </div>
                            <button onClick={() => copy(link, 'link')}
                                className="px-3 rounded-lg bg-secondary/60 border border-border hover:bg-secondary text-muted-foreground hover:text-foreground">
                                {copied === 'link' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>
                </div>
                {data.terms && (
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap pt-1 border-t border-border">{data.terms}</p>
                )}
            </div>

            {/* Numbers */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat icon={LinkIcon} label="Link clicks" value={data.uniqueClicks}
                    sub={data.clicks !== data.uniqueClicks ? `${data.clicks} total` : undefined} />
                <Stat icon={Users} label="Signed up" value={data.signups} />
                <Stat icon={Users} label="Of those, paid" value={data.paying} accent />
                <Stat icon={Coins} label="Earned" value={`$${data.earnedTotalUsd.toFixed(2)}`} />
            </div>

            {/* Where the money stands. "Earned" and "can be paid out"
                are different numbers during the holdback, and saying so
                here prevents the obvious support question. */}
            <div className="bg-card border border-border rounded-2xl p-4 grid sm:grid-cols-3 gap-3 text-sm">
                <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Held</div>
                    <div className="font-bold text-amber-400">${data.earnedHeldUsd.toFixed(2)}</div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                        Waiting out the {data.holdbackDays}-day window in case the payment is refunded.
                    </p>
                </div>
                <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Ready</div>
                    <div className="font-bold text-emerald-400">${data.earnedAvailableUsd.toFixed(2)}</div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Cleared and payable.</p>
                </div>
                <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Paid out</div>
                    <div className="font-bold">${data.earnedPaidUsd.toFixed(2)}</div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Already sent to you.</p>
                </div>
            </div>

            {/* Who came through */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border">
                    <h2 className="font-semibold text-sm">People you referred</h2>
                </div>
                {data.referrals.length === 0 ? (
                    <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                        Nobody yet. Share your link above.
                    </p>
                ) : (
                    <div className="divide-y divide-border">
                        {data.referrals.map(r => {
                            const earned = r.commissions.reduce((n, c) => n + c.amountUsd, 0);
                            return (
                                <div key={r.id} className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                                    <div className="min-w-0">
                                        <div className="text-sm truncate">{r.referred.name || r.referred.email}</div>
                                        <div className="text-[11px] text-muted-foreground">
                                            joined {new Date(r.createdAt).toLocaleDateString()}
                                            {r.source === 'link' ? ' · via link' : ' · via code'}
                                        </div>
                                    </div>
                                    <div className="text-sm font-mono">
                                        {earned > 0
                                            ? <span className="text-emerald-400">${earned.toFixed(2)}</span>
                                            : <span className="text-muted-foreground text-xs">no payment yet</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Earnings */}
            {data.commissions.length > 0 && (
                <div className="bg-card border border-border rounded-2xl overflow-hidden">
                    <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                        <h2 className="font-semibold text-sm">Earnings</h2>
                        {data.earnedHeldUsd > 0 && (
                            <span className="text-xs text-amber-400">${data.earnedHeldUsd.toFixed(2)} still held</span>
                        )}
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-secondary/40 text-[10px] uppercase text-muted-foreground">
                                <tr>
                                    <th className="px-5 py-2 text-left font-medium">Date</th>
                                    <th className="px-3 py-2 text-left font-medium">From</th>
                                    <th className="px-3 py-2 text-right font-medium">Payment</th>
                                    <th className="px-3 py-2 text-right font-medium">Rate</th>
                                    <th className="px-3 py-2 text-right font-medium">You earned</th>
                                    <th className="px-5 py-2 text-right font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.commissions.map(c => (
                                    <tr key={c.id} className="border-t border-border/60">
                                        <td className="px-5 py-2 text-xs">{new Date(c.createdAt).toLocaleDateString()}</td>
                                        <td className="px-3 py-2 text-xs capitalize">{c.kind}</td>
                                        <td className="px-3 py-2 text-right font-mono text-xs">${c.paymentUsd.toFixed(2)}</td>
                                        <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{c.percent}%</td>
                                        <td className="px-3 py-2 text-right font-mono text-xs text-emerald-400">${c.amountUsd.toFixed(2)}</td>
                                        <td className="px-5 py-2 text-right">
                                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_STYLE[c.status] || 'bg-secondary text-muted-foreground'}`}>
                                                {c.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

function Stat({ icon: Icon, label, value, sub, accent }: {
    icon: any; label: string; value: any; sub?: string; accent?: boolean;
}) {
    return (
        <div className="bg-card border border-border rounded-2xl px-4 py-3">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <Icon className="w-3.5 h-3.5" /> {label}
            </div>
            <div className={`mt-1 text-xl font-bold ${accent ? 'text-emerald-400' : ''}`}>{value}</div>
            {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
        </div>
    );
}

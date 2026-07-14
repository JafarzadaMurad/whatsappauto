"use client";

// Workspace-level cai usage widget. Shows the pool state at the top,
// then a line chart of daily cai burn over the last 30 days, then a
// per-cause bar chart, then the raw ledger table.

import { useEffect, useMemo, useState } from "react";
import { Coins, Loader2, TrendingUp, Zap } from "lucide-react";
import api from "@/lib/api";

type Balance = {
    monthlyCredits: number;
    topUp: number;
    totalBudget: number;
    used: number;
    remaining: number;
    periodResetAt: string | null;
    allowCustomApiKeys: boolean;
    overageBehavior: "hard_block" | "top_up";
};

type LedgerRow = {
    id: string;
    provider: string;
    model: string;
    cause: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    realCostUsd: number;
    creditsUsed: number;
    usedOwnKey: boolean;
    createdAt: string;
    agent: { id: string; name: string } | null;
    user: { id: string; name: string | null; email: string } | null;
};

const CAUSE_LABELS: Record<string, { label: string; color: string }> = {
    whatsapp_reply: { label: 'WhatsApp reply', color: 'bg-emerald-500' },
    instagram_dm:   { label: 'Instagram DM',   color: 'bg-pink-500' },
    campaign:       { label: 'Campaign',        color: 'bg-blue-500' },
    oversight:      { label: 'Oversight',       color: 'bg-purple-500' },
    ads_gen:        { label: 'Ads generator',   color: 'bg-orange-500' },
    mcp_tool:       { label: 'MCP tool',        color: 'bg-cyan-500' },
    router:         { label: 'Router agent',    color: 'bg-amber-500' },
    whisper:        { label: 'Whisper STT',     color: 'bg-teal-500' },
    other:          { label: 'Other',           color: 'bg-secondary' },
};

export default function UsagePage() {
    const [balance, setBalance] = useState<Balance | null>(null);
    const [history, setHistory] = useState<LedgerRow[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const [b, h] = await Promise.all([
                    api.get('/credits/balance'),
                    api.get('/credits/history?days=30'),
                ]);
                if (b.data.success) setBalance(b.data.balance);
                if (h.data.success) setHistory(h.data.history);
            } finally { setLoading(false); }
        })();
    }, []);

    const daily = useMemo(() => {
        const map = new Map<string, number>();
        for (const r of history) {
            const day = r.createdAt.slice(0, 10);
            map.set(day, (map.get(day) || 0) + r.creditsUsed);
        }
        return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
    }, [history]);

    const byCause = useMemo(() => {
        const map = new Map<string, number>();
        for (const r of history) map.set(r.cause, (map.get(r.cause) || 0) + r.creditsUsed);
        return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    }, [history]);

    const totalUsdSaved = useMemo(() =>
        history.filter(r => r.usedOwnKey).reduce((s, r) => s + r.realCostUsd, 0)
    , [history]);

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    if (!balance) return (
        <div className="max-w-4xl mx-auto p-8 text-center text-muted-foreground">
            Workspace balance is unavailable. Please contact support.
        </div>
    );

    const percent = balance.totalBudget > 0
        ? Math.min(100, (balance.used / balance.totalBudget) * 100)
        : 0;
    const nearLimit = percent >= 80;
    const dailyMax = Math.max(1, ...daily.map(d => d[1]));
    const causeMax = Math.max(1, ...byCause.map(c => c[1]));

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-3">
                    <div className="p-2 bg-primary/10 text-primary rounded-xl"><Coins className="w-6 h-6" /></div>
                    Usage
                </h1>
                <p className="text-sm text-muted-foreground mt-1">Your workspace's cai balance and recent AI activity.</p>
            </div>

            {/* Balance card */}
            <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
                <div className="flex items-baseline justify-between flex-wrap gap-4">
                    <div>
                        <div className="text-sm text-muted-foreground">Used this period</div>
                        <div className="text-3xl font-bold mt-1">
                            {balance.used.toLocaleString()} <span className="text-lg text-muted-foreground font-normal">/ {balance.totalBudget.toLocaleString()} cai</span>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-sm text-muted-foreground">Remaining</div>
                        <div className={`text-2xl font-bold mt-1 ${nearLimit ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {balance.remaining.toLocaleString()} cai
                        </div>
                    </div>
                </div>
                <div className="h-3 bg-secondary/60 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${nearLimit ? 'bg-amber-400' : 'bg-primary'}`}
                        style={{ width: `${percent}%` }} />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2">
                    <div className="space-x-4">
                        <span>Plan: <span className="text-foreground font-mono">{balance.monthlyCredits.toLocaleString()}</span></span>
                        {balance.topUp > 0 && <span>+ Top-up: <span className="text-foreground font-mono">{balance.topUp.toLocaleString()}</span></span>}
                    </div>
                    {balance.periodResetAt && (
                        <span>Next reset: <span className="text-foreground">{new Date(balance.periodResetAt).toLocaleDateString()}</span></span>
                    )}
                </div>
                {balance.allowCustomApiKeys && (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 flex items-start gap-2 text-xs">
                        <Zap className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <span className="text-emerald-400 font-semibold">Bring-your-own key enabled. </span>
                            <span className="text-muted-foreground">Add your own API key on the AI Providers page and calls made with it won't consume cai.</span>
                            {totalUsdSaved > 0 && <span className="text-emerald-400"> — You've saved ~${totalUsdSaved.toFixed(2)} in the last 30 days.</span>}
                        </div>
                    </div>
                )}
            </div>

            {/* Daily chart */}
            <div className="bg-card border border-border rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Last 30 days</h2>
                    <span className="text-xs text-muted-foreground">Total: {daily.reduce((s, [, v]) => s + v, 0).toLocaleString()} cai</span>
                </div>
                {daily.length === 0 ? (
                    <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">No usage yet.</div>
                ) : (
                    <div className="h-32 flex items-end gap-1">
                        {daily.map(([day, val]) => (
                            <div key={day} className="flex-1 flex flex-col items-center gap-1 group">
                                <div className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                                    {val.toLocaleString()}
                                </div>
                                <div className="w-full bg-primary/70 rounded-t hover:bg-primary transition-colors"
                                    style={{ height: `${Math.max(2, (val / dailyMax) * 100)}%` }} title={`${day}: ${val.toLocaleString()} cai`} />
                                <div className="text-[9px] text-muted-foreground">{day.slice(5)}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Cause breakdown */}
            {byCause.length > 0 && (
                <div className="bg-card border border-border rounded-2xl p-6">
                    <h2 className="font-semibold mb-4">Usage by source</h2>
                    <div className="space-y-2">
                        {byCause.map(([cause, val]) => {
                            const c = CAUSE_LABELS[cause] || CAUSE_LABELS.other;
                            return (
                                <div key={cause}>
                                    <div className="flex items-center justify-between text-xs mb-1">
                                        <span>{c.label}</span>
                                        <span className="font-mono text-muted-foreground">{val.toLocaleString()} cai</span>
                                    </div>
                                    <div className="h-1.5 bg-secondary/60 rounded-full overflow-hidden">
                                        <div className={`h-full ${c.color}`} style={{ width: `${(val / causeMax) * 100}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Recent ledger */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-border">
                    <h2 className="font-semibold">Last 100 calls</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-secondary/50 text-xs uppercase text-muted-foreground">
                            <tr>
                                <th className="px-4 py-2 text-left">Time</th>
                                <th className="px-4 py-2 text-left">Source</th>
                                <th className="px-4 py-2 text-left">Model</th>
                                <th className="px-4 py-2 text-right">In / Out</th>
                                <th className="px-4 py-2 text-right">Real $</th>
                                <th className="px-4 py-2 text-right">cai</th>
                                <th className="px-4 py-2 text-left">Agent</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.slice(0, 100).map(r => (
                                <tr key={r.id} className="border-t border-border">
                                    <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</td>
                                    <td className="px-4 py-2 text-xs">{CAUSE_LABELS[r.cause]?.label || r.cause}</td>
                                    <td className="px-4 py-2 font-mono text-[10px]">{r.provider}/{r.model}</td>
                                    <td className="px-4 py-2 text-right font-mono text-xs">{r.inputTokens.toLocaleString()} / {r.outputTokens.toLocaleString()}</td>
                                    <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">${r.realCostUsd.toFixed(4)}</td>
                                    <td className="px-4 py-2 text-right font-mono text-xs">
                                        {r.usedOwnKey
                                            ? <span className="text-emerald-400">BYOK</span>
                                            : <span className="text-primary">{r.creditsUsed.toLocaleString()}</span>}
                                    </td>
                                    <td className="px-4 py-2 text-xs text-muted-foreground">{r.agent?.name || '—'}</td>
                                </tr>
                            ))}
                            {history.length === 0 && (
                                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No usage yet.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

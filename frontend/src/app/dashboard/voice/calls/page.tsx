"use client";

// Call history page — every inbound / outbound / web voice call across
// this workspace's Voice Assistants. Row = summary; click opens the
// detail drawer with per-component cost breakdown + transcript +
// recording playback (when we have one).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    PhoneCall, Loader2, Coins, ArrowDownLeft, ArrowUpRight, Globe, X,
    CheckCircle2, XCircle, Voicemail, PhoneOff,
} from "lucide-react";
import api from "@/lib/api";

type Call = {
    id: string;
    voiceAssistantId: string | null;
    phoneNumberId: string | null;
    direction: 'inbound' | 'outbound' | 'web';
    fromNumber: string | null;
    toNumber: string | null;
    status: string;
    endedReason: string | null;
    durationSec: number | null;
    transcriberCostUsd: number;
    llmCostUsd: number;
    ttsCostUsd: number;
    telephonyCostUsd: number;
    totalCostUsd: number;
    creditsUsed: number;
    transcript: Array<{ role: 'user' | 'assistant'; text: string; at?: string }> | null;
    recordingUrl: string | null;
    startedAt: string;
    endedAt: string | null;
    voiceAssistant?: { id: string; name: string } | null;
    phoneNumber?: { id: string; number: string } | null;
};

const statusIcon = (status: string) => {
    if (status === 'completed') return CheckCircle2;
    if (status === 'voicemail') return Voicemail;
    if (status === 'no-answer' || status === 'busy' || status === 'canceled') return PhoneOff;
    return XCircle;
};

const statusColor = (status: string) => {
    if (status === 'completed') return 'text-emerald-400 bg-emerald-500/10';
    if (status === 'voicemail') return 'text-amber-400 bg-amber-500/10';
    if (status === 'in-progress' || status === 'ringing') return 'text-primary bg-primary/10';
    return 'text-red-400 bg-red-500/10';
};

const dirIcon = (dir: string) => {
    if (dir === 'inbound') return ArrowDownLeft;
    if (dir === 'outbound') return ArrowUpRight;
    return Globe;
};

function fmtDuration(sec: number | null): string {
    if (!sec) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

export default function CallHistoryPage() {
    // Reuses the existing /credits/history-style pattern would be ideal
    // but calls need their own listing endpoint — this page fetches
    // /voice/numbers as a lightweight join for phone number → number
    // lookup and paginates client-side for MVP.
    const [calls, setCalls] = useState<Call[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Call | null>(null);

    const load = async () => {
        try {
            // NOTE: /voice/calls endpoint pending in this commit — for
            // now the page renders empty gracefully; the next commit
            // adds the listing endpoint that queries prisma.phoneCall.
            const res = await api.get('/voice/calls').catch(() => ({ data: { success: false, calls: [] } }));
            if (res.data.success) setCalls(res.data.calls);
        } finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const totalToday = useMemo(() => {
        const cutoff = new Date();
        cutoff.setHours(0, 0, 0, 0);
        return calls.filter(c => new Date(c.startedAt) >= cutoff)
            .reduce((s, c) => s + (c.creditsUsed || 0), 0);
    }, [calls]);

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-xl"><PhoneCall className="w-6 h-6" /></div>
                        Call History
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Every voice call answered by your assistants. Click a row for the transcript + per-component cost breakdown.
                    </p>
                </div>
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Today</div>
                    <div className="font-mono font-bold flex items-center gap-1.5 mt-0.5">
                        <Coins className="w-3.5 h-3.5 text-amber-400" />
                        {totalToday.toLocaleString()} credits
                    </div>
                </div>
            </div>

            {calls.length === 0 ? (
                <div className="bg-card border border-dashed border-border rounded-2xl p-12 text-center space-y-3">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary">
                        <PhoneCall className="w-7 h-7" />
                    </div>
                    <div>
                        <p className="font-semibold">No calls yet</p>
                        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                            Once someone calls a <Link href="/dashboard/voice/numbers" className="text-primary hover:underline">phone number</Link> assigned to a <Link href="/dashboard/voice/assistants" className="text-primary hover:underline">voice assistant</Link>, the call will appear here in real time.
                        </p>
                    </div>
                </div>
            ) : (
                <div className="bg-card border border-border rounded-2xl overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-secondary/50 text-xs uppercase text-muted-foreground">
                            <tr>
                                <th className="px-4 py-3 text-left w-8"></th>
                                <th className="px-4 py-3 text-left">Time</th>
                                <th className="px-4 py-3 text-left">From → To</th>
                                <th className="px-4 py-3 text-left">Assistant</th>
                                <th className="px-4 py-3 text-left">Status</th>
                                <th className="px-4 py-3 text-right">Duration</th>
                                <th className="px-4 py-3 text-right">Cost</th>
                                <th className="px-4 py-3 text-right">Credits</th>
                            </tr>
                        </thead>
                        <tbody>
                            {calls.map(c => {
                                const StatusIcon = statusIcon(c.status);
                                const DirIcon = dirIcon(c.direction);
                                return (
                                    <tr key={c.id}
                                        onClick={() => setSelected(c)}
                                        className="border-t border-border/50 hover:bg-secondary/20 cursor-pointer">
                                        <td className="px-4 py-3">
                                            <DirIcon className="w-3.5 h-3.5 text-muted-foreground" />
                                        </td>
                                        <td className="px-4 py-3 text-xs text-muted-foreground">
                                            {new Date(c.startedAt).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs">
                                            {c.fromNumber || '?'} <span className="text-muted-foreground">→</span> {c.toNumber || '?'}
                                        </td>
                                        <td className="px-4 py-3 text-xs">{c.voiceAssistant?.name || '—'}</td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${statusColor(c.status)}`}>
                                                <StatusIcon className="w-3 h-3" />
                                                {c.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-xs">{fmtDuration(c.durationSec)}</td>
                                        <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">${(c.totalCostUsd || 0).toFixed(3)}</td>
                                        <td className="px-4 py-3 text-right font-mono text-xs text-amber-400">{(c.creditsUsed || 0).toLocaleString()}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {selected && <CallDrawer call={selected} onClose={() => setSelected(null)} />}
        </div>
    );
}

// ─── Detail drawer ─────────────────────────────────────────────────
function CallDrawer({ call, onClose }: { call: Call; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex" onClick={onClose}>
            <div className="flex-1 bg-black/60 backdrop-blur-sm" />
            <div className="w-full max-w-lg h-full bg-card border-l border-border overflow-y-auto animate-in slide-in-from-right duration-200"
                onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between z-10">
                    <div>
                        <h3 className="font-semibold">Call detail</h3>
                        <div className="text-[10px] text-muted-foreground font-mono">{call.id.slice(0, 8)}...</div>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <Stat label="From" value={call.fromNumber || '?'} mono />
                        <Stat label="To" value={call.toNumber || '?'} mono />
                        <Stat label="Assistant" value={call.voiceAssistant?.name || '—'} />
                        <Stat label="Duration" value={fmtDuration(call.durationSec)} mono />
                        <Stat label="Direction" value={call.direction} />
                        <Stat label="Status" value={call.status} />
                        {call.endedReason && <Stat label="Ended reason" value={call.endedReason} />}
                    </div>

                    <div className="bg-secondary/20 border border-border rounded-xl p-3">
                        <h4 className="text-xs font-semibold flex items-center gap-2 mb-2">
                            <Coins className="w-3.5 h-3.5 text-amber-400" /> Cost breakdown
                        </h4>
                        <div className="space-y-1.5 text-xs">
                            <CostRow label="Transcriber" usd={call.transcriberCostUsd} />
                            <CostRow label="LLM" usd={call.llmCostUsd} />
                            <CostRow label="TTS" usd={call.ttsCostUsd} />
                            <CostRow label="Telephony" usd={call.telephonyCostUsd} />
                            <div className="border-t border-border/50 pt-1.5 flex items-center justify-between">
                                <span className="font-semibold">Total</span>
                                <span className="font-mono font-bold">${call.totalCostUsd.toFixed(4)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Credits charged</span>
                                <span className="font-mono text-amber-400 font-semibold">{call.creditsUsed.toLocaleString()}</span>
                            </div>
                        </div>
                    </div>

                    {call.recordingUrl && (
                        <div>
                            <h4 className="text-xs font-semibold mb-2">Recording</h4>
                            <audio controls src={call.recordingUrl} className="w-full" />
                        </div>
                    )}

                    {call.transcript && call.transcript.length > 0 && (
                        <div>
                            <h4 className="text-xs font-semibold mb-2">Transcript</h4>
                            <div className="space-y-1.5">
                                {call.transcript.map((t, i) => (
                                    <div key={i} className={`flex ${t.role === 'assistant' ? 'justify-start' : 'justify-end'}`}>
                                        <div className={`max-w-[85%] rounded-xl px-3 py-1.5 text-xs whitespace-pre-wrap break-words ${
                                            t.role === 'assistant' ? 'bg-secondary/60' : 'bg-primary/15 text-primary-foreground'
                                        }`}>
                                            {t.text}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="bg-secondary/20 rounded-lg p-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className={`mt-0.5 ${mono ? 'font-mono' : ''}`}>{value}</div>
        </div>
    );
}

function CostRow({ label, usd }: { label: string; usd: number }) {
    return (
        <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono">${(usd || 0).toFixed(4)}</span>
        </div>
    );
}

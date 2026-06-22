"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { BarChart3, Loader2, Pin, Sparkles, Users, MessageSquare, DollarSign, Activity } from "lucide-react";
import api from "@/lib/api";
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar, Cell,
} from "recharts";

// ─── Types ───
type Filters = {
    from?: string; to?: string;
    status?: string[]; tags?: string[];
    channel?: 'whatsapp' | 'instagram';
    agentId?: string;
    instanceId?: string;
    customField?: { key: string; value: any };
};

type ViewFlags = {
    statusFunnel: boolean;
    rates: boolean;
    channel: boolean;
    agents: boolean;
    tags: boolean;
    customField: boolean;
};
const DEFAULT_VIEW: ViewFlags = {
    statusFunnel: true,
    rates: true,
    channel: true,
    agents: true,
    tags: true,
    customField: true,
};
const VIEW_STORAGE_KEY = 'analytics:view-flags:v1';

type MetricKey = 'funnel' | 'daily_volume' | 'channel_split' | 'tag_conversion' | 'agent_perf' | 'drop_off';

const METRICS: Array<{ key: MetricKey; label: string; vis: 'funnel' | 'line' | 'bar' | 'table' }> = [
    { key: 'funnel',         label: 'Sales funnel',     vis: 'funnel' },
    { key: 'daily_volume',   label: 'Daily volume',     vis: 'line'   },
    { key: 'channel_split',  label: 'Channel split',    vis: 'bar'    },
    { key: 'tag_conversion', label: 'Tag conversion',   vis: 'table'  },
    { key: 'agent_perf',     label: 'Agent performance', vis: 'table' },
    { key: 'drop_off',       label: 'Drop-off points',  vis: 'table'  },
];

const COLORS = ['#3b82f6', '#a855f7', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#84cc16', '#ec4899'];

function toIsoDate(d: Date) { return d.toISOString().slice(0, 10); }

export default function AnalyticsPage() {
    const today = useMemo(() => new Date(), []);
    const thirtyDaysAgo = useMemo(() => new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000), [today]);

    const [filters, setFilters] = useState<Filters>({
        from: toIsoDate(thirtyDaysAgo),
        to: toIsoDate(today),
    });
    const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
    const [active, setActive] = useState<MetricKey>('funnel');
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<any>(null);
    const [kpis, setKpis] = useState<any>(null);
    const [userFields, setUserFields] = useState<{ key: string; label: string }[]>([]);
    const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
    const [instances, setInstances] = useState<Array<{ id: string; name: string; channel: 'whatsapp' | 'instagram' }>>([]);
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [view, setView] = useState<ViewFlags>(DEFAULT_VIEW);
    const [viewPanelOpen, setViewPanelOpen] = useState(false);

    // Restore + persist the per-section visibility toggles so the
    // operator's preferred layout sticks across reloads.
    useEffect(() => {
        try {
            const saved = localStorage.getItem(VIEW_STORAGE_KEY);
            if (saved) setView({ ...DEFAULT_VIEW, ...JSON.parse(saved) });
        } catch { /* ignore */ }
    }, []);
    useEffect(() => {
        try { localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view)); } catch {}
    }, [view]);

    useEffect(() => {
        api.get('/user-fields').then(r => {
            if (r.data?.success) setUserFields((r.data.fields || []).map((f: any) => ({ key: f.key, label: f.label || f.key })));
        }).catch(() => {});
        api.get('/agents').then(r => {
            if (r.data?.success) setAgents((r.data.agents || []).map((a: any) => ({ id: a.id, name: a.name })));
        }).catch(() => {});
        // Pull WhatsApp instances + Instagram accounts so the operator
        // can scope analytics down to a single number / account.
        Promise.all([
            api.get('/instances').catch(() => ({ data: { success: false } })),
            api.get('/instagram/accounts').catch(() => ({ data: { success: false } })),
        ]).then(([waRes, igRes]) => {
            const list: typeof instances = [];
            if (waRes.data?.success) {
                for (const i of (waRes.data.instances || [])) list.push({ id: i.id, name: i.name, channel: 'whatsapp' });
            }
            if (igRes.data?.success) {
                for (const a of (igRes.data.accounts || [])) list.push({ id: a.id, name: '@' + a.igUsername, channel: 'instagram' });
            }
            setInstances(list);
        }).catch(() => {});
        // Pull a generous page of clients to surface the unique tag set —
        // good enough for a filter dropdown without a dedicated endpoint.
        api.get('/clients', { params: { pageSize: 200 } }).then(r => {
            if (r.data?.success) {
                const all = new Set<string>();
                for (const c of r.data.clients || []) (c.tags || []).forEach((t: string) => all.add(t));
                setAvailableTags(Array.from(all).sort());
            }
        }).catch(() => {});
    }, []);

    const runQuery = useCallback(async (metric: MetricKey) => {
        setLoading(true);
        try {
            const r = await api.post('/analytics/query', { metric, filters, period });
            if (r.data?.success) setData(r.data);
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        } finally { setLoading(false); }
    }, [filters, period]);

    const refreshKpis = useCallback(async () => {
        try {
            const r = await api.post('/analytics/query', { metric: 'kpis', filters });
            if (r.data?.success) setKpis(r.data);
        } catch { /* ignore */ }
    }, [filters]);

    useEffect(() => { runQuery(active); }, [active, runQuery]);
    useEffect(() => { refreshKpis(); }, [refreshKpis]);

    const pinWidget = async () => {
        const metricDef = METRICS.find(m => m.key === active);
        if (!metricDef) return;
        const title = prompt(`Title for the pinned widget`, metricDef.label);
        if (!title) return;
        try {
            await api.post('/analytics/widgets', {
                title, metric: active, filters, period,
                visualType: metricDef.vis,
                size: 'md',
            });
            alert('Pinned to Dashboard.');
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        }
    };

    return (
        <div className="max-w-7xl mx-auto space-y-5">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <BarChart3 className="w-5 h-5" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold">Analytics</h1>
                    <p className="text-sm text-muted-foreground">Explore conversions, agent costs, channel volume and where customers drop off.</p>
                </div>
            </div>

            {/* Filter-active banner — visible when any segment filter is on */}
            {kpis?.filterActive && kpis?.baseline && (
                <div className="bg-primary/5 border border-primary/30 rounded-2xl p-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="font-semibold text-primary">Filter active</span>
                    <span className="text-foreground">
                        {kpis.segment?.contacts ?? 0} of {kpis.baseline.contacts ?? 0} contacts match
                        {kpis.baseline.contacts > 0 && (
                            <span className="text-muted-foreground"> · {((kpis.segment.contacts / kpis.baseline.contacts) * 100).toFixed(1)}% of total</span>
                        )}
                    </span>
                </div>
            )}

            {/* KPI strip */}
            {kpis && (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
                    <KpiCard icon={Users}        label="Contacts (all-time)" value={kpis.totalContacts} />
                    <KpiCard icon={Sparkles}     label="In range"            value={kpis.newContacts}    baseline={kpis.baseline?.contacts}      accent="text-emerald-400" />
                    <KpiCard icon={Activity}     label="LEAD"                value={kpis.leadCount}      baseline={kpis.baseline?.leadCount}     accent="text-amber-400" />
                    <KpiCard icon={Activity}     label="PURCHASED"           value={kpis.purchasedCount} baseline={kpis.baseline?.purchasedCount} accent="text-green-400" />
                    <KpiCard icon={MessageSquare} label="AI turns"           value={kpis.totalAiTurns}   baseline={kpis.baseline?.aiTurns}       accent="text-violet-300" />
                    <KpiCard icon={DollarSign}   label="Tokens"              value={kpis.totalTokens?.toLocaleString?.() || '0'} accent="text-sky-300" />
                    <KpiCard icon={Activity}     label="Operator tickets"    value={kpis.operatorTickets} baseline={kpis.baseline?.operatorTickets} />
                </div>
            )}

            {/* Filter bar */}
            <section className="bg-card border border-border rounded-2xl p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
                <div>
                    <label className="text-[11px] text-muted-foreground">From</label>
                    <input type="date" value={filters.from || ''} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
                        className="mt-1 w-full bg-secondary/40 border border-border rounded-lg px-3 py-1.5 text-sm" />
                </div>
                <div>
                    <label className="text-[11px] text-muted-foreground">To</label>
                    <input type="date" value={filters.to || ''} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
                        className="mt-1 w-full bg-secondary/40 border border-border rounded-lg px-3 py-1.5 text-sm" />
                </div>
                <div>
                    <label className="text-[11px] text-muted-foreground">Channel</label>
                    <select value={filters.channel || ''} onChange={e => setFilters(f => ({ ...f, channel: (e.target.value || undefined) as any }))}
                        className="mt-1 w-full bg-secondary/40 border border-border rounded-lg px-3 py-1.5 text-sm">
                        <option value="">All</option>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="instagram">Instagram</option>
                    </select>
                </div>
                <div>
                    <label className="text-[11px] text-muted-foreground">Agent</label>
                    <select value={filters.agentId || ''} onChange={e => setFilters(f => ({ ...f, agentId: e.target.value || undefined }))}
                        className="mt-1 w-full bg-secondary/40 border border-border rounded-lg px-3 py-1.5 text-sm">
                        <option value="">All</option>
                        {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                </div>
                <div>
                    <label className="text-[11px] text-muted-foreground">Instance</label>
                    <select value={filters.instanceId || ''} onChange={e => setFilters(f => ({ ...f, instanceId: e.target.value || undefined }))}
                        className="mt-1 w-full bg-secondary/40 border border-border rounded-lg px-3 py-1.5 text-sm">
                        <option value="">All channels</option>
                        {instances.filter(i => i.channel === 'whatsapp').map(i => (
                            <option key={i.id} value={i.id}>📱 {i.name}</option>
                        ))}
                        {instances.filter(i => i.channel === 'instagram').map(i => (
                            <option key={i.id} value={i.id}>📸 {i.name}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="text-[11px] text-muted-foreground">Status</label>
                    <select value={filters.status?.[0] || ''}
                        onChange={e => setFilters(f => ({ ...f, status: e.target.value ? [e.target.value] : undefined }))}
                        className="mt-1 w-full bg-secondary/40 border border-border rounded-lg px-3 py-1.5 text-sm">
                        <option value="">All</option>
                        <option value="NEW">NEW</option>
                        <option value="LEAD">LEAD</option>
                        <option value="PURCHASED">PURCHASED</option>
                        <option value="SPAM">SPAM</option>
                    </select>
                </div>
                <div>
                    <label className="text-[11px] text-muted-foreground">Tag</label>
                    <select value={filters.tags?.[0] || ''}
                        onChange={e => setFilters(f => ({ ...f, tags: e.target.value ? [e.target.value] : undefined }))}
                        className="mt-1 w-full bg-secondary/40 border border-border rounded-lg px-3 py-1.5 text-sm">
                        <option value="">All</option>
                        {availableTags.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                <div className="col-span-2 md:col-span-3 lg:col-span-7">
                    <label className="text-[11px] text-muted-foreground">Custom field</label>
                    <div className="mt-1 flex gap-1 max-w-md">
                        <select value={filters.customField?.key || ''}
                            onChange={e => setFilters(f => ({
                                ...f, customField: e.target.value ? { key: e.target.value, value: f.customField?.value ?? '' } : undefined,
                            }))}
                            className="flex-1 bg-secondary/40 border border-border rounded-lg px-2 py-1.5 text-sm">
                            <option value="">— No custom-field filter —</option>
                            {userFields.length === 0 && (
                                <option disabled>No user fields defined yet</option>
                            )}
                            {userFields.map(uf => <option key={uf.key} value={uf.key}>{uf.label}</option>)}
                        </select>
                        <input type="text" value={filters.customField?.value || ''}
                            placeholder="value"
                            disabled={!filters.customField?.key}
                            onChange={e => setFilters(f => ({
                                ...f, customField: f.customField ? { key: f.customField.key, value: e.target.value } : undefined,
                            }))}
                            className="w-32 bg-secondary/40 border border-border rounded-lg px-2 py-1.5 text-sm disabled:opacity-50" />
                    </div>
                </div>
            </section>

            {/* Metric tabs + actions */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex flex-wrap gap-1 border border-border rounded-xl bg-card/40 p-1">
                    {METRICS.map(m => (
                        <button key={m.key} onClick={() => setActive(m.key)}
                            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${active === m.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                            {m.label}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2 relative">
                    {active === 'daily_volume' && (
                        <select value={period} onChange={e => setPeriod(e.target.value as any)}
                            className="bg-secondary/40 border border-border rounded-lg px-3 py-1.5 text-xs">
                            <option value="day">By day</option>
                            <option value="week">By week</option>
                            <option value="month">By month</option>
                        </select>
                    )}
                    {active === 'funnel' && (
                        <button onClick={() => setViewPanelOpen(o => !o)}
                            className="bg-secondary/40 border border-border rounded-lg px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5">
                            ⚙ View
                        </button>
                    )}
                    <button onClick={pinWidget}
                        className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5">
                        <Pin className="w-3.5 h-3.5" /> Pin to Dashboard
                    </button>

                    {viewPanelOpen && active === 'funnel' && (
                        <div className="absolute right-0 top-full mt-2 z-20 bg-card border border-border rounded-xl shadow-2xl p-3 w-64 space-y-2">
                            <div className="flex items-center justify-between mb-1">
                                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Show in funnel view</h4>
                                <button onClick={() => setViewPanelOpen(false)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
                            </div>
                            {([
                                ['statusFunnel', 'Status funnel bars'],
                                ['rates',        'Conversion rate cards'],
                                ['channel',      'Breakdown by channel'],
                                ['agents',       'Breakdown by assigned agent'],
                                ['tags',         'Co-occurring tags'],
                                ['customField',  'Top custom-field values'],
                            ] as Array<[keyof ViewFlags, string]>).map(([k, label]) => (
                                <label key={k} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-secondary/30 p-1.5 rounded">
                                    <input type="checkbox" checked={view[k]} onChange={e => setView(v => ({ ...v, [k]: e.target.checked }))}
                                        className="w-3.5 h-3.5 accent-primary" />
                                    {label}
                                </label>
                            ))}
                            <div className="flex justify-end pt-2 border-t border-border">
                                <button onClick={() => setView(DEFAULT_VIEW)}
                                    className="text-[11px] text-muted-foreground hover:text-foreground">
                                    Reset
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Result panel */}
            <section className="bg-card border border-border rounded-2xl p-5 min-h-[300px]">
                {loading ? (
                    <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                ) : data ? (
                    <MetricResult metric={active} data={data} view={view} />
                ) : (
                    <div className="text-center text-muted-foreground py-12 text-sm">Run a query…</div>
                )}
            </section>
        </div>
    );
}

function KpiCard({ icon: Icon, label, value, accent, baseline }: { icon: any; label: string; value: any; accent?: string; baseline?: number }) {
    // When a baseline is provided AND a segment is in play, show
    // "X of Y · Z%" so the operator immediately sees what the filter
    // narrowed down to.
    const numericValue = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9]/g, '')) || 0;
    const showBaseline = baseline !== undefined && baseline !== null && baseline !== numericValue;
    return (
        <div className="bg-card border border-border rounded-xl p-3 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                <Icon className="w-3 h-3" /> {label}
            </div>
            <div className={`text-xl font-bold ${accent || ''}`}>{value ?? '—'}</div>
            {showBaseline && (
                <div className="text-[10px] text-muted-foreground">
                    of {baseline.toLocaleString()} overall
                    {baseline > 0 && <span className="ml-1">· {((numericValue / baseline) * 100).toFixed(1)}%</span>}
                </div>
            )}
        </div>
    );
}

export function MetricResult({ metric, data, view }: { metric: string; data: any; view?: ViewFlags }) {
    const v = view || DEFAULT_VIEW;
    if (metric === 'funnel') {
        const totals = data.total || 0;
        const max = Math.max(1, ...(data.rows || []).map((r: any) => r.count));
        const anyBreakdown = !!data.breakdowns && (
            (v.channel && data.breakdowns.channel?.length > 0) ||
            (v.agents && data.breakdowns.topAgents?.length > 0) ||
            (v.tags && data.breakdowns.topTags?.length > 0) ||
            (v.customField && !!data.breakdowns.customField)
        );
        return (
            <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                    Total contacts in range: <span className="font-semibold text-foreground">{totals}</span>
                </div>
                {v.statusFunnel && (
                    <div className="space-y-2">
                        {data.rows.map((r: any, i: number) => {
                            const pct = totals > 0 ? (r.count / totals) * 100 : 0;
                            return (
                                <div key={r.status}>
                                    <div className="flex items-center justify-between text-xs mb-1">
                                        <span className="font-medium">{r.status}</span>
                                        <span className="text-muted-foreground">{r.count} ({pct.toFixed(1)}%)</span>
                                    </div>
                                    <div className="h-3 rounded-full bg-secondary/40 overflow-hidden">
                                        <div className="h-full" style={{ width: `${(r.count / max) * 100}%`, background: COLORS[i % COLORS.length] }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                {v.rates && (
                    <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border">
                        <RateCard label="Lead rate"        value={data.rates.leadRate}       baseline={data.baseline?.rates?.leadRate}       accent="text-amber-400" />
                        <RateCard label="Purchase rate"    value={data.rates.purchaseRate}   baseline={data.baseline?.rates?.purchaseRate}   accent="text-emerald-400" />
                        <RateCard label="Lead → Purchase"  value={data.rates.leadToPurchase} baseline={data.baseline?.rates?.leadToPurchase} accent="text-green-400" />
                    </div>
                )}

                {anyBreakdown && (
                    <div className="pt-3 border-t border-border space-y-3">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Segment breakdown</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {v.channel && data.breakdowns.channel?.length > 0 && (
                                <BreakdownCard title="By channel" rows={data.breakdowns.channel} />
                            )}
                            {v.agents && data.breakdowns.topAgents?.length > 0 && (
                                <BreakdownCard title="By assigned agent" rows={data.breakdowns.topAgents} />
                            )}
                            {v.tags && data.breakdowns.topTags?.length > 0 && (
                                <BreakdownCard title="Co-occurring tags" rows={data.breakdowns.topTags} />
                            )}
                            {v.customField && data.breakdowns.customField && (
                                <BreakdownCard
                                    title={`Top values of "${data.breakdowns.customField.key}"`}
                                    rows={data.breakdowns.customField.rows} />
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    }
    if (metric === 'daily_volume') {
        // Group by bucket; series per channel
        const bucketMap = new Map<string, any>();
        for (const r of data.rows || []) {
            const k = new Date(r.bucket).toISOString().slice(0, 10);
            const existing = bucketMap.get(k) || { bucket: k };
            existing[r.channel] = (existing[r.channel] || 0) + r.count;
            bucketMap.set(k, existing);
        }
        const rows = Array.from(bucketMap.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
        if (rows.length === 0) return <Empty />;
        return (
            <div style={{ width: '100%', height: 320 }}>
                <ResponsiveContainer>
                    <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="#262630" strokeDasharray="3 3" />
                        <XAxis dataKey="bucket" stroke="#888" fontSize={11} />
                        <YAxis stroke="#888" fontSize={11} />
                        <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #262630', borderRadius: 8 }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line dataKey="whatsapp" stroke="#10b981" strokeWidth={2} dot={false} />
                        <Line dataKey="instagram" stroke="#ec4899" strokeWidth={2} dot={false} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        );
    }
    if (metric === 'channel_split') {
        const rows = data.rows || [];
        if (rows.length === 0) return <Empty />;
        return (
            <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                    <BarChart data={rows}>
                        <CartesianGrid stroke="#262630" strokeDasharray="3 3" />
                        <XAxis dataKey="channel" stroke="#888" fontSize={11} />
                        <YAxis stroke="#888" fontSize={11} />
                        <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #262630', borderRadius: 8 }} />
                        <Bar dataKey="count">
                            {rows.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        );
    }
    if (metric === 'tag_conversion') {
        const rows = data.rows || [];
        if (rows.length === 0) return <Empty />;
        return (
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                        <tr className="border-b border-border">
                            <th className="text-left py-2">Tag</th>
                            <th className="text-right py-2">Contacts</th>
                            <th className="text-right py-2">Lead</th>
                            <th className="text-right py-2">Purchased</th>
                            <th className="text-right py-2">Lead %</th>
                            <th className="text-right py-2">Purchase %</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r: any) => (
                            <tr key={r.tag} className="border-b border-border/40">
                                <td className="py-2 font-medium">{r.tag}</td>
                                <td className="py-2 text-right">{r.total}</td>
                                <td className="py-2 text-right text-amber-300">{r.lead}</td>
                                <td className="py-2 text-right text-emerald-300">{r.purchased}</td>
                                <td className="py-2 text-right">{r.leadRate}%</td>
                                <td className="py-2 text-right">{r.purchaseRate}%</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }
    if (metric === 'agent_perf') {
        const rows = data.rows || [];
        const t = data.totals || { turns: 0, tokens: 0, costUsd: 0 };
        return (
            <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                    <KpiCard icon={Activity}     label="Total turns"  value={t.turns} />
                    <KpiCard icon={MessageSquare} label="Total tokens" value={t.tokens.toLocaleString()} accent="text-sky-300" />
                    <KpiCard icon={DollarSign}   label="Est. cost"    value={`$${t.costUsd.toFixed(4)}`} accent="text-emerald-300" />
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="text-xs text-muted-foreground">
                            <tr className="border-b border-border">
                                <th className="text-left py-2">Agent</th>
                                <th className="text-left py-2">Model</th>
                                <th className="text-right py-2">Turns</th>
                                <th className="text-right py-2">Tokens (in / out / total)</th>
                                <th className="text-right py-2">Est. cost</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r: any) => (
                                <tr key={r.agentId} className="border-b border-border/40">
                                    <td className="py-2">
                                        <span className="font-medium">{r.name}</span>
                                        {r.isRouter && <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-300">router</span>}
                                    </td>
                                    <td className="py-2 text-muted-foreground text-xs font-mono">{r.provider} · {r.model}</td>
                                    <td className="py-2 text-right">{r.turns}</td>
                                    <td className="py-2 text-right text-xs font-mono text-muted-foreground">
                                        {r.promptTokens.toLocaleString()} / {r.completionTokens.toLocaleString()} / {r.totalTokens.toLocaleString()}
                                    </td>
                                    <td className="py-2 text-right text-emerald-300">${r.estCostUsd.toFixed(4)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }
    if (metric === 'drop_off') {
        const rows = data.rows || [];
        if (rows.length === 0) return <Empty hint="No drop-offs in the selected period." />;
        return (
            <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Last assistant messages in chats that went cold (no customer reply for &gt;24h). High counts mean this question loses customers — improve the prompt around it.</p>
                <div className="space-y-1.5">
                    {rows.map((r: any, i: number) => (
                        <div key={i} className="flex items-start gap-3 p-3 border border-border rounded-xl bg-secondary/10">
                            <div className="text-2xl font-bold text-amber-400 w-10 text-right">{r.times}</div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm whitespace-pre-wrap break-words">{r.reply.slice(0, 280)}{r.reply.length > 280 ? '…' : ''}</p>
                                <p className="text-[10px] text-muted-foreground mt-1">Last seen: {new Date(r.latest).toLocaleString()}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }
    return <Empty />;
}

// Simple labeled-bar list — used for cross-dimensional breakdowns
// (channel, tag, agent, custom field) of the filtered segment so the
// operator sees what the matched set actually looks like, not just
// status distribution.
function BreakdownCard({ title, rows }: { title: string; rows: Array<{ key: string; count: number }> }) {
    const max = Math.max(1, ...rows.map(r => r.count));
    const total = rows.reduce((a, b) => a + b.count, 0);
    return (
        <div className="bg-card border border-border rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</h4>
                <span className="text-[10px] text-muted-foreground">{total} total</span>
            </div>
            <div className="space-y-1.5">
                {rows.map((r, i) => {
                    const pct = total > 0 ? (r.count / total) * 100 : 0;
                    return (
                        <div key={r.key + i}>
                            <div className="flex items-center justify-between text-xs mb-0.5">
                                <span className="truncate flex-1 min-w-0">{r.key}</span>
                                <span className="text-muted-foreground ml-2">{r.count} ({pct.toFixed(1)}%)</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-secondary/40 overflow-hidden">
                                <div className="h-full" style={{ width: `${(r.count / max) * 100}%`, background: COLORS[i % COLORS.length] }} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// Rate card with side-by-side filtered vs baseline % and a delta hint.
// Used inside the funnel result. Baseline is undefined when no segment
// filter is active — then we collapse to a plain KpiCard appearance.
function RateCard({ label, value, baseline, accent }: { label: string; value: number; baseline?: number; accent?: string }) {
    const hasBaseline = baseline !== undefined && baseline !== null;
    const delta = hasBaseline ? Math.round((value - baseline) * 10) / 10 : 0;
    const deltaColor = delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-muted-foreground';
    return (
        <div className="bg-card border border-border rounded-xl p-3 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                <Activity className="w-3 h-3" /> {label}
            </div>
            <div className={`text-xl font-bold ${accent || ''}`}>{value}%</div>
            {hasBaseline && (
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <span>workspace {baseline}%</span>
                    <span className={deltaColor}>· {delta > 0 ? '+' : ''}{delta} pp</span>
                </div>
            )}
        </div>
    );
}

function Empty({ hint }: { hint?: string } = {}) {
    return <div className="text-center text-muted-foreground py-12 text-sm">{hint || 'No data for the selected range.'}</div>;
}

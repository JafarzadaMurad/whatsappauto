"use client";

import { MessageSquare, Link2, Key, Loader2, X, BarChart3, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { MetricResult } from "./analytics/page";

interface Widget {
    id: string;
    title: string;
    metric: string;
    filters: any;
    visualType: string;
    size: 'sm' | 'md' | 'lg';
    position: number;
}

export default function DashboardStatsPage() {
    const [stats, setStats] = useState({
        activeInstances: 0,
        totalWebhooks: 0,
        totalApiKeys: 0,
    });
    const [loadingStats, setLoadingStats] = useState(true);
    const [widgets, setWidgets] = useState<Widget[]>([]);
    const [widgetData, setWidgetData] = useState<Record<string, any>>({});
    const [loadingWidgets, setLoadingWidgets] = useState(true);

    const loadStats = useCallback(async () => {
        try {
            const [instRes, webRes, keyRes] = await Promise.all([
                api.get('/instances'),
                api.get('/webhooks'),
                api.get('/keys'),
            ]);
            setStats({
                activeInstances: instRes.data.instances?.filter((i: any) => i.status === 'CONNECTED').length || 0,
                totalWebhooks: webRes.data.webhooks?.length || 0,
                totalApiKeys: keyRes.data.keys?.length || 0,
            });
        } catch (e) { console.error(e); }
        finally { setLoadingStats(false); }
    }, []);

    const loadWidgets = useCallback(async () => {
        try {
            const r = await api.get('/analytics/widgets');
            if (r.data?.success) {
                const ws: Widget[] = r.data.widgets || [];
                setWidgets(ws);
                // Fetch each widget's data in parallel
                const dataMap: Record<string, any> = {};
                await Promise.all(ws.map(async w => {
                    try {
                        const qr = await api.post('/analytics/query', { metric: w.metric, filters: w.filters || {} });
                        if (qr.data?.success) dataMap[w.id] = qr.data;
                    } catch { /* per-widget failure shouldn't break the rest */ }
                }));
                setWidgetData(dataMap);
            }
        } catch (e) { console.error(e); }
        finally { setLoadingWidgets(false); }
    }, []);

    useEffect(() => { loadStats(); loadWidgets(); }, [loadStats, loadWidgets]);

    const removeWidget = async (id: string) => {
        if (!confirm('Remove this widget from the Dashboard?')) return;
        try {
            await api.delete(`/analytics/widgets/${id}`);
            setWidgets(prev => prev.filter(w => w.id !== id));
        } catch (e: any) { alert(e.response?.data?.message || e.message); }
    };

    const cards = [
        { title: "Active WhatsApp Accounts", value: stats.activeInstances, icon: MessageSquare, href: "/dashboard/whatsapp", color: "text-emerald-500", bg: "bg-emerald-500/10" },
        { title: "Active Webhooks", value: stats.totalWebhooks, icon: Link2, href: "/dashboard/webhooks", color: "text-blue-500", bg: "bg-blue-500/10" },
        { title: "API Keys", value: stats.totalApiKeys, icon: Key, href: "/dashboard/api-keys", color: "text-amber-500", bg: "bg-amber-500/10" },
    ];

    return (
        <div className="max-w-7xl mx-auto space-y-8">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
                    <p className="text-muted-foreground mt-1">Platform overview + your pinned analytics widgets.</p>
                </div>
                <Link href="/dashboard/analytics"
                    className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-xl px-3 py-2 text-sm font-medium">
                    <BarChart3 className="w-4 h-4" /> Explore analytics
                </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {cards.map((obj, i) => {
                    const Icon = obj.icon;
                    return (
                        <Link key={i} href={obj.href} className="bg-card border border-border p-6 rounded-2xl shadow-sm hover:border-primary/50 transition-colors group">
                            <div className="flex items-center justify-between mb-4">
                                <div className={`p-3 rounded-xl ${obj.bg}`}>
                                    <Icon className={`w-6 h-6 ${obj.color}`} />
                                </div>
                            </div>
                            <h2 className="text-muted-foreground text-sm font-medium">{obj.title}</h2>
                            <div className="mt-2 flex items-baseline gap-2">
                                {loadingStats ? (
                                    <div className="h-8 w-16 bg-secondary animate-pulse rounded-md"></div>
                                ) : (
                                    <span className="text-3xl font-bold text-foreground group-hover:text-primary transition-colors">{obj.value}</span>
                                )}
                            </div>
                        </Link>
                    );
                })}
            </div>

            {/* Pinned widgets */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-lg">Analytics widgets</h2>
                </div>
                {loadingWidgets ? (
                    <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                ) : widgets.length === 0 ? (
                    <div className="bg-card border border-border rounded-2xl p-8 text-center">
                        <BarChart3 className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                        <p className="text-sm text-muted-foreground mb-4">No analytics widgets pinned yet.</p>
                        <Link href="/dashboard/analytics"
                            className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-xl px-4 py-2 text-sm font-medium">
                            <Plus className="w-4 h-4" /> Pin one from the Analytics page
                        </Link>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {widgets.map(w => {
                            const data = widgetData[w.id];
                            // KPI = small big-number card. Other types render
                            // the existing metric components and span the full
                            // row width so charts stay readable.
                            const isKpi = w.visualType === 'kpi';
                            const className = isKpi
                                ? 'bg-card border border-border rounded-2xl p-4'
                                : 'bg-card border border-border rounded-2xl p-4 col-span-2 md:col-span-3 lg:col-span-4';
                            return (
                                <div key={w.id} className={className}>
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                        <h3 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground truncate">{w.title}</h3>
                                        <button onClick={() => removeWidget(w.id)} title="Remove"
                                            className="text-muted-foreground hover:text-red-400 p-1">
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                    {data ? (
                                        isKpi ? <KpiBig data={data} /> : <MetricResult metric={w.metric} data={data} />
                                    ) : (
                                        <div className="text-xs text-muted-foreground py-6 text-center">Loading…</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

// Big-number KPI card. Reads { count, baseline } from the count
// metric response. Shows the segment count loud and clear, with a
// "of N total · X%" footer when a baseline is present so the operator
// instantly sees what fraction of the workspace the widget covers.
function KpiBig({ data }: { data: { count: number; baseline: number | null } }) {
    const v = data?.count ?? 0;
    const b = data?.baseline;
    const pct = b && b > 0 ? (v / b) * 100 : null;
    return (
        <div className="flex flex-col gap-1 py-2">
            <div className="text-4xl font-bold text-primary">{v.toLocaleString()}</div>
            {b !== null && b !== undefined && (
                <div className="text-[11px] text-muted-foreground">
                    of {b.toLocaleString()} overall
                    {pct !== null && <span className="ml-1">· {pct.toFixed(1)}%</span>}
                </div>
            )}
        </div>
    );
}

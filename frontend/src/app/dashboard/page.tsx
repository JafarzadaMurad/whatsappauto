"use client";

import { MessageSquare, Link2, Key, Users, Activity } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import api from "@/lib/api";

export default function DashboardStatsPage() {
    const [stats, setStats] = useState({
        activeInstances: 0,
        totalWebhooks: 0,
        totalApiKeys: 0
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                // In a real production app, we would have a dedicated /stats endpoint.
                // For now, we will query the counts based on the existing modules.
                const [instRes, webRes, keyRes] = await Promise.all([
                    api.get('/instances'),
                    api.get('/webhooks'),
                    api.get('/keys')
                ]);

                setStats({
                    activeInstances: instRes.data.instances?.filter((i: any) => i.status === 'CONNECTED').length || 0,
                    totalWebhooks: webRes.data.webhooks?.length || 0,
                    totalApiKeys: keyRes.data.keys?.length || 0
                });
            } catch (error) {
                console.error("Failed to load stats", error);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, []);

    const cards = [
        { title: "Active WhatsApp Accounts", value: stats.activeInstances, icon: MessageSquare, href: "/dashboard/whatsapp", color: "text-emerald-500", bg: "bg-emerald-500/10" },
        { title: "Active Webhooks", value: stats.totalWebhooks, icon: Link2, href: "/dashboard/webhooks", color: "text-blue-500", bg: "bg-blue-500/10" },
        { title: "API Keys", value: stats.totalApiKeys, icon: Key, href: "/dashboard/api-keys", color: "text-amber-500", bg: "bg-amber-500/10" }
    ];

    return (
        <div className="max-w-6xl mx-auto space-y-8">
            <div>
                <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
                <p className="text-muted-foreground mt-1">Platform overview and general statistics</p>
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
                                {loading ? (
                                    <div className="h-8 w-16 bg-secondary animate-pulse rounded-md"></div>
                                ) : (
                                    <span className="text-3xl font-bold text-foreground group-hover:text-primary transition-colors">{obj.value}</span>
                                )}
                            </div>
                        </Link>
                    )
                })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-card border border-border p-6 rounded-2xl shadow-sm flex flex-col items-center justify-center min-h-[300px] text-center">
                    <Activity className="w-12 h-12 text-muted-foreground/30 mb-4" />
                    <h3 className="font-semibold text-lg">Message Analytics</h3>
                    <p className="text-sm text-muted-foreground mt-2 max-w-sm">Charts and delivery statistics will be available here soon.</p>
                </div>

                <div className="bg-card border border-border p-6 rounded-2xl shadow-sm flex flex-col items-center justify-center min-h-[300px] text-center">
                    <Users className="w-12 h-12 text-muted-foreground/30 mb-4" />
                    <h3 className="font-semibold text-lg">Connected Accounts</h3>
                    <p className="text-sm text-muted-foreground mt-2 max-w-sm">Total users synced via WhatsApp instances will appear here.</p>
                </div>
            </div>
        </div>
    );
}

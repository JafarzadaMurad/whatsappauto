"use client";

import { useEffect, useState, use } from "react";
import { ArrowLeft, Send, Loader2, Play, Pause, Clock, CheckCircle, AlertCircle, MessageSquare, XCircle } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";

const recipientStatusConfig: Record<string, { color: string; icon: any }> = {
    PENDING: { color: 'text-yellow-400', icon: Clock },
    SENDING: { color: 'text-blue-400', icon: Loader2 },
    SENT: { color: 'text-emerald-400', icon: CheckCircle },
    FAILED: { color: 'text-red-400', icon: XCircle },
    REPLIED: { color: 'text-purple-400', icon: MessageSquare },
};

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const [campaign, setCampaign] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        try {
            const res = await api.get(`/campaigns/${id}`);
            if (res.data.success) setCampaign(res.data.campaign);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    useEffect(() => { load(); }, [id]);

    // Auto-refresh while running
    useEffect(() => {
        if (campaign?.status !== 'RUNNING') return;
        const interval = setInterval(load, 5000);
        return () => clearInterval(interval);
    }, [campaign?.status]);

    const handlePause = async () => {
        await api.post(`/campaigns/${id}/pause`);
        load();
    };

    const handleResume = async () => {
        await api.post(`/campaigns/${id}/resume`);
        load();
    };

    if (loading) return (
        <div className="flex justify-center items-center h-screen">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
    );
    if (!campaign) return <div>Campaign not found</div>;

    const counts = {
        total: campaign.recipients?.length || 0,
        sent: campaign.recipients?.filter((r: any) => r.status === 'SENT').length || 0,
        replied: campaign.recipients?.filter((r: any) => r.status === 'REPLIED').length || 0,
        pending: campaign.recipients?.filter((r: any) => r.status === 'PENDING' || r.status === 'SENDING').length || 0,
        failed: campaign.recipients?.filter((r: any) => r.status === 'FAILED').length || 0,
    };

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <Link href="/dashboard/campaigns" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to Campaigns
            </Link>

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-primary/10 text-primary rounded-xl"><Send className="w-7 h-7" /></div>
                    <div>
                        <h1 className="text-2xl font-bold">{campaign.name}</h1>
                        <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                            <span>{campaign.agent?.name}</span> &bull; <span>{campaign.instance?.name}</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <span className={`text-sm font-semibold px-3 py-1.5 rounded-full border ${campaign.status === 'RUNNING' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : campaign.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : campaign.status === 'PAUSED' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : 'bg-secondary text-muted-foreground border-border'}`}>
                        {campaign.status}
                    </span>
                    {campaign.status === 'RUNNING' && (
                        <button onClick={handlePause} className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-xl text-sm font-medium transition-colors">
                            <Pause className="w-4 h-4" /> Pause
                        </button>
                    )}
                    {campaign.status === 'PAUSED' && (
                        <button onClick={handleResume} className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-medium transition-colors">
                            <Play className="w-4 h-4" /> Resume
                        </button>
                    )}
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-card border border-border rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold">{counts.total}</div>
                    <div className="text-xs text-muted-foreground">Total</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-emerald-400">{counts.sent}</div>
                    <div className="text-xs text-muted-foreground">Sent</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-purple-400">{counts.replied}</div>
                    <div className="text-xs text-muted-foreground">Replied</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-yellow-400">{counts.pending}</div>
                    <div className="text-xs text-muted-foreground">Pending</div>
                </div>
                <div className="bg-card border border-border rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-red-400">{counts.failed}</div>
                    <div className="text-xs text-muted-foreground">Failed</div>
                </div>
            </div>

            {/* Recipients Table */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-border">
                    <h3 className="font-semibold">Recipients</h3>
                </div>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border text-muted-foreground">
                            <th className="text-left p-3 font-medium">Phone</th>
                            <th className="text-left p-3 font-medium">Status</th>
                            <th className="text-left p-3 font-medium">Sent At</th>
                            <th className="text-left p-3 font-medium">Replied At</th>
                            <th className="text-left p-3 font-medium">Error</th>
                        </tr>
                    </thead>
                    <tbody>
                        {campaign.recipients?.map((r: any) => {
                            const cfg = recipientStatusConfig[r.status] || recipientStatusConfig.PENDING;
                            const StatusIcon = cfg.icon;
                            return (
                                <tr key={r.id} className="border-b border-border/50 hover:bg-secondary/10">
                                    <td className="p-3 font-mono">{r.phone}</td>
                                    <td className="p-3">
                                        <span className={`inline-flex items-center gap-1.5 ${cfg.color}`}>
                                            <StatusIcon className={`w-3.5 h-3.5 ${r.status === 'SENDING' ? 'animate-spin' : ''}`} />
                                            {r.status}
                                        </span>
                                    </td>
                                    <td className="p-3 text-muted-foreground">{r.sentAt ? new Date(r.sentAt).toLocaleString() : '—'}</td>
                                    <td className="p-3 text-muted-foreground">{r.repliedAt ? new Date(r.repliedAt).toLocaleString() : '—'}</td>
                                    <td className="p-3 text-red-400 text-xs">{r.error || ''}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

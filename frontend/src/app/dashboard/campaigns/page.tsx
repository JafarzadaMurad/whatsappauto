"use client";

import { useEffect, useState } from "react";
import { Send, Plus, Loader2, Trash2, X, Play, Pause, CheckCircle, AlertCircle, Clock, MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";

const statusColors: Record<string, string> = {
    PENDING: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    RUNNING: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    PAUSED: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    COMPLETED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    FAILED: 'bg-red-500/10 text-red-400 border-red-500/20',
};

export default function CampaignsPage() {
    const router = useRouter();
    const [campaigns, setCampaigns] = useState<any[]>([]);
    const [agents, setAgents] = useState<any[]>([]);
    const [instances, setInstances] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const [formOpen, setFormOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [name, setName] = useState("");
    const [agentId, setAgentId] = useState("");
    const [instanceId, setInstanceId] = useState("");
    const [phones, setPhones] = useState("");

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        try {
            const [campRes, agentRes, instRes] = await Promise.all([
                api.get('/campaigns'),
                api.get('/agents'),
                api.get('/instances')
            ]);
            if (campRes.data.success) setCampaigns(campRes.data.campaigns);
            if (agentRes.data.success) setAgents(agentRes.data.agents.filter((a: any) => a.isActive !== false));
            if (instRes.data.success) setInstances(instRes.data.instances.filter((i: any) => i.status === 'CONNECTED'));
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    const handleCreate = async () => {
        const phoneNumbers = phones.split(/[\n,]+/).map(p => p.trim()).filter(Boolean);
        if (!name || !agentId || !instanceId || phoneNumbers.length === 0) return alert("Fill all fields");
        setSubmitting(true);
        try {
            await api.post('/campaigns', { name, agentId, instanceId, phoneNumbers });
            setFormOpen(false);
            setName(""); setAgentId(""); setInstanceId(""); setPhones("");
            loadData();
        } catch (err) { console.error(err); }
        finally { setSubmitting(false); }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this campaign?')) return;
        try { await api.delete(`/campaigns/${id}`); loadData(); } catch (err) { console.error(err); }
    };

    const handlePause = async (id: string) => {
        try { await api.post(`/campaigns/${id}/pause`); loadData(); } catch (err) { console.error(err); }
    };

    const handleResume = async (id: string) => {
        try { await api.post(`/campaigns/${id}/resume`); loadData(); } catch (err) { console.error(err); }
    };

    return (
        <div className="max-w-6xl mx-auto space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold">Campaigns</h1>
                    <p className="text-muted-foreground mt-1">Send outbound messages via AI agents</p>
                </div>
                <button onClick={() => setFormOpen(true)}
                    className="bg-primary text-primary-foreground px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 hover:bg-primary/90 transition-all active:scale-[0.98]">
                    <Plus className="w-5 h-5" /> New Campaign
                </button>
            </div>

            {/* Create Modal */}
            <AnimatePresence>
                {formOpen && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                        onClick={e => e.target === e.currentTarget && setFormOpen(false)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="bg-card border border-border rounded-2xl p-6 shadow-2xl w-full max-w-lg">
                            <div className="flex items-center justify-between mb-6">
                                <h2 className="text-xl font-semibold flex items-center gap-2"><Send className="w-5 h-5 text-primary" /> New Campaign</h2>
                                <button onClick={() => setFormOpen(false)} className="p-2 hover:bg-secondary rounded-lg"><X className="w-5 h-5" /></button>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="text-sm font-medium text-muted-foreground">Campaign Name</label>
                                    <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Product Launch"
                                        className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-sm font-medium text-muted-foreground">AI Agent</label>
                                        <select value={agentId} onChange={e => setAgentId(e.target.value)}
                                            className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50">
                                            <option value="" disabled>Select agent</option>
                                            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-muted-foreground">WhatsApp Instance</label>
                                        <select value={instanceId} onChange={e => setInstanceId(e.target.value)}
                                            className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50">
                                            <option value="" disabled>Select instance</option>
                                            {instances.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-sm font-medium text-muted-foreground">Phone Numbers (one per line or comma-separated)</label>
                                    <textarea value={phones} onChange={e => setPhones(e.target.value)} rows={5}
                                        placeholder={"994551234567\n994701234567\n994771234567"}
                                        className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none text-sm font-mono" />
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {phones.split(/[\n,]+/).filter(p => p.trim()).length} number(s) &bull; Messages will be sent 10-15s apart
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-6 mt-4 border-t border-border/50">
                                <button onClick={() => setFormOpen(false)} className="px-6 py-2.5 font-medium text-muted-foreground hover:bg-secondary rounded-xl">Cancel</button>
                                <button onClick={handleCreate} disabled={submitting}
                                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-6 py-2.5 flex items-center gap-2 disabled:opacity-70">
                                    {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Launch Campaign'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Campaign List */}
            {loading ? (
                <div className="flex justify-center items-center h-48 border border-border border-dashed rounded-2xl">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
            ) : campaigns.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 border border-border border-dashed rounded-2xl bg-card/50 text-center">
                    <Send className="w-12 h-12 text-muted-foreground mb-3 opacity-50" />
                    <h3 className="text-lg font-medium">No Campaigns</h3>
                    <p className="text-muted-foreground text-sm mt-1">Create your first outbound campaign</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {campaigns.map(c => (
                        <div key={c.id} className="bg-card border border-border rounded-2xl p-5 hover:border-primary/30 transition-colors cursor-pointer"
                            onClick={() => router.push(`/dashboard/campaigns/${c.id}`)}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="p-2.5 bg-primary/10 text-primary rounded-xl"><Send className="w-5 h-5" /></div>
                                    <div>
                                        <h3 className="font-bold text-lg">{c.name}</h3>
                                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                            <span>{c.agent?.name}</span>
                                            <span>&bull;</span>
                                            <span>{c.instance?.name}</span>
                                            <span>&bull;</span>
                                            <span>{c._count?.recipients || 0} recipients</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    {/* Status counts */}
                                    <div className="flex items-center gap-2 text-xs">
                                        {c.statusCounts?.SENT > 0 && <span className="text-emerald-400">{c.statusCounts.SENT} sent</span>}
                                        {c.statusCounts?.REPLIED > 0 && <span className="text-purple-400">{c.statusCounts.REPLIED} replied</span>}
                                        {c.statusCounts?.PENDING > 0 && <span className="text-yellow-400">{c.statusCounts.PENDING} pending</span>}
                                        {c.statusCounts?.FAILED > 0 && <span className="text-red-400">{c.statusCounts.FAILED} failed</span>}
                                    </div>

                                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${statusColors[c.status] || ''}`}>
                                        {c.status}
                                    </span>

                                    {c.status === 'RUNNING' && (
                                        <button onClick={e => { e.stopPropagation(); handlePause(c.id); }} className="p-2 hover:bg-secondary rounded-lg text-muted-foreground" title="Pause">
                                            <Pause className="w-4 h-4" />
                                        </button>
                                    )}
                                    {c.status === 'PAUSED' && (
                                        <button onClick={e => { e.stopPropagation(); handleResume(c.id); }} className="p-2 hover:bg-secondary rounded-lg text-muted-foreground" title="Resume">
                                            <Play className="w-4 h-4" />
                                        </button>
                                    )}
                                    <button onClick={e => { e.stopPropagation(); handleDelete(c.id); }} className="p-2 hover:bg-destructive/10 rounded-lg text-destructive" title="Delete">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

"use client";

import { useEffect, useState } from "react";
import { Camera, Plus, Loader2, Trash2, Bot, Power, ExternalLink } from "lucide-react";
import api from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";

export default function InstagramPage() {
    const [accounts, setAccounts] = useState<any[]>([]);
    const [agents, setAgents] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        try {
            const [accRes, agentRes] = await Promise.all([
                api.get('/instagram/accounts'),
                api.get('/agents')
            ]);
            if (accRes.data.success) setAccounts(accRes.data.accounts);
            if (agentRes.data.success) setAgents(agentRes.data.agents);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    const handleConnect = async () => {
        setConnecting(true);
        try {
            const res = await api.get('/instagram/auth-url');
            if (res.data.success && res.data.url) {
                window.location.href = res.data.url;
            }
        } catch (err) { console.error(err); setConnecting(false); }
    };

    const handleLinkAgent = async (accountId: string, agentId: string) => {
        try {
            await api.put(`/instagram/accounts/${accountId}`, { agentId: agentId || null });
            loadData();
        } catch (err) { console.error(err); }
    };

    const handleToggle = async (accountId: string, isActive: boolean) => {
        try {
            await api.put(`/instagram/accounts/${accountId}`, { isActive: !isActive });
            loadData();
        } catch (err) { console.error(err); }
    };

    const handleDelete = async (accountId: string) => {
        if (!confirm('Disconnect this Instagram account?')) return;
        try {
            await api.delete(`/instagram/accounts/${accountId}`);
            loadData();
        } catch (err) { console.error(err); }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold">Instagram</h1>
                    <p className="text-muted-foreground mt-1">Connect Instagram accounts for AI-powered DM and comment replies</p>
                </div>
                <button onClick={handleConnect} disabled={connecting}
                    className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-70">
                    {connecting ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Camera className="w-5 h-5" /> Connect Instagram</>}
                </button>
            </div>

            {loading ? (
                <div className="flex justify-center items-center h-48 border border-border border-dashed rounded-2xl">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
            ) : accounts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 border border-border border-dashed rounded-2xl bg-card/50 text-center">
                    <Camera className="w-12 h-12 text-muted-foreground mb-3 opacity-50" />
                    <h3 className="text-lg font-medium">No Instagram Accounts</h3>
                    <p className="text-muted-foreground text-sm mt-1">Connect your Instagram to enable AI responses</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {accounts.map(acc => (
                        <motion.div key={acc.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                            className="bg-card border border-border rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <div className={`p-3 rounded-xl ${acc.isActive ? 'bg-gradient-to-r from-purple-500/10 to-pink-500/10 text-pink-500' : 'bg-secondary text-muted-foreground'}`}>
                                    <Camera className="w-6 h-6" />
                                </div>
                                <div>
                                    <h3 className="font-semibold">@{acc.igUsername}</h3>
                                    <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                                        <span className={`w-2 h-2 rounded-full ${acc.isActive ? 'bg-emerald-500' : 'bg-destructive'}`} />
                                        {acc.isActive ? 'Active' : 'Inactive'}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2 bg-secondary/30 border border-border px-3 py-1.5 rounded-xl">
                                    <Bot className="w-4 h-4 text-primary" />
                                    <select value={acc.agentId || ""} onChange={e => handleLinkAgent(acc.id, e.target.value)}
                                        className="bg-transparent text-sm font-medium focus:outline-none w-32 truncate">
                                        <option value="">No AI Agent</option>
                                        {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                    </select>
                                </div>

                                <button onClick={() => handleToggle(acc.id, acc.isActive)}
                                    className={`p-2 rounded-lg transition-colors ${acc.isActive ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-muted-foreground hover:bg-secondary'}`}
                                    title={acc.isActive ? 'Deactivate' : 'Activate'}>
                                    <Power className="w-4 h-4" />
                                </button>

                                <button onClick={() => handleDelete(acc.id)}
                                    className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors" title="Disconnect">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </motion.div>
                    ))}
                </div>
            )}
        </div>
    );
}

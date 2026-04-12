"use client";

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Router as RouterIcon, Trash2, Smartphone, Loader2, QrCode, Bot, X } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";
import io, { Socket } from "socket.io-client";

interface Instance {
    id: string;
    name: string;
    status: string;
    createdAt: string;
    agentId?: string | null;
    agent?: any;
}

export default function WhatsAppPage() {
    const [instances, setInstances] = useState<Instance[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newInstanceName, setNewInstanceName] = useState("");
    const [activeQr, setActiveQr] = useState<{ id: string; qrUrl: string } | null>(null);
    const [agents, setAgents] = useState<any[]>([]);
    const [updatingAgent, setUpdatingAgent] = useState<string | null>(null);
    const socketRef = useRef<Socket | null>(null);

    const fetchData = async () => {
        try {
            const [instRes, agentsRes] = await Promise.all([
                api.get('/instances'),
                api.get('/agents')
            ]);
            if (instRes.data.success) setInstances(instRes.data.instances);
            if (agentsRes.data.success) setAgents(agentsRes.data.agents);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    useEffect(() => {
        fetchData();

        const socket = io(process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:2992');
        socketRef.current = socket;

        return () => { socket.disconnect(); };
    }, []);

    // Attach socket listeners per instance
    useEffect(() => {
        const socket = socketRef.current;
        if (!socket) return;

        const qrHandlers: Record<string, (qr: string) => void> = {};
        const statusHandlers: Record<string, (status: string) => void> = {};

        instances.forEach(inst => {
            qrHandlers[inst.id] = (qrData: string) => {
                setActiveQr({ id: inst.id, qrUrl: qrData });
            };
            statusHandlers[inst.id] = (status: string) => {
                setInstances(prev => prev.map(i => i.id === inst.id ? { ...i, status } : i));
                if (status === 'CONNECTED') {
                    setActiveQr(prev => prev?.id === inst.id ? null : prev);
                }
            };

            socket.on(`qr-${inst.id}`, qrHandlers[inst.id]);
            socket.on(`status-${inst.id}`, statusHandlers[inst.id]);
        });

        return () => {
            instances.forEach(inst => {
                socket.off(`qr-${inst.id}`, qrHandlers[inst.id]);
                socket.off(`status-${inst.id}`, statusHandlers[inst.id]);
            });
        };
    }, [instances.map(i => i.id).join(',')]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newInstanceName) return;
        setCreating(true);
        try {
            const res = await api.post('/instances', { name: newInstanceName });
            if (res.data.success) {
                setInstances(prev => [res.data.instance, ...prev]);
                setNewInstanceName("");
            }
        } catch (err) { console.error(err); }
        finally { setCreating(false); }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this instance?')) return;
        try {
            await api.delete(`/instances/${id}`);
            setInstances(prev => prev.filter(i => i.id !== id));
            if (activeQr?.id === id) setActiveQr(null);
        } catch (err) { console.error(err); }
    };

    const handleLink = async (id: string) => {
        try {
            await api.post(`/instances/${id}/restart`);
            // QR will arrive via socket
        } catch (err) { console.error(err); }
    };

    const handleLinkAgent = async (instanceId: string, agentId: string) => {
        setUpdatingAgent(instanceId);
        try {
            await api.put(`/instances/${instanceId}`, { agentId: agentId || null });
            setInstances(prev => prev.map(i => i.id === instanceId ? { ...i, agentId: agentId || null, agent: agents.find(a => a.id === agentId) } : i));
        } catch (err) { console.error(err); }
        finally { setUpdatingAgent(null); }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-8">
            <div>
                <h1 className="text-3xl font-bold">WhatsApp Instances</h1>
                <p className="text-muted-foreground mt-1">Manage your connected WhatsApp numbers</p>
            </div>

            {/* QR Code Modal */}
            <AnimatePresence>
                {activeQr && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                        onClick={() => setActiveQr(null)}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="bg-card border border-border rounded-2xl p-8 shadow-2xl flex flex-col items-center"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between w-full mb-6">
                                <h3 className="text-lg font-semibold">Scan QR Code</h3>
                                <button onClick={() => setActiveQr(null)} className="p-1.5 hover:bg-secondary rounded-lg">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <p className="text-sm text-muted-foreground mb-4">Open WhatsApp on your phone &gt; Linked Devices &gt; Link a Device</p>
                            <div className="bg-white p-4 rounded-2xl shadow-xl">
                                <img src={activeQr.qrUrl} alt="QR Code" className="w-56 h-56 object-contain" />
                            </div>
                            <p className="text-xs text-muted-foreground mt-4">QR code refreshes automatically</p>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="grid lg:grid-cols-3 gap-8">
                {/* Create Form */}
                <div className="lg:col-span-1">
                    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm sticky top-8">
                        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                            <Plus className="w-5 h-5 text-primary" /> New Instance
                        </h2>
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div>
                                <label className="text-sm font-medium text-muted-foreground">Instance Name</label>
                                <input type="text" required placeholder="e.g. Sales Team" value={newInstanceName}
                                    onChange={e => setNewInstanceName(e.target.value)}
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50" />
                            </div>
                            <button type="submit" disabled={creating}
                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-4 py-2.5 flex items-center justify-center gap-2 disabled:opacity-70">
                                {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Create Instance'}
                            </button>
                        </form>
                    </div>
                </div>

                {/* Instance List */}
                <div className="lg:col-span-2 space-y-4">
                    {loading ? (
                        <div className="flex items-center justify-center h-48 border border-border border-dashed rounded-2xl">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : instances.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-48 border border-border border-dashed rounded-2xl bg-card/50 text-center">
                            <Smartphone className="w-12 h-12 text-muted-foreground mb-3 opacity-50" />
                            <h3 className="text-lg font-medium">No instances</h3>
                            <p className="text-muted-foreground text-sm mt-1">Create an instance and scan QR to link WhatsApp</p>
                        </div>
                    ) : (
                        instances.map(inst => (
                            <motion.div key={inst.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                className="bg-card border border-border rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <div className={`p-3 rounded-xl ${inst.status === 'CONNECTED' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-secondary text-muted-foreground'}`}>
                                        <RouterIcon className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold">{inst.name}</h3>
                                        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                                            <span className="flex items-center gap-1.5">
                                                <span className={`w-2 h-2 rounded-full ${inst.status === 'CONNECTED' ? 'bg-emerald-500' : inst.status === 'CONNECTING' ? 'bg-amber-500 animate-pulse' : 'bg-destructive'}`} />
                                                {inst.status}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    {/* Agent selector */}
                                    <div className="flex items-center gap-2 bg-secondary/30 border border-border px-3 py-1.5 rounded-xl">
                                        {updatingAgent === inst.id ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : <Bot className="w-4 h-4 text-primary" />}
                                        <select value={inst.agentId || ""} disabled={updatingAgent === inst.id}
                                            onChange={e => handleLinkAgent(inst.id, e.target.value)}
                                            className="bg-transparent text-sm font-medium focus:outline-none w-32 truncate">
                                            <option value="">No AI Agent</option>
                                            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                        </select>
                                    </div>

                                    {inst.status === 'CONNECTED' ? (
                                        <Link href={`/dashboard/instances/${inst.id}`}
                                            className="px-3 py-1.5 text-primary hover:bg-primary/10 rounded-xl text-sm font-medium transition-colors">
                                            Chat
                                        </Link>
                                    ) : (
                                        <button onClick={() => handleLink(inst.id)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-primary hover:bg-primary/10 rounded-xl text-sm font-medium transition-colors">
                                            <QrCode className="w-4 h-4" /> Link
                                        </button>
                                    )}

                                    <button onClick={() => handleDelete(inst.id)}
                                        className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </motion.div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

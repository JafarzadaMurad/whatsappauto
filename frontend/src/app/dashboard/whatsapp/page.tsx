"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Router as RouterIcon, Trash2, Smartphone, Loader2, QrCode } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";
import io from "socket.io-client";
import Image from "next/image";

interface Instance {
    id: string;
    name: string;
    status: string;
    createdAt: string;
}

export default function DashboardPage() {
    const [instances, setInstances] = useState<Instance[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newInstanceName, setNewInstanceName] = useState("");
    const [activeQr, setActiveQr] = useState<{ id: string, qrUrl: string } | null>(null);

    const fetchInstances = async () => {
        try {
            const res = await api.get('/instances');
            if (res.data.success) {
                setInstances(res.data.instances);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchInstances();

        // Start Socket.IO for QR and Status updates
        const socket = io(process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:2992');

        // We would ideally listen dynamically based on instances
        // but the backend sends 'qr-{id}' and 'status-{id}' events
        // We'll attach listeners when instances load
        socket.on('connect', () => {
            console.log('Socket connected');
        });

        const handleQr = (id: string, qrData: string) => {
            setActiveQr({ id, qrUrl: qrData });
        };

        const handleStatus = (id: string, status: string) => {
            setInstances(prev => prev.map(inst => inst.id === id ? { ...inst, status } : inst));
            if (status === 'CONNECTED') {
                setActiveQr(null); // hide QR once connected
            }
        };

        return () => {
            socket.disconnect();
        };
    }, []);

    // Update socket listeners when instances change
    useEffect(() => {
        const socket = io(process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:2992');
        instances.forEach(inst => {
            socket.on(`qr-${inst.id}`, (qrData) => setActiveQr({ id: inst.id, qrUrl: qrData }));
            socket.on(`status-${inst.id}`, (status) => {
                setInstances(prev => prev.map(i => i.id === inst.id ? { ...i, status } : i));
                if (status === 'CONNECTED' && activeQr?.id === inst.id) setActiveQr(null);
            });
        });

        return () => {
            instances.forEach(inst => {
                socket.off(`qr-${inst.id}`);
                socket.off(`status-${inst.id}`);
            });
            socket.disconnect();
        }
    }, [instances]);


    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newInstanceName) return;
        setCreating(true);
        try {
            const res = await api.post('/instances', { name: newInstanceName });
            if (res.data.success) {
                setInstances([res.data.instance, ...instances]);
                setNewInstanceName("");
            }
        } catch (err) {
            console.error(err);
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this instance?')) return;
        try {
            await api.delete(`/instances/${id}`);
            setInstances(instances.filter(i => i.id !== id));
            if (activeQr?.id === id) setActiveQr(null);
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-8">
            <div>
                <h1 className="text-3xl font-bold text-foreground">WhatsApp Instances</h1>
                <p className="text-muted-foreground mt-1">Manage your connected WhatsApp numbers</p>
            </div>

            <div className="grid lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1">
                    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm sticky top-8">
                        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                            <Plus className="w-5 h-5 text-primary" />
                            New Instance
                        </h2>
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div>
                                <label className="text-sm font-medium text-muted-foreground">Instance Name</label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. Sales Team"
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                                    value={newInstanceName}
                                    onChange={(e) => setNewInstanceName(e.target.value)}
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={creating}
                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-4 py-2.5 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-70"
                            >
                                {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Create Instance'}
                            </button>
                        </form>

                        <AnimatePresence>
                            {activeQr && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="mt-8 pt-6 border-t border-border flex flex-col items-center"
                                >
                                    <div className="text-center mb-4">
                                        <h3 className="font-semibold text-foreground">Scan QR Code</h3>
                                        <p className="text-sm text-muted-foreground">Open WhatsApp on your phone to link</p>
                                    </div>
                                    <div className="bg-white p-4 rounded-2xl shadow-xl w-48 h-48 relative flex items-center justify-center">
                                        {/* QR Code image received from base64 */}
                                        <img src={activeQr.qrUrl} alt="QR Code" className="w-full h-full object-contain" />
                                    </div>
                                    <button onClick={() => setActiveQr(null)} className="mt-4 text-sm text-muted-foreground hover:text-foreground">
                                        Cancel
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                <div className="lg:col-span-2 space-y-4">
                    {loading ? (
                        <div className="flex items-center justify-center h-48 border border-border border-dashed rounded-2xl">
                            <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
                        </div>
                    ) : instances.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-48 border border-border border-dashed rounded-2xl bg-card/50 text-center px-4">
                            <Smartphone className="w-12 h-12 text-muted-foreground mb-3 opacity-50" />
                            <h3 className="text-lg font-medium text-foreground">No instances found</h3>
                            <p className="text-muted-foreground text-sm max-w-sm mt-1">Create an instance to link your WhatsApp account and start automating.</p>
                        </div>
                    ) : (
                        <div className="grid gap-4">
                            {instances.map(inst => (
                                <motion.div
                                    key={inst.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="bg-card border border-border rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className={`p-3 rounded-xl ${inst.status === 'CONNECTED' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-secondary text-muted-foreground'}`}>
                                            <RouterIcon className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-foreground flex items-center gap-2">
                                                {inst.name}
                                            </h3>
                                            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                                                <span className="flex items-center gap-1.5">
                                                    <span className={`w-2 h-2 rounded-full ${inst.status === 'CONNECTED' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                                                        inst.status === 'CONNECTING' ? 'bg-amber-500 animate-pulse' :
                                                            'bg-destructive'
                                                        }`} />
                                                    {inst.status}
                                                </span>
                                                <span>•</span>
                                                <span className="font-mono text-xs opacity-70">ID: {inst.id.split('-')[0]}...</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        {inst.status === 'CONNECTED' && (
                                            <Link
                                                href={`/dashboard/whatsapp/${inst.id}`}
                                                className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
                                                title="Open Chat"
                                            >
                                                Chat
                                            </Link>
                                        )}
                                        {inst.status === 'DISCONNECTED' && (
                                            <button
                                                onClick={() => {
                                                    api.post(`/instances/${inst.id}/restart`).catch(e => console.error(e));
                                                    // Note: we need to add restart endpoint in backend or just recreate, but clicking triggers QR for now if backend reconnect logic is smart
                                                }}
                                                className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors flex items-center gap-2 text-sm"
                                            >
                                                <QrCode className="w-4 h-4" /> Link
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleDelete(inst.id)}
                                            className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                                            title="Delete Instance"
                                        >
                                            <Trash2 className="w-5 h-5" />
                                        </button>
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

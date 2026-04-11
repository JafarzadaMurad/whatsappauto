"use client";

import { useEffect, useState } from "react";
import { Link2, Trash2, Plus, Loader2 } from "lucide-react";
import api from "@/lib/api";

export default function WebhooksPage() {
    const [webhooks, setWebhooks] = useState<any[]>([]);
    const [instances, setInstances] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [url, setUrl] = useState("");
    const [instanceId, setInstanceId] = useState("");
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        Promise.all([
            api.get('/webhooks').then(res => setWebhooks(res.data.webhooks)),
            api.get('/instances').then(res => setInstances(res.data.instances))
        ]).finally(() => setLoading(false));
    }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreating(true);
        try {
            const res = await api.post('/webhooks', {
                url,
                events: ['message.new'],
                instanceId: instanceId || null
            });
            // Let's refetch or just manually attach the instance name if possible
            // To be accurate, we'll just refetch webhooks
            const refreshed = await api.get('/webhooks');
            setWebhooks(refreshed.data.webhooks);
            setUrl("");
            setInstanceId("");
        } catch (err) {
            console.error(err);
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await api.delete(`/webhooks/${id}`);
            setWebhooks(webhooks.filter(w => w.id !== id));
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div>
                <h1 className="text-3xl font-bold text-foreground">Webhooks</h1>
                <p className="text-muted-foreground mt-1">Receive real-time events via HTTP POST</p>
            </div>

            <div className="bg-card border border-border p-6 rounded-2xl shadow-sm">
                <h2 className="text-lg font-semibold mb-4">Add Endpoint</h2>
                <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-4">
                    <input
                        type="url"
                        placeholder="https://your-server.com/webhook"
                        required
                        className="flex-1 bg-secondary border border-border rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary/50 text-sm"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                    />
                    <select
                        className="bg-secondary border border-border rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary/50 text-sm min-w-[200px]"
                        value={instanceId}
                        onChange={(e) => setInstanceId(e.target.value)}
                    >
                        <option value="">All Instances</option>
                        {instances.map(inst => (
                            <option key={inst.id} value={inst.id}>{inst.name}</option>
                        ))}
                    </select>
                    <button
                        type="submit"
                        disabled={creating}
                        className="bg-primary text-primary-foreground px-6 py-2.5 rounded-xl font-medium flex items-center gap-2 hover:bg-primary/90 transition-all active:scale-[0.98] disabled:opacity-50"
                    >
                        {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Plus className="w-5 h-5" /> Add</>}
                    </button>
                </form>
            </div>

            <div className="space-y-4">
                {loading ? (
                    <div className="h-32 flex items-center justify-center border border-border border-dashed rounded-2xl"><Loader2 className="animate-spin text-muted-foreground" /></div>
                ) : webhooks.length === 0 ? (
                    <div className="h-32 flex items-center justify-center border border-border border-dashed rounded-2xl text-muted-foreground flex-col">
                        <Link2 className="w-8 h-8 mb-2 opacity-50" />
                        No webhooks configured
                    </div>
                ) : (
                    webhooks.map(w => (
                        <div key={w.id} className="bg-card border border-border p-5 rounded-2xl flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="font-mono text-sm text-foreground bg-secondary px-2 py-1 rounded-md">{w.url}</span>
                                    {w.instance && (
                                        <span className="text-xs font-medium bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded-full border border-emerald-500/20">
                                            {w.instance.name}
                                        </span>
                                    )}
                                    {!w.instance && (
                                        <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-1 rounded-full border border-primary/20">
                                            All Instances
                                        </span>
                                    )}
                                </div>
                                <div className="flex gap-2 mt-2">
                                    {w.events.map((e: string) => (
                                        <span key={e} className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">{e}</span>
                                    ))}
                                </div>
                            </div>
                            <button
                                onClick={() => handleDelete(w.id)}
                                className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                            >
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

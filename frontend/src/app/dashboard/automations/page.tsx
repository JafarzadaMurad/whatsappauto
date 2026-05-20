"use client";

import { useEffect, useState } from "react";
import { Workflow, Loader2, Plus, Trash2, Power } from "lucide-react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";

export default function AutomationsPage() {
    const router = useRouter();
    const [automations, setAutomations] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);

    const load = async () => {
        try {
            const res = await api.get('/automations');
            if (res.data.success) setAutomations(res.data.automations);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    useEffect(() => { load(); }, []);

    const createNew = async () => {
        setCreating(true);
        try {
            const res = await api.post('/automations', { name: 'Untitled Automation', nodes: [], edges: [] });
            if (res.data.success) router.push(`/dashboard/automations/${res.data.automation.id}`);
        } catch (err) { console.error(err); }
        finally { setCreating(false); }
    };

    const remove = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('Delete this automation?')) return;
        try {
            await api.delete(`/automations/${id}`);
            setAutomations(prev => prev.filter(a => a.id !== id));
        } catch (err) { console.error(err); }
    };

    const toggleActive = async (a: any, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await api.put(`/automations/${a.id}`, { name: a.name, isActive: !a.isActive, nodes: a.nodes, edges: a.edges });
            setAutomations(prev => prev.map(x => x.id === a.id ? { ...x, isActive: !x.isActive } : x));
        } catch (err) { console.error(err); }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-96">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
    );

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-xl">
                            <Workflow className="w-6 h-6" />
                        </div>
                        Automations
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">Build visual workflows that react to messages with triggers and actions.</p>
                </div>
                <button onClick={createNew} disabled={creating}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-4 py-2.5 flex items-center gap-2 transition-all disabled:opacity-70">
                    {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                    New Automation
                </button>
            </div>

            {automations.length === 0 ? (
                <div className="bg-card border border-dashed border-border rounded-2xl p-12 text-center">
                    <Workflow className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">No automations yet. Create one to get started.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {automations.map(a => (
                        <div key={a.id}
                            onClick={() => router.push(`/dashboard/automations/${a.id}`)}
                            className="bg-card border border-border rounded-2xl p-5 cursor-pointer hover:border-primary/40 transition-colors">
                            <div className="flex items-start justify-between">
                                <div className="min-w-0">
                                    <h3 className="font-semibold truncate">{a.name}</h3>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {(a.nodes?.length || 0)} nodes &bull; updated {new Date(a.updatedAt).toLocaleDateString()}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                    <button onClick={(e) => toggleActive(a, e)}
                                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-colors ${a.isActive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-secondary/50 text-muted-foreground border-border'}`}>
                                        <Power className="w-3 h-3" />
                                        {a.isActive ? 'Active' : 'Inactive'}
                                    </button>
                                    <button onClick={(e) => remove(a.id, e)}
                                        className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
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

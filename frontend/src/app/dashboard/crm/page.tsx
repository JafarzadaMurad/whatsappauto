"use client";

import { useEffect, useState } from "react";
import { Users, Search, Filter, Phone, Tag, Loader2, ArrowRight } from "lucide-react";
import api from "@/lib/api";

interface Client {
    id: string;
    phone: string;
    name: string | null;
    status: string;
    tags: string[];
    customFields: Record<string, any> | null;
    createdAt: string;
    updatedAt: string;
}

export default function CrmPage() {
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");

    useEffect(() => {
        const fetchClients = async () => {
            try {
                const res = await api.get('/clients');
                if (res.data.success) {
                    setClients(res.data.clients);
                }
            } catch (err) {
                console.error("Failed to load clients", err);
            } finally {
                setLoading(false);
            }
        };

        fetchClients();
    }, []);

    const getStatusColor = (status: string) => {
        switch (status.toUpperCase()) {
            case 'NEW': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
            case 'LEAD': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
            case 'PURCHASED': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
            case 'SPAM': return 'bg-destructive/10 text-destructive border-destructive/20';
            default: return 'bg-secondary text-muted-foreground border-border';
        }
    };

    const filteredClients = clients.filter(c =>
        (c.name?.toLowerCase() || '').includes(search.toLowerCase()) ||
        c.phone.includes(search)
    );

    return (
        <div className="max-w-7xl mx-auto space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-foreground">CRM Clients</h1>
                    <p className="text-muted-foreground mt-1">Manage all your contacts and AI-assigned lead statuses.</p>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search by name or phone..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground"
                    />
                </div>
                <button className="bg-card border border-border px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors flex items-center gap-2">
                    <Filter className="w-4 h-4" /> Filter Status
                </button>
            </div>

            <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-secondary/50 border-b border-border text-sm">
                                <th className="px-6 py-4 font-semibold text-muted-foreground">Contact</th>
                                <th className="px-6 py-4 font-semibold text-muted-foreground">Status</th>
                                <th className="px-6 py-4 font-semibold text-muted-foreground">Auto Tags</th>
                                <th className="px-6 py-4 font-semibold text-muted-foreground">Last Activity</th>
                                <th className="px-6 py-4 font-semibold text-right text-muted-foreground w-20">Chat</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center">
                                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
                                    </td>
                                </tr>
                            ) : filteredClients.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center">
                                        <div className="flex flex-col items-center justify-center text-muted-foreground">
                                            <Users className="w-12 h-12 mb-3 opacity-50" />
                                            <p className="font-medium">No clients found</p>
                                            <p className="text-sm mt-1">When someone sends a message to your WhatsApp, they will appear here.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredClients.map(client => (
                                    <tr key={client.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors last:border-0">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                                                    {client.name ? client.name.charAt(0).toUpperCase() : <Phone className="w-4 h-4" />}
                                                </div>
                                                <div>
                                                    <div className="font-medium text-foreground">{client.name || 'Unknown Contact'}</div>
                                                    <div className="text-sm text-muted-foreground font-mono">{client.phone.split('@')[0]}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(client.status)}`}>
                                                {client.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-wrap gap-2">
                                                {client.tags.length > 0 ? client.tags.map((tag, i) => (
                                                    <span key={i} className="bg-secondary text-secondary-foreground text-xs px-2 py-1 rounded-md border border-border flex items-center gap-1">
                                                        <Tag className="w-3 h-3" /> {tag}
                                                    </span>
                                                )) : (
                                                    <span className="text-muted-foreground text-xs italic">No tags</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-muted-foreground">
                                            {new Date(client.updatedAt).toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button className="text-primary hover:text-primary/80 transition-colors p-2 hover:bg-primary/10 rounded-xl" title="Open Chat">
                                                <ArrowRight className="w-5 h-5" />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

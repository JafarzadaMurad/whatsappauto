"use client";

import { useEffect, useState } from "react";
import { Key, Trash2, Plus, Copy, Check, Loader2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import api from "@/lib/api";

export default function ApiKeysPage() {
    const [keys, setKeys] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newKeyName, setNewKeyName] = useState("");

    useEffect(() => {
        fetchKeys();
    }, []);

    const fetchKeys = async () => {
        try {
            const res = await api.get('/keys');
            if (res.data.success) {
                setKeys(res.data.keys);
            }
        } catch (error) {
            console.error("Failed to fetch keys", error);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateKey = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!newKeyName.trim()) return;

        setCreating(true);
        try {
            const res = await api.post('/keys', { name: newKeyName });
            if (res.data.success) {
                setKeys([res.data.apiKey, ...keys]);
                setIsModalOpen(false);
                setNewKeyName("");
            }
        } catch (error) {
            console.error("Failed to create key", error);
        } finally {
            setCreating(false);
        }
    };

    const handleDeleteKey = async (id: string) => {
        if (!confirm('Are you sure you want to revoke this API key? This action is irreversible.')) return;
        try {
            await api.delete(`/keys/${id}`);
            setKeys(keys.filter(k => k.id !== id));
        } catch (error) {
            console.error("Failed to delete key", error);
        }
    };

    const handleCopy = (key: string) => {
        navigator.clipboard.writeText(key);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div>
                <h1 className="text-3xl font-bold text-foreground">API Keys</h1>
                <p className="text-muted-foreground mt-1">Manage keys for external API access</p>
            </div>

            <div className="bg-card border border-border p-6 rounded-2xl shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div>
                        <h2 className="text-lg font-semibold">Secret Keys</h2>
                        <p className="text-sm text-muted-foreground">Do not share your API keys in public repositories.</p>
                    </div>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="bg-primary text-primary-foreground px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 hover:bg-primary/90 transition-all active:scale-[0.98]"
                    >
                        <Plus className="w-5 h-5" />
                        Create new secret key
                    </button>
                </div>

                <div className="space-y-4">
                    {loading ? (
                        <div className="h-24 flex items-center justify-center border border-border rounded-xl"><Loader2 className="animate-spin text-muted-foreground" /></div>
                    ) : keys.length === 0 ? (
                        <div className="h-24 flex items-center justify-center border border-border border-dashed rounded-xl text-muted-foreground">No API keys found</div>
                    ) : (
                        keys.map(k => (
                            <div key={k.id} className="border border-border p-4 rounded-xl flex items-center justify-between hover:bg-secondary/20 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="p-2 bg-secondary rounded-lg">
                                        <Key className="w-5 h-5 text-muted-foreground" />
                                    </div>
                                    <div>
                                        <div className="font-semibold">{k.name}</div>
                                        <div className="text-sm text-muted-foreground mt-1">Created on {new Date(k.createdAt).toLocaleDateString()}</div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4">
                                    <div className="font-mono text-sm bg-secondary px-3 py-1.5 rounded-lg flex items-center gap-3">
                                        <span className="opacity-70 blur-[2px] hover:blur-none transition-all">{k.key.substring(0, 12)}...{k.key.slice(-4)}</span>
                                        <button onClick={() => handleCopy(k.key)} className="text-muted-foreground hover:text-foreground">
                                            {copied === k.key ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                                        </button>
                                    </div>
                                    <button onClick={() => handleDeleteKey(k.id)} className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Create API Key Modal */}
            <AnimatePresence>
                {isModalOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="bg-card border border-border w-full max-w-md rounded-2xl shadow-xl overflow-hidden"
                        >
                            <div className="flex items-center justify-between p-4 border-b border-border">
                                <h3 className="font-semibold text-lg text-foreground">Create API Key</h3>
                                <button onClick={() => setIsModalOpen(false)} className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-secondary transition-colors">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <form onSubmit={handleCreateKey} className="p-4 space-y-4">
                                <div>
                                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Name</label>
                                    <input
                                        type="text"
                                        required
                                        autoFocus
                                        placeholder="e.g. Zapier Integration"
                                        value={newKeyName}
                                        onChange={(e) => setNewKeyName(e.target.value)}
                                        className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                                    />
                                    <p className="text-xs text-muted-foreground mt-2">
                                        Give your key a descriptive name to remember where it is used.
                                    </p>
                                </div>

                                <div className="flex items-center justify-end gap-3 pt-4">
                                    <button
                                        type="button"
                                        onClick={() => setIsModalOpen(false)}
                                        className="px-4 py-2 text-muted-foreground hover:bg-secondary rounded-xl transition-colors font-medium"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={creating || !newKeyName.trim()}
                                        className="bg-primary text-primary-foreground px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 hover:bg-primary/90 transition-all active:scale-[0.98] disabled:opacity-70"
                                    >
                                        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                        {creating ? 'Creating...' : 'Create Key'}
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

"use client";

import { useEffect, useState } from "react";
import { Database, Plus, Table2, Trash2, Edit2, Loader2, ArrowRight } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";

export interface ColumnDef {
    id: string;
    name: string;
    type: 'text' | 'number' | 'boolean' | 'relation';
    relationTableId?: string;
}

export interface CustomTable {
    id: string;
    name: string;
    columns: ColumnDef[];
    createdAt: string;
}

export default function TablesPage() {
    const [tables, setTables] = useState<CustomTable[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);

    // New Table Form
    const [newTableName, setNewTableName] = useState("");
    const [columns, setColumns] = useState<ColumnDef[]>([{ id: 'c1', name: 'Name', type: 'text' }]);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        fetchTables();
    }, []);

    const fetchTables = async () => {
        try {
            const res = await api.get('/tables');
            if (res.data.success) {
                setTables(res.data.tables);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const addColumn = () => {
        setColumns([...columns, { id: `c${Date.now()}`, name: '', type: 'text' }]);
    };

    const handleCreate = async () => {
        if (!newTableName || columns.some(c => !c.name)) return alert("Please fill all fields");
        setSubmitting(true);
        try {
            const res = await api.post('/tables', { name: newTableName, columns });
            if (res.data.success) {
                setTables([res.data.table, ...tables]);
                setIsCreating(false);
                setNewTableName("");
                setColumns([{ id: 'c1', name: 'Name', type: 'text' }]);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this table and all its rows?')) return;
        try {
            await api.delete(`/tables/${id}`);
            setTables(tables.filter(t => t.id !== id));
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className="max-w-6xl mx-auto space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-foreground">Data Tables</h1>
                    <p className="text-muted-foreground mt-1">Create dynamic tables to store data for your AI agents</p>
                </div>
                <button
                    onClick={() => setIsCreating(true)}
                    className="bg-primary text-primary-foreground px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 hover:bg-primary/90 transition-all active:scale-[0.98]"
                >
                    <Plus className="w-5 h-5" />
                    Create Table
                </button>
            </div>

            <AnimatePresence>
                {isCreating && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -10 }}
                        className="bg-card border border-border rounded-2xl p-6 shadow-sm mb-8"
                    >
                        <h2 className="text-xl font-semibold mb-4">New Dynamic Table</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm font-medium text-muted-foreground">Table Name</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Products, Services"
                                    className="mt-1 w-full max-w-md bg-secondary/50 border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                                    value={newTableName}
                                    onChange={(e) => setNewTableName(e.target.value)}
                                />
                            </div>

                            <div className="space-y-3 pt-2">
                                <label className="text-sm font-medium text-muted-foreground">Columns / Fields</label>
                                {columns.map((col, idx) => (
                                    <div key={col.id} className="flex flex-wrap sm:flex-nowrap items-center gap-3">
                                        <input
                                            type="text"
                                            placeholder="Column Name"
                                            value={col.name}
                                            onChange={e => setColumns(columns.map(c => c.id === col.id ? { ...c, name: e.target.value } : c))}
                                            className="flex-1 bg-secondary/50 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                                        />
                                        <select
                                            value={col.type}
                                            onChange={e => setColumns(columns.map(c => c.id === col.id ? { ...c, type: e.target.value as any } : c))}
                                            className="bg-secondary/50 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 w-32"
                                        >
                                            <option value="text">Text</option>
                                            <option value="number">Number</option>
                                            <option value="boolean">Yes/No</option>
                                            <option value="relation">Relation</option>
                                        </select>

                                        {col.type === 'relation' && (
                                            <select
                                                value={col.relationTableId || ''}
                                                onChange={e => setColumns(columns.map(c => c.id === col.id ? { ...c, relationTableId: e.target.value } : c))}
                                                className="bg-secondary/50 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 flex-1"
                                                required
                                            >
                                                <option value="" disabled>Select Target Table</option>
                                                {tables.map(t => (
                                                    <option key={t.id} value={t.id}>{t.name}</option>
                                                ))}
                                            </select>
                                        )}

                                        {idx > 0 && (
                                            <button onClick={() => setColumns(columns.filter(c => c.id !== col.id))} className="p-2 text-destructive hover:bg-destructive/10 rounded-lg">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                                <button type="button" onClick={addColumn} className="text-sm text-primary font-medium hover:underline flex items-center gap-1 mt-2">
                                    <Plus className="w-4 h-4" /> Add Field
                                </button>
                            </div>

                            <div className="flex items-center gap-3 pt-6">
                                <button
                                    onClick={handleCreate}
                                    disabled={submitting}
                                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-6 py-2.5 flex items-center gap-2 transition-all disabled:opacity-70"
                                >
                                    {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Table'}
                                </button>
                                <button
                                    onClick={() => setIsCreating(false)}
                                    className="px-6 py-2.5 font-medium text-muted-foreground hover:bg-secondary rounded-xl transition-all"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {loading ? (
                <div className="flex h-48 items-center justify-center border border-border border-dashed rounded-2xl">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
            ) : tables.length === 0 && !isCreating ? (
                <div className="flex flex-col items-center justify-center h-48 border border-border border-dashed rounded-2xl bg-card/50 text-center px-4">
                    <Database className="w-12 h-12 text-muted-foreground mb-3 opacity-50" />
                    <h3 className="text-lg font-medium text-foreground">No data tables found</h3>
                    <p className="text-muted-foreground text-sm max-w-sm mt-1">Create your first table to store knowledge for your AI agents.</p>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {tables.map(table => (
                        <div key={table.id} className="bg-card border border-border rounded-2xl p-6 shadow-sm hover:border-primary/50 transition-colors flex flex-col group leading-none">
                            <div className="flex items-center justify-between mb-4">
                                <div className="p-3 bg-primary/10 text-primary rounded-xl">
                                    <Table2 className="w-6 h-6" />
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => handleDelete(table.id)} className="p-2 text-destructive hover:bg-destructive/10 rounded-lg" title="Delete">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            <h3 className="text-xl font-bold flex-1">{table.name}</h3>

                            <div className="mt-4 pt-4 border-t border-border/50 text-sm">
                                <p className="text-muted-foreground mb-2 flex items-center justify-between">
                                    <span>Fields ({table.columns.length})</span>
                                </p>
                                <div className="flex flex-wrap gap-1.5 line-clamp-2 min-h-[3rem]">
                                    {table.columns.slice(0, 5).map(col => (
                                        <span key={col.id} className="bg-secondary text-secondary-foreground text-xs px-2.5 py-1 rounded-md border border-border whitespace-nowrap">
                                            {col.name}
                                        </span>
                                    ))}
                                    {table.columns.length > 5 && (
                                        <span className="bg-secondary text-muted-foreground text-xs px-2.5 py-1 rounded-md">+{table.columns.length - 5}</span>
                                    )}
                                </div>
                            </div>

                            <Link href={`/dashboard/ai/tables/${table.id}`} className="mt-5 bg-secondary hover:bg-primary hover:text-primary-foreground text-foreground px-4 py-2.5 rounded-xl font-medium w-full flex items-center justify-center gap-2 transition-all">
                                Manage Data <ArrowRight className="w-4 h-4" />
                            </Link>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

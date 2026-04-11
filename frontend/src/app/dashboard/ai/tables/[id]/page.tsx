"use client";

import { useEffect, useState, useRef, FormEvent, use } from "react";
import { ArrowLeft, Loader2, Plus, Type, Hash, ToggleLeft, Link as LinkIcon, Settings2, Trash2, ChevronDown, CheckSquare, Search, Columns, Clock } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";
import { CustomTable, ColumnDef } from "../page";
import { motion, AnimatePresence } from "framer-motion";

interface RowData {
    id: string;
    data: Record<string, any>;
    createdAt: string;
}

export default function TableDataPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const [table, setTable] = useState<CustomTable | null>(null);
    const [rows, setRows] = useState<RowData[]>([]);
    const [loading, setLoading] = useState(true);

    const [activeColMenu, setActiveColMenu] = useState<string | null>(null);
    const [newColMenuOpen, setNewColMenuOpen] = useState(false);

    // Auto-sync flags
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                const [tableRes, rowsRes] = await Promise.all([
                    api.get(`/tables/${id}`),
                    api.get(`/tables/${id}/rows`)
                ]);
                if (tableRes.data.success) setTable(tableRes.data.table);
                if (rowsRes.data.success) setRows(rowsRes.data.rows);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [id]);

    const handleUpdateTable = async (updatedColumns: ColumnDef[]) => {
        if (!table) return;
        setTable({ ...table, columns: updatedColumns });
        try {
            await api.put(`/tables/${table.id}`, {
                name: table.name,
                description: table.description,
                columns: updatedColumns
            });
        } catch (err) {
            console.error("Failed to update table columns", err);
        }
    };

    const handleCreateColumn = (type: any, name: string) => {
        const newCol: ColumnDef = { id: `c_${Date.now()}`, name, type };
        const updated = [...(table?.columns || []), newCol];
        handleUpdateTable(updated);
        setNewColMenuOpen(false);
    };

    const handleUpdateColumn = (colId: string, updates: Partial<ColumnDef>) => {
        if (!table) return;
        const updated = table.columns.map(c => c.id === colId ? { ...c, ...updates } : c);
        handleUpdateTable(updated);
    };

    const handleDeleteColumn = (colId: string) => {
        if (!table) return;
        if (!confirm("Delete this property? Data in this property will be lost.")) return;
        const updated = table.columns.filter(c => c.id !== colId);
        handleUpdateTable(updated);
        setActiveColMenu(null);
    };

    const handleUpdateRowData = async (rowId: string, colName: string, value: any) => {
        const rowData = rows.find(r => r.id === rowId);
        if (!rowData || rowData.data[colName] === value) return; // No change

        setSaving(true);
        // Optimistic UI
        setRows(rows.map(r => r.id === rowId ? { ...r, data: { ...r.data, [colName]: value } } : r));

        try {
            await api.put(`/tables/${id}/rows/${rowId}`, {
                data: { ...rowData.data, [colName]: value }
            });
        } catch (err) {
            console.error("Failed to update cell", err);
        } finally {
            setSaving(false);
        }
    };

    const handleCreateRow = async () => {
        setSaving(true);
        try {
            const res = await api.post(`/tables/${id}/rows`, { data: {} });
            if (res.data.success) {
                setRows([...rows, res.data.row]);
            }
        } catch (err) {
            console.error("Failed to add row", err);
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteRow = async (rowId: string) => {
        if (!confirm("Delete this page?")) return;
        setRows(rows.filter(r => r.id !== rowId));
        try {
            await api.delete(`/tables/${id}/rows/${rowId}`);
        } catch (err) {
            console.error("Failed to delete row", err);
        }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-screen">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
    );

    if (!table) return <div>Table not found</div>;

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'text': return <Type className="w-4 h-4" />;
            case 'number': return <Hash className="w-4 h-4" />;
            case 'boolean': return <CheckSquare className="w-4 h-4" />;
            case 'relation': return <LinkIcon className="w-4 h-4" />;
            default: return <Type className="w-4 h-4" />;
        }
    };

    return (
        <div className="min-h-screen bg-background text-foreground pb-20">
            {/* Header Area */}
            <div className="max-w-[1200px] mx-auto px-6 pt-12 pb-6">
                <Link href="/dashboard/ai/tables" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back
                </Link>

                <h1 className="text-4xl font-bold tracking-tight mb-4 flex items-center gap-3 group px-2 py-1 -ml-2 rounded-lg hover:bg-secondary/30 transition-colors w-fit border border-transparent hover:border-border">
                    {table.name}
                </h1>

                {table.description && (
                    <p className="text-muted-foreground mb-4 text-sm max-w-2xl px-2">{table.description}</p>
                )}

                <div className="flex items-center gap-4 text-sm font-medium">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/60 text-secondary-foreground rounded-md border border-border">
                        <Columns className="w-4 h-4" /> Table
                    </div>
                </div>
            </div>

            {/* Notion-like Table container */}
            <div className="max-w-[1200px] mx-auto px-6">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 opacity-0 text-sm"><Search className="w-4 h-4" /> Filter</div>
                    <div className="flex items-center gap-2">
                        <button className="text-muted-foreground hover:text-foreground p-1"><Settings2 className="w-4 h-4" /></button>
                        <button onClick={handleCreateRow} className="bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 hover:bg-primary/90 transition-colors">
                            New <ChevronDown className="w-3 h-3 ml-1 opacity-70" />
                        </button>
                    </div>
                </div>

                <div className="w-full border border-border rounded-lg overflow-x-auto bg-card shadow-sm">
                    {/* Header Row */}
                    <div className="flex w-fit min-w-full border-b border-border bg-secondary/20">
                        {/* Status Column Dummy (drag handle) */}
                        <div className="w-10 min-w-[40px] flex-shrink-0 border-r border-border/50"></div>

                        {table.columns.map(col => (
                            <div key={col.id} className="relative group border-r border-border/50 flex-shrink-0 min-w-[200px] hover:bg-secondary/50 transition-colors">
                                <button
                                    onClick={() => setActiveColMenu(activeColMenu === col.id ? null : col.id)}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground font-medium text-left outline-none"
                                >
                                    {getTypeIcon(col.type)}
                                    <span className="truncate flex-1">{col.name || 'Untitled'}</span>
                                </button>

                                <AnimatePresence>
                                    {activeColMenu === col.id && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }}
                                            className="absolute top-10 left-0 bg-popover border border-border shadow-md rounded-xl p-2 w-[280px] z-20"
                                        >
                                            <div className="mb-2">
                                                <input
                                                    type="text"
                                                    className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
                                                    value={col.name}
                                                    onChange={e => handleUpdateColumn(col.id, { name: e.target.value })}
                                                    placeholder="Property name"
                                                />
                                            </div>
                                            <div className="border-t border-border/50 my-2"></div>
                                            <div className="text-xs font-semibold text-muted-foreground px-2 py-1 uppercase tracking-wider">Type</div>
                                            <select
                                                className="w-full bg-transparent p-2 text-sm hover:bg-secondary/50 rounded-lg outline-none cursor-pointer mb-2"
                                                value={col.type}
                                                onChange={e => handleUpdateColumn(col.id, { type: e.target.value as any })}
                                            >
                                                <option value="text">Text (Paragraph)</option>
                                                <option value="number">Number</option>
                                                <option value="boolean">Checkbox</option>
                                                <option value="relation">Relation</option>
                                            </select>
                                            <div className="border-t border-border/50 my-2"></div>
                                            <button
                                                onClick={() => handleDeleteColumn(col.id)}
                                                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 rounded-lg outline-none transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" /> Delete property
                                            </button>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        ))}

                        {/* Add Property Header */}
                        <div className="relative border-r border-border/50 flex-shrink-0 min-w-[150px] flex-1 hover:bg-secondary/50 transition-colors">
                            <button
                                onClick={() => setNewColMenuOpen(!newColMenuOpen)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground outline-none"
                            >
                                <Plus className="w-4 h-4" /> Add property
                            </button>

                            <AnimatePresence>
                                {newColMenuOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }}
                                        className="absolute top-10 left-0 bg-popover border border-border shadow-md rounded-xl p-2 w-[280px] z-20"
                                    >
                                        <div className="text-xs font-semibold text-muted-foreground px-2 py-1 uppercase tracking-wider mb-1">Select type</div>
                                        <div className="max-h-64 overflow-y-auto space-y-0.5">
                                            <button onClick={() => handleCreateColumn('text', 'Text')} className="w-full flex items-center gap-2 px-2 py-2 hover:bg-secondary rounded-lg text-sm transition-colors text-left"><Type className="w-4 h-4 text-muted-foreground" /> Text</button>
                                            <button onClick={() => handleCreateColumn('number', 'Number')} className="w-full flex items-center gap-2 px-2 py-2 hover:bg-secondary rounded-lg text-sm transition-colors text-left"><Hash className="w-4 h-4 text-muted-foreground" /> Number</button>
                                            <button onClick={() => handleCreateColumn('boolean', 'Checkbox')} className="w-full flex items-center gap-2 px-2 py-2 hover:bg-secondary rounded-lg text-sm transition-colors text-left"><CheckSquare className="w-4 h-4 text-muted-foreground" /> Checkbox</button>
                                            <button onClick={() => handleCreateColumn('relation', 'Relation')} className="w-full flex items-center gap-2 px-2 py-2 hover:bg-secondary rounded-lg text-sm transition-colors text-left"><LinkIcon className="w-4 h-4 text-muted-foreground" /> Relation</button>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>

                    {/* Data Rows */}
                    {rows.map((row) => (
                        <div key={row.id} className="group flex w-fit min-w-full border-b border-border/50 hover:bg-secondary/10 transition-colors">
                            {/* Drag Handle / Delete */}
                            <div className="w-10 min-w-[40px] flex-shrink-0 border-r border-border/50 flex items-center justify-center">
                                <button onClick={() => handleDeleteRow(row.id)} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 text-destructive rounded-md transition-all">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            {table.columns.map(col => (
                                <div key={col.id} className="border-r border-border/50 flex-shrink-0 min-w-[200px] flex relative">
                                    {col.type === 'boolean' ? (
                                        <div className="w-full px-3 py-2 flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={!!row.data[col.name]}
                                                onChange={(e) => handleUpdateRowData(row.id, col.name, e.target.checked)}
                                                className="w-4 h-4 accent-primary cursor-pointer border border-border/50 rounded"
                                            />
                                        </div>
                                    ) : (
                                        <input
                                            type={col.type === 'number' ? 'number' : 'text'}
                                            className="w-full bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/30 focus:bg-secondary/20 transition-colors"
                                            placeholder="Empty"
                                            value={row.data[col.name] || ''}
                                            onChange={(e) => handleUpdateRowData(row.id, col.name, col.type === 'number' ? Number(e.target.value) : e.target.value)}
                                        />
                                    )}
                                </div>
                            ))}

                            <div className="border-r border-border/50 flex-shrink-0 min-w-[150px] flex-1"></div>
                        </div>
                    ))}

                    {/* New Page button */}
                    <div className="flex w-fit min-w-full hover:bg-secondary/10 transition-colors cursor-text" onClick={handleCreateRow}>
                        <div className="w-10 min-w-[40px] flex-shrink-0 border-r border-border/50"></div>
                        <div className="px-3 py-2 text-sm text-muted-foreground flex items-center gap-2 hover:text-foreground">
                            <Plus className="w-4 h-4" /> New
                        </div>
                    </div>
                </div>

                {saving && (
                    <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                    </div>
                )}
            </div>

            {/* Click outside to close menus hack */}
            {(activeColMenu || newColMenuOpen) && (
                <div
                    className="fixed inset-0 z-10"
                    onClick={() => { setActiveColMenu(null); setNewColMenuOpen(false); }}
                />
            )}
        </div>
    );
}


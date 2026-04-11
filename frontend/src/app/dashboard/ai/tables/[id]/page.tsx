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

    // Undo Stack
    type Action = { type: 'delete_row', rowId: string, rowData: RowData } | { type: 'delete_col', colDef: ColumnDef, colIndex: number };
    const [undoStack, setUndoStack] = useState<Action[]>([]);
    const [showToast, setShowToast] = useState<string | null>(null);

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

    useEffect(() => {
        const handleKeyDown = async (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                if (undoStack.length === 0) return;
                e.preventDefault();

                const action = undoStack[undoStack.length - 1];
                setUndoStack(prev => prev.slice(0, -1));

                if (action.type === 'delete_row') {
                    // Restore row in UI temp
                    setRows(prev => [...prev, action.rowData]);
                    setShowToast(`Record restored.`);
                    try {
                        const res = await api.post(`/tables/${id}/rows`, { data: action.rowData.data });
                        if (res.data.success) {
                            // Update the temp UI row with the new one from DB (with proper new ID maybe, or just refresh it)
                            setRows(r => r.map(row => row.id === action.rowId ? res.data.row : row));
                        }
                    } catch (err) { }
                }
                else if (action.type === 'delete_col') {
                    setTable(prev => {
                        if (!prev) return prev;
                        const newCols = [...prev.columns];
                        newCols.splice(action.colIndex, 0, action.colDef);
                        const updated = { ...prev, columns: newCols };
                        api.put(`/tables/${prev.id}`, { name: prev.name, description: prev.description, columns: newCols }).catch(console.error);
                        return updated;
                    });
                    setShowToast(`Property restored.`);
                }

                setTimeout(() => setShowToast(null), 3500);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undoStack, id]);

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
        const colIndex = table.columns.findIndex(c => c.id === colId);
        const colDef = table.columns[colIndex];

        const updated = table.columns.filter(c => c.id !== colId);
        setUndoStack(prev => [...prev, { type: 'delete_col', colDef, colIndex }]);
        setShowToast(`Property deleted. Press Ctrl+Z to undo.`);

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
        const rowData = rows.find(r => r.id === rowId);
        if (!rowData) return;

        setUndoStack(prev => [...prev, { type: 'delete_row', rowId, rowData }]);
        setShowToast(`Record deleted. Press Ctrl+Z to undo.`);
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
            <div className="max-w-[1200px] mx-auto px-6 relative pb-64 overflow-visible">
                <div className="w-full flex flex-col text-sm">
                    {/* Header Row */}
                    <div className="flex w-fit min-w-full border-t border-b border-border/50 text-muted-foreground bg-background">
                        {/* Status Column Dummy (drag handle) */}
                        <div className="w-10 min-w-[40px] flex-shrink-0 border-r border-border/50"></div>

                        {table.columns.map(col => (
                            <div key={col.id} className="relative group border-r border-border/50 flex-shrink-0 w-[220px] transition-colors">
                                <button
                                    onClick={() => setActiveColMenu(activeColMenu === col.id ? null : col.id)}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-muted-foreground hover:bg-secondary/30 transition-colors font-medium text-left outline-none"
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
                                            <button onClick={() => handleCreateColumn('boolean', 'Checkbox')} className="w-full flex items-center gap-2 px-2 py-2 hover:bg-secondary rounded-lg transition-colors text-left"><CheckSquare className="w-4 h-4 text-muted-foreground" /> Checkbox</button>
                                            <button onClick={() => handleCreateColumn('relation', 'Relation')} className="w-full flex items-center gap-2 px-2 py-2 hover:bg-secondary rounded-lg transition-colors text-left"><LinkIcon className="w-4 h-4 text-muted-foreground" /> Relation</button>
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
                                <div key={col.id} className="border-r border-border/50 flex-shrink-0 w-[220px] flex relative">
                                    {col.type === 'boolean' ? (
                                        <div className="w-full px-3 py-1.5 flex items-center">
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
                                            className="w-full bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground/30 focus:bg-secondary/20 transition-colors"
                                            placeholder=""
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
                    <div className="flex w-fit min-w-full hover:bg-secondary/10 transition-colors cursor-text text-sm border-b border-border/50 group" onClick={handleCreateRow}>
                        <div className="w-10 min-w-[40px] flex-shrink-0 border-r border-border/50 flex items-center justify-center">
                            <Plus className="w-3.5 h-3.5 opacity-0 group-hover:opacity-40" />
                        </div>
                        <div className="px-3 py-2 flex items-center gap-2 text-muted-foreground group-hover:text-foreground transition-colors w-[220px]">
                            <Plus className="w-4 h-4" /> New
                        </div>
                        <div className="flex-1"></div>
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

            {/* Undo Toast */}
            <AnimatePresence>
                {showToast && (
                    <motion.div
                        initial={{ opacity: 0, y: 50, x: '-50%' }}
                        animate={{ opacity: 1, y: 0, x: '-50%' }}
                        exit={{ opacity: 0, y: 50, x: '-50%' }}
                        className="fixed bottom-10 left-1/2 bg-foreground text-background px-6 py-3 rounded-full shadow-lg font-medium text-sm z-50 flex items-center gap-3"
                    >
                        {showToast}
                        <div className="px-2 py-1 bg-background/20 rounded text-xs">Ctrl + Z</div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}


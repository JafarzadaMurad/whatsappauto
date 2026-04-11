"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Plus, Trash2, Save } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";
import { CustomTable, ColumnDef } from "../page";

interface RowData {
    id: string;
    data: Record<string, any>;
    createdAt: string;
}

export default function TableDataPage({ params }: { params: { id: string } }) {
    const [table, setTable] = useState<CustomTable | null>(null);
    const [rows, setRows] = useState<RowData[]>([]);
    const [loading, setLoading] = useState(true);

    const [isAdding, setIsAdding] = useState(false);
    const [newRowData, setNewRowData] = useState<Record<string, any>>({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                const [tableRes, rowsRes] = await Promise.all([
                    api.get(`/tables/${params.id}`),
                    api.get(`/tables/${params.id}/rows`)
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
    }, [params.id]);

    const handleSaveRow = async () => {
        setSaving(true);
        try {
            const res = await api.post(`/tables/${params.id}/rows`, { data: newRowData });
            if (res.data.success) {
                setRows([res.data.row, ...rows]);
                setNewRowData({});
                setIsAdding(false);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteRow = async (rowId: string) => {
        if (!confirm('Delete this row?')) return;
        try {
            await api.delete(`/tables/${params.id}/rows/${rowId}`);
            setRows(rows.filter(r => r.id !== rowId));
        } catch (err) {
            console.error(err);
        }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-64 border border-border border-dashed rounded-2xl">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
    );

    if (!table) return <div>Table not found</div>;

    return (
        <div className="max-w-7xl mx-auto space-y-8">
            <div className="flex flex-col gap-4">
                <Link href="/dashboard/ai/tables" className="flex items-center text-sm font-medium text-muted-foreground hover:text-foreground w-fit transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-1" />
                    Back to Tables
                </Link>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-foreground">{table.name}</h1>
                        <p className="text-muted-foreground mt-1">Manage knowledge data records for this table</p>
                    </div>
                    <button
                        onClick={() => setIsAdding(true)}
                        className="bg-primary text-primary-foreground px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 hover:bg-primary/90 transition-all active:scale-[0.98]"
                    >
                        <Plus className="w-5 h-5" />
                        Add Record
                    </button>
                </div>
            </div>

            {isAdding && (
                <div className="bg-card border border-border p-6 rounded-2xl shadow-sm">
                    <h3 className="font-semibold text-lg mb-4">New Entry</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {table.columns.map(col => (
                            <div key={col.id}>
                                <label className="text-sm font-medium text-muted-foreground mb-1 block">{col.name}</label>
                                {col.type === 'boolean' ? (
                                    <div className="flex items-center gap-2 h-10 px-2 mt-1">
                                        <input
                                            type="checkbox"
                                            checked={!!newRowData[col.name]}
                                            onChange={e => setNewRowData({ ...newRowData, [col.name]: e.target.checked })}
                                            className="w-5 h-5 accent-primary rounded border border-border"
                                        />
                                        <span className="text-sm">Yes</span>
                                    </div>
                                ) : (
                                    <input
                                        type={col.type === 'number' ? 'number' : 'text'}
                                        placeholder={`Enter ${col.name.toLowerCase()}`}
                                        value={newRowData[col.name] || ''}
                                        onChange={e => setNewRowData({ ...newRowData, [col.name]: col.type === 'number' ? Number(e.target.value) : e.target.value })}
                                        className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="mt-6 flex items-center gap-3">
                        <button
                            onClick={handleSaveRow}
                            disabled={saving}
                            className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-6 py-2.5 flex items-center gap-2 transition-all disabled:opacity-70"
                        >
                            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save Record
                        </button>
                        <button
                            onClick={() => setIsAdding(false)}
                            className="px-6 py-2.5 font-medium text-muted-foreground hover:bg-secondary rounded-xl transition-all"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-secondary/50 border-b border-border text-sm">
                                {table.columns.map(col => (
                                    <th key={col.id} className="px-6 py-4 font-semibold text-muted-foreground whitespace-nowrap">
                                        {col.name} <span className="opacity-50 font-normal text-xs ml-1">({col.type})</span>
                                    </th>
                                ))}
                                <th className="px-6 py-4 font-semibold text-muted-foreground text-right w-20">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 ? (
                                <tr>
                                    <td colSpan={table.columns.length + 1} className="px-6 py-12 text-center text-muted-foreground">
                                        No records found. Click "Add Record" to start populating this table.
                                    </td>
                                </tr>
                            ) : (
                                rows.map(row => (
                                    <tr key={row.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors last:border-0 group">
                                        {table.columns.map(col => (
                                            <td key={col.id} className="px-6 py-4 max-w-[200px] truncate text-sm">
                                                {col.type === 'boolean' ? (
                                                    row.data[col.name] ? 'Yes' : 'No'
                                                ) : col.type === 'relation' ? (
                                                    <span className="bg-secondary px-2 py-1 rounded text-xs border border-border break-all">{row.data[col.name]?.toString() || '-'}</span>
                                                ) : (
                                                    row.data[col.name]?.toString() || '-'
                                                )}
                                            </td>
                                        ))}
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => handleDeleteRow(row.id)} className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
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

"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Users, Search, Phone, Tag, Loader2, MessageSquare, Camera, Settings2, X, Plus, Trash2, GripVertical, ArrowUp, ArrowDown, ChevronsUpDown, Save } from "lucide-react";
import api from "@/lib/api";

interface Client {
    id: string;
    phone: string;
    name: string | null;
    status: string;
    tags: string[];
    channel: string | null;
    sourceLabel: string | null;
    customFields: Record<string, any> | null;
    summary?: string | null;
    createdAt: string;
    updatedAt: string;
}

interface UserField {
    id: string;
    key: string;
    label: string;
    type: 'text' | 'number' | 'date' | 'select' | 'boolean';
    options: string[];
    order: number;
}

type SortKey = 'name' | 'status' | 'updatedAt' | string; // custom: `cf:${key}`
type SortDir = 'asc' | 'desc';

const getStatusColor = (status: string) => {
    switch (status.toUpperCase()) {
        case 'NEW': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
        case 'LEAD': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
        case 'PURCHASED': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
        case 'SPAM': return 'bg-destructive/10 text-destructive border-destructive/20';
        default: return 'bg-secondary text-muted-foreground border-border';
    }
};

export default function ContactsPage() {
    const [clients, setClients] = useState<Client[]>([]);
    const [fields, setFields] = useState<UserField[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [showFieldsModal, setShowFieldsModal] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [c, f] = await Promise.all([
                api.get('/clients'),
                api.get('/user-fields'),
            ]);
            if (c.data.success) setClients(c.data.clients);
            if (f.data.success) setFields(f.data.fields);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const sortedFiltered = useMemo(() => {
        const q = search.trim().toLowerCase();
        const filtered = clients.filter(c =>
            !q || (c.name?.toLowerCase().includes(q)) || c.phone.includes(q)
        );

        const getVal = (c: Client, key: SortKey): any => {
            if (key === 'name') return c.name || '';
            if (key === 'status') return c.status;
            if (key === 'updatedAt') return c.updatedAt;
            if (key.startsWith('cf:')) return c.customFields?.[key.slice(3)] ?? '';
            return '';
        };
        const dir = sortDir === 'asc' ? 1 : -1;
        return [...filtered].sort((a, b) => {
            const va = getVal(a, sortKey);
            const vb = getVal(b, sortKey);
            if (va < vb) return -1 * dir;
            if (va > vb) return 1 * dir;
            return 0;
        });
    }, [clients, search, sortKey, sortDir]);

    const toggleSort = (k: SortKey) => {
        if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(k); setSortDir('asc'); }
    };

    const SortIcon = ({ k }: { k: SortKey }) => {
        if (sortKey !== k) return <ChevronsUpDown className="w-3 h-3 opacity-40" />;
        return sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
    };

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-foreground">Contacts</h1>
                    <p className="text-muted-foreground mt-1 text-sm">People who messaged you across WhatsApp and Instagram, with editable custom fields.</p>
                </div>
                <button onClick={() => setShowFieldsModal(true)}
                    className="self-start sm:self-auto inline-flex items-center gap-2 bg-card border border-border px-4 py-2 rounded-xl text-sm font-medium hover:bg-secondary/50 transition-colors">
                    <Settings2 className="w-4 h-4" /> Manage Fields
                </button>
            </div>

            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                    type="text"
                    placeholder="Search by name or phone..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground"
                />
            </div>

            <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead>
                            <tr className="bg-secondary/50 border-b border-border">
                                <Th onClick={() => toggleSort('name')}>
                                    Contact <SortIcon k="name" />
                                </Th>
                                <Th>Channel</Th>
                                <Th onClick={() => toggleSort('status')}>
                                    Status <SortIcon k="status" />
                                </Th>
                                <Th>Tags</Th>
                                {fields.map(f => (
                                    <Th key={f.id} onClick={() => toggleSort(`cf:${f.key}`)}>
                                        {f.label} <SortIcon k={`cf:${f.key}`} />
                                    </Th>
                                ))}
                                <Th onClick={() => toggleSort('updatedAt')}>
                                    Last Activity <SortIcon k="updatedAt" />
                                </Th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={5 + fields.length} className="px-6 py-12 text-center">
                                        <Loader2 className="w-7 h-7 animate-spin text-muted-foreground mx-auto" />
                                    </td>
                                </tr>
                            ) : sortedFiltered.length === 0 ? (
                                <tr>
                                    <td colSpan={5 + fields.length} className="px-6 py-12 text-center">
                                        <div className="flex flex-col items-center text-muted-foreground">
                                            <Users className="w-12 h-12 mb-3 opacity-50" />
                                            <p className="font-medium">No contacts yet</p>
                                            <p className="text-xs mt-1">They appear here once someone messages your connected channels.</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : sortedFiltered.map(c => (
                                <tr key={c.id}
                                    onClick={() => setEditingClient(c)}
                                    className="border-b border-border/50 hover:bg-secondary/20 transition-colors last:border-0 cursor-pointer">
                                    <td className="px-5 py-3.5">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                                                {c.name ? c.name.charAt(0).toUpperCase() : <Phone className="w-3.5 h-3.5" />}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="font-medium text-foreground truncate">{c.name || 'Unknown'}</div>
                                                <div className="text-xs text-muted-foreground font-mono truncate">{c.phone.split('@')[0]}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3.5">
                                        {c.channel === 'instagram' ? (
                                            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-pink-500/10 text-pink-400 border border-pink-500/20">
                                                <Camera className="w-3 h-3" /> Instagram
                                            </span>
                                        ) : c.channel === 'whatsapp' ? (
                                            <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                <MessageSquare className="w-3 h-3" /> WhatsApp
                                            </span>
                                        ) : <span className="text-xs text-muted-foreground italic">—</span>}
                                    </td>
                                    <td className="px-5 py-3.5">
                                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${getStatusColor(c.status)}`}>
                                            {c.status}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3.5">
                                        <div className="flex flex-wrap gap-1">
                                            {c.tags.length > 0 ? c.tags.slice(0, 3).map((t, i) => (
                                                <span key={i} className="bg-secondary text-[10px] px-1.5 py-0.5 rounded border border-border flex items-center gap-1">
                                                    <Tag className="w-2.5 h-2.5" /> {t}
                                                </span>
                                            )) : <span className="text-muted-foreground text-xs italic">—</span>}
                                            {c.tags.length > 3 && <span className="text-[10px] text-muted-foreground">+{c.tags.length - 3}</span>}
                                        </div>
                                    </td>
                                    {fields.map(f => (
                                        <td key={f.id} className="px-5 py-3.5 text-xs text-muted-foreground">
                                            {renderFieldValue(c.customFields?.[f.key], f)}
                                        </td>
                                    ))}
                                    <td className="px-5 py-3.5 text-xs text-muted-foreground">
                                        {new Date(c.updatedAt).toLocaleDateString()}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {showFieldsModal && (
                <ManageFieldsModal
                    fields={fields}
                    onClose={() => setShowFieldsModal(false)}
                    onChange={(next) => setFields(next)}
                />
            )}

            {editingClient && (
                <EditContactDrawer
                    client={editingClient}
                    fields={fields}
                    onClose={() => setEditingClient(null)}
                    onSaved={(updated) => {
                        setClients(cs => cs.map(c => c.id === updated.id ? updated : c));
                        setEditingClient(null);
                    }}
                />
            )}
        </div>
    );
}

function Th({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
    return (
        <th onClick={onClick}
            className={`px-5 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide ${onClick ? 'cursor-pointer hover:text-foreground' : ''}`}>
            <span className="inline-flex items-center gap-1.5">{children}</span>
        </th>
    );
}

function renderFieldValue(v: any, f: UserField) {
    if (v === undefined || v === null || v === '') return <span className="italic opacity-50">—</span>;
    if (f.type === 'boolean') return v ? '✓' : '✗';
    if (f.type === 'date') {
        try { return new Date(v).toLocaleDateString(); } catch { return String(v); }
    }
    return String(v);
}

// ─── Manage Fields modal ───
function ManageFieldsModal({ fields, onClose, onChange }: { fields: UserField[]; onClose: () => void; onChange: (next: UserField[]) => void }) {
    const [local, setLocal] = useState<UserField[]>(fields);
    const [adding, setAdding] = useState(false);
    const [newField, setNewField] = useState({ label: '', type: 'text' as UserField['type'], options: '' });
    const [busy, setBusy] = useState(false);
    const [dragIndex, setDragIndex] = useState<number | null>(null);

    const addField = async () => {
        if (!newField.label.trim()) return;
        setBusy(true);
        try {
            const body: any = { label: newField.label.trim(), type: newField.type };
            if (newField.type === 'select') body.options = newField.options.split(',').map(s => s.trim()).filter(Boolean);
            const r = await api.post('/user-fields', body);
            if (r.data.success) {
                const next = [...local, r.data.field];
                setLocal(next); onChange(next);
                setNewField({ label: '', type: 'text', options: '' });
                setAdding(false);
            }
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        } finally { setBusy(false); }
    };

    const updateField = async (id: string, patch: Partial<UserField>) => {
        setLocal(arr => arr.map(f => f.id === id ? { ...f, ...patch } : f));
        try {
            const r = await api.put(`/user-fields/${id}`, patch);
            if (r.data.success) {
                const next = local.map(f => f.id === id ? r.data.field : f);
                onChange(next);
            }
        } catch (e: any) { console.error(e); }
    };

    const deleteField = async (id: string) => {
        if (!confirm('Delete this field? Existing values on contacts will remain in the database but stop being displayed.')) return;
        try {
            await api.delete(`/user-fields/${id}`);
            const next = local.filter(f => f.id !== id);
            setLocal(next); onChange(next);
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        }
    };

    const onDrop = async (toIndex: number) => {
        if (dragIndex === null || dragIndex === toIndex) return;
        const next = [...local];
        const [item] = next.splice(dragIndex, 1);
        next.splice(toIndex, 0, item);
        setLocal(next);
        setDragIndex(null);
        try {
            await api.put('/user-fields/reorder', { ids: next.map(f => f.id) });
            onChange(next);
        } catch (e: any) { console.error(e); }
    };

    return (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <div>
                        <h2 className="font-semibold text-lg">Custom Fields</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">Define extra fields to capture on each contact. Drag to reorder.</p>
                    </div>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-2">
                    {local.length === 0 && !adding && (
                        <p className="text-sm text-muted-foreground text-center py-6">No custom fields yet.</p>
                    )}
                    {local.map((f, i) => (
                        <div key={f.id}
                            draggable
                            onDragStart={() => setDragIndex(i)}
                            onDragOver={e => e.preventDefault()}
                            onDrop={() => onDrop(i)}
                            className="flex items-center gap-2 p-3 rounded-lg border border-border bg-secondary/30">
                            <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab flex-shrink-0" />
                            <input type="text" value={f.label}
                                onChange={e => setLocal(arr => arr.map(x => x.id === f.id ? { ...x, label: e.target.value } : x))}
                                onBlur={() => updateField(f.id, { label: local.find(x => x.id === f.id)!.label })}
                                className="flex-1 bg-transparent text-sm font-medium focus:outline-none" />
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-card text-muted-foreground font-mono">{f.key}</span>
                            <select value={f.type}
                                onChange={e => updateField(f.id, { type: e.target.value as any })}
                                className="bg-card border border-border rounded px-2 py-1 text-xs">
                                <option value="text">Text</option>
                                <option value="number">Number</option>
                                <option value="date">Date</option>
                                <option value="select">Select</option>
                                <option value="boolean">Boolean</option>
                            </select>
                            {f.type === 'select' && (
                                <input type="text" placeholder="opt1, opt2"
                                    value={f.options.join(', ')}
                                    onChange={e => setLocal(arr => arr.map(x => x.id === f.id ? { ...x, options: e.target.value.split(',').map(s => s.trim()) } : x))}
                                    onBlur={() => updateField(f.id, { options: local.find(x => x.id === f.id)!.options.filter(Boolean) })}
                                    className="w-32 bg-card border border-border rounded px-2 py-1 text-xs" />
                            )}
                            <button onClick={() => deleteField(f.id)} className="text-muted-foreground hover:text-red-400">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}

                    {adding ? (
                        <div className="p-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 space-y-2">
                            <input type="text" autoFocus value={newField.label}
                                onChange={e => setNewField({ ...newField, label: e.target.value })}
                                placeholder="Field label (e.g. Age, City, Purpose)"
                                className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-sm" />
                            <div className="flex gap-2">
                                <select value={newField.type}
                                    onChange={e => setNewField({ ...newField, type: e.target.value as any })}
                                    className="bg-card border border-border rounded px-2 py-1.5 text-xs">
                                    <option value="text">Text</option>
                                    <option value="number">Number</option>
                                    <option value="date">Date</option>
                                    <option value="select">Select</option>
                                    <option value="boolean">Boolean</option>
                                </select>
                                {newField.type === 'select' && (
                                    <input type="text" placeholder="comma-separated options"
                                        value={newField.options}
                                        onChange={e => setNewField({ ...newField, options: e.target.value })}
                                        className="flex-1 bg-card border border-border rounded px-2.5 py-1.5 text-xs" />
                                )}
                                <button onClick={addField} disabled={busy || !newField.label.trim()}
                                    className="ml-auto bg-primary text-primary-foreground rounded px-3 py-1.5 text-xs font-medium disabled:opacity-60">
                                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Add'}
                                </button>
                                <button onClick={() => { setAdding(false); setNewField({ label: '', type: 'text', options: '' }); }}
                                    className="text-xs text-muted-foreground hover:text-foreground px-2">
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button onClick={() => setAdding(true)}
                            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:bg-secondary/40">
                            <Plus className="w-3.5 h-3.5" /> Add field
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Edit Contact drawer ───
function EditContactDrawer({ client, fields, onClose, onSaved }: {
    client: Client;
    fields: UserField[];
    onClose: () => void;
    onSaved: (c: Client) => void;
}) {
    const [name, setName] = useState(client.name || '');
    const [status, setStatus] = useState(client.status);
    const [tags, setTags] = useState<string[]>(client.tags);
    const [tagInput, setTagInput] = useState('');
    const [custom, setCustom] = useState<Record<string, any>>(client.customFields || {});
    const [saving, setSaving] = useState(false);

    const addTag = () => {
        const t = tagInput.trim();
        if (t && !tags.includes(t)) setTags([...tags, t]);
        setTagInput('');
    };

    const save = async () => {
        setSaving(true);
        try {
            const r = await api.put(`/clients/${client.id}`, {
                name: name.trim() || null,
                status,
                tags,
                customFields: custom,
            });
            if (r.data.success) onSaved(r.data.client);
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        } finally { setSaving(false); }
    };

    return (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" onClick={onClose}>
            <div className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-card border-l border-border shadow-2xl flex flex-col"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold flex-shrink-0">
                            {name ? name.charAt(0).toUpperCase() : <Phone className="w-4 h-4" />}
                        </div>
                        <div className="min-w-0">
                            <h2 className="font-semibold truncate">{name || 'Unknown'}</h2>
                            <p className="text-xs text-muted-foreground font-mono truncate">{client.phone.split('@')[0]}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    <Field label="Name">
                        <input type="text" value={name} onChange={e => setName(e.target.value)}
                            className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                    </Field>

                    <Field label="Status">
                        <select value={status} onChange={e => setStatus(e.target.value)}
                            className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm">
                            <option value="NEW">NEW</option>
                            <option value="LEAD">LEAD</option>
                            <option value="PURCHASED">PURCHASED</option>
                            <option value="SPAM">SPAM</option>
                        </select>
                    </Field>

                    <Field label="Tags">
                        <div className="flex flex-wrap gap-1.5 mb-2">
                            {tags.map((t, i) => (
                                <span key={i} className="inline-flex items-center gap-1 bg-secondary text-xs px-2 py-0.5 rounded border border-border">
                                    {t}
                                    <button onClick={() => setTags(tags.filter((_, j) => j !== i))}>
                                        <X className="w-3 h-3 opacity-60 hover:opacity-100" />
                                    </button>
                                </span>
                            ))}
                        </div>
                        <input type="text" value={tagInput}
                            onChange={e => setTagInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                            placeholder="Type a tag, press Enter"
                            className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                    </Field>

                    {fields.length > 0 && (
                        <div className="border-t border-border pt-4 space-y-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom Fields</p>
                            {fields.map(f => (
                                <Field key={f.id} label={f.label}>
                                    <CustomFieldInput field={f} value={custom[f.key]}
                                        onChange={(v) => setCustom({ ...custom, [f.key]: v })} />
                                </Field>
                            ))}
                        </div>
                    )}
                </div>

                <div className="border-t border-border p-4 flex gap-2">
                    <button onClick={onClose} className="flex-1 border border-border bg-secondary/40 hover:bg-secondary/70 rounded-lg py-2 text-sm">
                        Cancel
                    </button>
                    <button onClick={save} disabled={saving}
                        className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
            {children}
        </div>
    );
}

function CustomFieldInput({ field, value, onChange }: { field: UserField; value: any; onChange: (v: any) => void }) {
    const cls = "w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm";
    if (field.type === 'boolean') {
        return (
            <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)}
                    className="w-4 h-4 accent-primary" />
                <span className="text-sm">{value ? 'Yes' : 'No'}</span>
            </label>
        );
    }
    if (field.type === 'number') {
        return <input type="number" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} className={cls} />;
    }
    if (field.type === 'date') {
        return <input type="date" value={value ?? ''} onChange={e => onChange(e.target.value || null)} className={cls} />;
    }
    if (field.type === 'select') {
        return (
            <select value={value ?? ''} onChange={e => onChange(e.target.value || null)} className={cls}>
                <option value="">—</option>
                {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
        );
    }
    return <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)} className={cls} />;
}

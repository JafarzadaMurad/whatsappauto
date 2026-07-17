"use client";

// Media library attached to a single agent. Users upload image / video /
// audio / pdf files (drag & drop, paste, or the upload button) and give
// each one a short handle-name; the agent's system prompt is then
// auto-augmented with a catalogue block so the LLM knows what it can
// send. At runtime the agent calls the `send_media(name)` tool to push
// the file to WhatsApp / Instagram.

import { useCallback, useEffect, useRef, useState } from "react";
import {
    UploadCloud, Loader2, X, Trash2, Pencil, FileText, Image as ImageIcon,
    Video, Music, File as FileIcon, CheckCircle2, Save, ClipboardPaste,
} from "lucide-react";
import api from "@/lib/api";

export type AgentMediaItem = {
    id: string;
    name: string;
    filename: string;
    mediaUrl: string;
    mimeType: string;
    sizeBytes: number;
    kind: "image" | "video" | "audio" | "document";
    description: string | null;
    createdAt: string;
};

const kindIcon = (kind: string) => {
    if (kind === "image") return ImageIcon;
    if (kind === "video") return Video;
    if (kind === "audio") return Music;
    return FileText;
};

const kindColor = (kind: string) => {
    if (kind === "image") return "text-emerald-400 bg-emerald-500/10";
    if (kind === "video") return "text-pink-400 bg-pink-500/10";
    if (kind === "audio") return "text-blue-400 bg-blue-500/10";
    return "text-amber-400 bg-amber-500/10";
};

function humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function AgentMediaSection({ agentId, disabled }: { agentId: string; disabled?: boolean }) {
    const [items, setItems] = useState<AgentMediaItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<AgentMediaItem | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async () => {
        try {
            const res = await api.get(`/agents/${agentId}/media`);
            if (res.data.success) setItems(res.data.media);
        } finally { setLoading(false); }
    }, [agentId]);

    useEffect(() => { load(); }, [load]);

    const uploadFiles = useCallback(async (files: FileList | File[]) => {
        const arr = Array.from(files).filter(f => f && f.size > 0);
        if (arr.length === 0) return;
        setError(null);
        setUploading(arr.length);
        for (const file of arr) {
            try {
                const form = new FormData();
                form.append("file", file);
                await api.post(`/agents/${agentId}/media`, form, {
                    headers: { "Content-Type": "multipart/form-data" },
                });
            } catch (err: any) {
                setError(err.response?.data?.message || err.message || "Upload failed");
                break;
            } finally { setUploading(n => Math.max(0, n - 1)); }
        }
        await load();
    }, [agentId, load]);

    // Drag & drop — only respond when files actually land on the panel.
    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        if (disabled) return;
        if (e.dataTransfer?.files?.length) void uploadFiles(e.dataTransfer.files);
    };
    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
    };
    const onDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        // Only clear when leaving the outer container, not while moving
        // between children (dragleave fires per-element).
        if (e.currentTarget === e.target) setDragging(false);
    };

    // Ctrl+V / Cmd+V while focused inside the media panel — supports the
    // "copy file → paste here" flow (screenshots, PDF from download bar).
    useEffect(() => {
        const el = rootRef.current;
        if (!el) return;
        const handler = (e: ClipboardEvent) => {
            if (disabled) return;
            const files: File[] = [];
            const items = e.clipboardData?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                if (it.kind === "file") {
                    const f = it.getAsFile();
                    if (f) files.push(f);
                }
            }
            if (files.length > 0) {
                e.preventDefault();
                void uploadFiles(files);
            }
        };
        el.addEventListener("paste", handler);
        return () => el.removeEventListener("paste", handler);
    }, [disabled, uploadFiles]);

    const remove = async (id: string) => {
        if (!confirm("Delete this media?")) return;
        try {
            await api.delete(`/agents/${agentId}/media/${id}`);
            await load();
        } catch (err: any) {
            setError(err.response?.data?.message || err.message);
        }
    };

    const saveRename = async (patch: { name?: string; description?: string | null }) => {
        if (!editing) return;
        try {
            await api.patch(`/agents/${agentId}/media/${editing.id}`, patch);
            setEditing(null);
            await load();
        } catch (err: any) {
            setError(err.response?.data?.message || err.message);
        }
    };

    return (
        <div ref={rootRef} tabIndex={0}
            className={`bg-card border rounded-2xl p-5 space-y-4 focus:outline-none transition-colors ${
                dragging ? 'border-primary bg-primary/5' : 'border-border'
            }`}
            onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="font-semibold flex items-center gap-2">
                        <div className="p-1.5 bg-primary/10 text-primary rounded-lg"><UploadCloud className="w-4 h-4" /></div>
                        Media library
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                        Files the agent can send to customers on demand. Reference them by <span className="text-foreground font-mono">name</span> in your system prompt
                        (e.g. <span className="text-foreground italic">"if the customer agrees, send the <span className="font-mono">vsl</span> video, then the <span className="font-mono">teklif</span> pdf"</span>).
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={() => fileInputRef.current?.click()}
                        disabled={disabled}
                        className="bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground rounded-xl px-3 py-2 text-xs font-medium flex items-center gap-1.5 transition-all">
                        <UploadCloud className="w-3.5 h-3.5" /> Upload
                    </button>
                    <input ref={fileInputRef} type="file" multiple hidden
                        accept="image/*,video/*,audio/*,application/*"
                        onChange={e => e.target.files && uploadFiles(e.target.files)} />
                </div>
            </div>

            {/* Drop-zone hint */}
            <div className={`border-2 border-dashed rounded-xl px-4 py-6 text-center text-xs transition-colors ${
                dragging
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground'
            }`}>
                <div className="flex flex-wrap items-center justify-center gap-2">
                    <UploadCloud className="w-4 h-4" />
                    <span>Drag &amp; drop files here</span>
                    <span className="text-border">·</span>
                    <span className="flex items-center gap-1"><ClipboardPaste className="w-3 h-3" /> Ctrl/Cmd + V to paste</span>
                    <span className="text-border">·</span>
                    <span>or click Upload</span>
                </div>
                <p className="text-[10px] text-muted-foreground/70 mt-1">Up to 50 MB per file. Image, video, audio, PDF, doc.</p>
            </div>

            {error && (
                <div className="text-xs bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2">{error}</div>
            )}
            {uploading > 0 && (
                <div className="text-xs flex items-center gap-2 text-primary">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading {uploading} file{uploading > 1 ? 's' : ''}…
                </div>
            )}

            {/* Item list */}
            {loading ? (
                <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : items.length === 0 ? (
                <div className="text-xs text-center text-muted-foreground py-4 italic">
                    No media yet. Files you upload will be listed here + injected into the agent's system prompt as <span className="font-mono not-italic">Available media</span>.
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {items.map(m => {
                        const Icon = kindIcon(m.kind);
                        return (
                            <div key={m.id} className="bg-secondary/20 border border-border rounded-xl p-3 flex items-start gap-3 group">
                                <div className={`w-11 h-11 flex-shrink-0 rounded-lg flex items-center justify-center ${kindColor(m.kind)}`}>
                                    {m.kind === 'image' ? (
                                        // Small thumbnail for images. Falls back to icon if the image URL isn't reachable.
                                        <img src={m.mediaUrl} alt="" className="w-full h-full object-cover rounded-lg"
                                            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                                    ) : (
                                        <Icon className="w-5 h-5" />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="font-mono text-sm truncate">{m.name}</span>
                                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-secondary/60 rounded px-1">{m.kind}</span>
                                    </div>
                                    <div className="text-[10px] text-muted-foreground truncate">
                                        {m.filename} · {humanSize(m.sizeBytes)}
                                    </div>
                                    {m.description && (
                                        <div className="text-[11px] text-muted-foreground italic mt-0.5 truncate">{m.description}</div>
                                    )}
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <button onClick={() => setEditing(m)} title="Rename / describe"
                                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                                        <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button onClick={() => remove(m.id)} title="Delete"
                                        className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Rename / describe modal */}
            {editing && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
                    <div className="bg-card border border-border rounded-2xl w-full max-w-md p-4 space-y-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h4 className="font-semibold">Edit media</h4>
                            <button onClick={() => setEditing(null)} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground">Name (the slug the agent uses in send_media)</label>
                            <input value={editing.name}
                                onChange={e => setEditing({ ...editing, name: e.target.value })}
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" />
                            <p className="text-[10px] text-muted-foreground mt-1">Lowercase, hyphens instead of spaces. Will be auto-normalised.</p>
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground">Description (optional — appears in the system prompt)</label>
                            <textarea value={editing.description || ''}
                                onChange={e => setEditing({ ...editing, description: e.target.value })}
                                placeholder="Sales pitch video for VIP prospects"
                                rows={2}
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50" />
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-1">
                            <button onClick={() => setEditing(null)}
                                className="text-xs px-3 py-1.5 rounded-lg text-muted-foreground hover:bg-secondary/50">Cancel</button>
                            <button onClick={() => saveRename({ name: editing.name, description: editing.description })}
                                className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs px-4 py-1.5 rounded-lg font-medium flex items-center gap-1.5">
                                <Save className="w-3.5 h-3.5" /> Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

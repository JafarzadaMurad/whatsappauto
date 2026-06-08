"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Check, Plus, Loader2, Building2, Settings as SettingsIcon } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";
import { useWorkspaceStore } from "@/store/workspaceStore";

export default function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
    const { workspaces, activeWorkspaceId, setWorkspaces, setActiveWorkspace } = useWorkspaceStore();
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState("");

    useEffect(() => {
        (async () => {
            try {
                const r = await api.get('/workspaces');
                if (r.data?.success) setWorkspaces(r.data.workspaces);
            } catch { /* ignore */ }
            finally { setLoading(false); }
        })();
    }, [setWorkspaces]);

    const active = workspaces.find(w => w.id === activeWorkspaceId);

    const switchTo = (id: string) => {
        if (id === activeWorkspaceId) { setOpen(false); return; }
        setActiveWorkspace(id);
        setOpen(false);
        // Reload so every page re-fetches with the new X-Workspace-Id header.
        window.location.reload();
    };

    const createWorkspace = async () => {
        if (!newName.trim()) return;
        setCreating(true);
        try {
            const r = await api.post('/workspaces', { name: newName.trim() });
            if (r.data?.success) {
                const wsList = await api.get('/workspaces');
                if (wsList.data?.success) setWorkspaces(wsList.data.workspaces);
                setActiveWorkspace(r.data.workspace.id);
                setNewName("");
                window.location.reload();
            }
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        } finally { setCreating(false); }
    };

    if (collapsed) {
        return (
            <button onClick={() => setOpen(o => !o)} title={active?.name || 'Workspace'}
                className="w-full flex justify-center p-2 rounded-lg bg-secondary/40 text-foreground hover:bg-secondary/70">
                <Building2 className="w-4 h-4" />
            </button>
        );
    }

    return (
        <div className="relative">
            <button onClick={() => setOpen(o => !o)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/40 border border-border hover:bg-secondary/70 transition-colors">
                <Building2 className="w-4 h-4 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0 text-left">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">Workspace</p>
                    {loading ? (
                        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                    ) : (
                        <p className="text-sm font-medium truncate">{active?.name || 'No workspace'}</p>
                    )}
                </div>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-2xl p-1 max-h-[60vh] overflow-y-auto">
                    {workspaces.map(w => (
                        <button key={w.id} onClick={() => switchTo(w.id)}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-secondary/60 text-left text-sm">
                            <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{w.name}</p>
                                <p className="text-[10px] text-muted-foreground">
                                    {w.isOwner ? 'Owner' : w.role.toLowerCase()}
                                </p>
                            </div>
                            {w.id === activeWorkspaceId && <Check className="w-4 h-4 text-primary" />}
                        </button>
                    ))}

                    <div className="border-t border-border my-1" />

                    <div className="p-2 space-y-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">New workspace</p>
                        <div className="flex gap-1.5">
                            <input value={newName} onChange={e => setNewName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') createWorkspace(); }}
                                placeholder="Workspace name"
                                className="flex-1 bg-secondary/40 border border-border rounded px-2 py-1 text-xs" />
                            <button onClick={createWorkspace} disabled={creating || !newName.trim()}
                                className="bg-primary text-primary-foreground rounded px-2 py-1 text-xs disabled:opacity-50">
                                {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                            </button>
                        </div>
                    </div>

                    {active && (
                        <>
                            <div className="border-t border-border my-1" />
                            <Link href={`/dashboard/workspace`} onClick={() => setOpen(false)}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-secondary/60 text-sm text-muted-foreground hover:text-foreground">
                                <SettingsIcon className="w-3.5 h-3.5" />
                                Workspace settings
                            </Link>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

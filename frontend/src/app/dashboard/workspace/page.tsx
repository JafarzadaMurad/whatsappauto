"use client";

import { useEffect, useState, useCallback } from "react";
import { Building2, Loader2, X, Plus, Trash2, Crown, Shield, User, Eye, Copy, Check, AlertTriangle, Save } from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { useWorkspaceStore } from "@/store/workspaceStore";

interface Member {
    id: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
    user: { id: string; email: string; name: string | null };
}

interface Invitation {
    id: string;
    email: string;
    role: string;
    expiresAt: string;
    createdAt: string;
}

const ROLE_ICON: Record<string, any> = {
    OWNER: Crown,
    ADMIN: Shield,
    MEMBER: User,
    VIEWER: Eye,
};

export default function WorkspaceSettingsPage() {
    const { activeWorkspaceId } = useWorkspaceStore();
    const { user } = useAuthStore();
    const [name, setName] = useState("");
    const [members, setMembers] = useState<Member[]>([]);
    const [invitations, setInvitations] = useState<Invitation[]>([]);
    const [myRole, setMyRole] = useState<string>('MEMBER');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [inviting, setInviting] = useState(false);
    const [showInvite, setShowInvite] = useState(false);
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState<'ADMIN' | 'MEMBER' | 'VIEWER'>('MEMBER');
    const [recentInviteUrl, setRecentInviteUrl] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const canAdmin = myRole === 'OWNER' || myRole === 'ADMIN';
    const isOwner = myRole === 'OWNER';

    const load = useCallback(async () => {
        if (!activeWorkspaceId) return;
        setLoading(true);
        try {
            const r = await api.get(`/workspaces/${activeWorkspaceId}`);
            if (r.data?.success) {
                setName(r.data.workspace.name);
                setMembers(r.data.workspace.members);
                setInvitations(r.data.workspace.invitations || []);
                setMyRole(r.data.role);
            }
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, [activeWorkspaceId]);

    useEffect(() => { load(); }, [load]);

    const saveName = async () => {
        if (!activeWorkspaceId) return;
        setSaving(true);
        try {
            await api.put(`/workspaces/${activeWorkspaceId}`, { name });
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        } finally { setSaving(false); }
    };

    const sendInvite = async () => {
        if (!activeWorkspaceId || !inviteEmail.trim()) return;
        setInviting(true);
        try {
            const r = await api.post(`/workspaces/${activeWorkspaceId}/invitations`, {
                email: inviteEmail.trim(),
                role: inviteRole,
            });
            if (r.data?.success) {
                setInviteEmail("");
                setShowInvite(false);
                const base = typeof window !== 'undefined' ? window.location.origin : '';
                setRecentInviteUrl(base + r.data.acceptUrl);
                await load();
            }
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        } finally { setInviting(false); }
    };

    const cancelInvite = async (id: string) => {
        if (!activeWorkspaceId) return;
        if (!confirm('Cancel this invitation?')) return;
        try {
            await api.delete(`/workspaces/${activeWorkspaceId}/invitations/${id}`);
            await load();
        } catch (e: any) { alert(e.response?.data?.message || e.message); }
    };

    const changeRole = async (memberId: string, role: string) => {
        if (!activeWorkspaceId) return;
        try {
            await api.put(`/workspaces/${activeWorkspaceId}/members/${memberId}`, { role });
            await load();
        } catch (e: any) { alert(e.response?.data?.message || e.message); }
    };

    const removeMember = async (memberId: string, email: string) => {
        if (!activeWorkspaceId) return;
        const isSelf = members.find(m => m.id === memberId)?.user.id === user?.id;
        if (!confirm(isSelf ? 'Leave this workspace?' : `Remove ${email} from the workspace?`)) return;
        try {
            await api.delete(`/workspaces/${activeWorkspaceId}/members/${memberId}`);
            if (isSelf) window.location.href = '/dashboard';
            else await load();
        } catch (e: any) { alert(e.response?.data?.message || e.message); }
    };

    const copyInvite = (url: string) => {
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    if (!activeWorkspaceId) {
        return <div className="text-center text-muted-foreground py-12">No active workspace.</div>;
    }

    if (loading) {
        return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Building2 className="w-5 h-5" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold">Workspace Settings</h1>
                    <p className="text-sm text-muted-foreground">Manage workspace name, members, and invitations.</p>
                </div>
            </div>

            <section className="bg-card border border-border rounded-2xl p-5">
                <h2 className="font-semibold mb-3">General</h2>
                <label className="text-xs text-muted-foreground block mb-1.5">Workspace name</label>
                <div className="flex gap-2">
                    <input value={name} onChange={e => setName(e.target.value)} disabled={!canAdmin}
                        className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm disabled:opacity-60" />
                    {canAdmin && (
                        <button onClick={saveName} disabled={saving}
                            className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2 disabled:opacity-60">
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save
                        </button>
                    )}
                </div>
            </section>

            {recentInviteUrl && (
                <section className="bg-emerald-500/5 border border-emerald-500/30 rounded-2xl p-5">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <p className="font-semibold text-emerald-300 text-sm">Invitation link generated</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Share this link with the invitee. They must sign in with the invited email to accept.</p>
                            <div className="flex gap-2 mt-3">
                                <input readOnly value={recentInviteUrl}
                                    className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-xs font-mono" />
                                <button onClick={() => copyInvite(recentInviteUrl)}
                                    className="bg-card border border-border rounded-lg px-3 py-2 text-xs flex items-center gap-1">
                                    {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                                </button>
                            </div>
                        </div>
                        <button onClick={() => setRecentInviteUrl(null)} className="text-muted-foreground">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </section>
            )}

            <section className="bg-card border border-border rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold">Members ({members.length})</h2>
                    {canAdmin && (
                        <button onClick={() => setShowInvite(s => !s)}
                            className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium">
                            <Plus className="w-3.5 h-3.5" /> Invite member
                        </button>
                    )}
                </div>

                {showInvite && canAdmin && (
                    <div className="mb-3 p-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 space-y-2">
                        <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                            placeholder="Email address"
                            className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-sm" />
                        <div className="flex gap-2">
                            <select value={inviteRole} onChange={e => setInviteRole(e.target.value as any)}
                                className="bg-card border border-border rounded px-2 py-1.5 text-xs">
                                <option value="ADMIN">Admin</option>
                                <option value="MEMBER">Member</option>
                                <option value="VIEWER">Viewer</option>
                            </select>
                            <button onClick={sendInvite} disabled={inviting || !inviteEmail.trim()}
                                className="ml-auto bg-primary text-primary-foreground rounded px-3 py-1.5 text-xs font-medium flex items-center gap-1 disabled:opacity-60">
                                {inviting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Send'}
                            </button>
                            <button onClick={() => { setShowInvite(false); setInviteEmail(""); }}
                                className="text-xs text-muted-foreground hover:text-foreground px-2">Cancel</button>
                        </div>
                    </div>
                )}

                <div className="space-y-1.5">
                    {members.map(m => {
                        const Icon = ROLE_ICON[m.role] || User;
                        const isSelf = m.user.id === user?.id;
                        const editable = canAdmin && m.role !== 'OWNER';
                        return (
                            <div key={m.id} className="flex items-center gap-3 p-3 border border-border rounded-lg bg-secondary/20">
                                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                                    {(m.user.name || m.user.email).charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{m.user.name || m.user.email}{isSelf && <span className="text-xs text-muted-foreground ml-1">(you)</span>}</p>
                                    <p className="text-[11px] text-muted-foreground truncate">{m.user.email}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {editable ? (
                                        <select value={m.role} onChange={e => changeRole(m.id, e.target.value)}
                                            className="bg-card border border-border rounded px-2 py-1 text-xs">
                                            <option value="ADMIN">Admin</option>
                                            <option value="MEMBER">Member</option>
                                            <option value="VIEWER">Viewer</option>
                                        </select>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                            <Icon className="w-3 h-3" />
                                            {m.role.toLowerCase()}
                                        </span>
                                    )}
                                    {(canAdmin && m.role !== 'OWNER') || isSelf ? (
                                        <button onClick={() => removeMember(m.id, m.user.email)}
                                            className="text-muted-foreground hover:text-red-400" title={isSelf ? 'Leave' : 'Remove'}>
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            {invitations.length > 0 && (
                <section className="bg-card border border-border rounded-2xl p-5">
                    <h2 className="font-semibold mb-3">Pending invitations ({invitations.length})</h2>
                    <div className="space-y-1.5">
                        {invitations.map(inv => (
                            <div key={inv.id} className="flex items-center gap-3 p-3 border border-border rounded-lg bg-secondary/20">
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{inv.email}</p>
                                    <p className="text-[11px] text-muted-foreground">
                                        {inv.role.toLowerCase()} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                                    </p>
                                </div>
                                {canAdmin && (
                                    <button onClick={() => cancelInvite(inv.id)} className="text-muted-foreground hover:text-red-400">
                                        <X className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {isOwner && (
                <section className="bg-card border border-red-500/30 rounded-2xl p-5">
                    <h2 className="font-semibold text-red-400 mb-1">Danger zone</h2>
                    <p className="text-xs text-muted-foreground mb-3">Deleting a workspace permanently removes its data. You cannot delete your last workspace.</p>
                    <button onClick={async () => {
                        if (!confirm('Delete this workspace? All data is removed permanently.')) return;
                        try {
                            await api.delete(`/workspaces/${activeWorkspaceId}`);
                            window.location.href = '/dashboard';
                        } catch (e: any) { alert(e.response?.data?.message || e.message); }
                    }} className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-red-500/20">
                        Delete workspace
                    </button>
                </section>
            )}
        </div>
    );
}

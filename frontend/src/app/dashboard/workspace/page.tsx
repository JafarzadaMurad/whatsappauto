"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Building2, Loader2, X, Plus, Trash2, Crown, Eye, Copy, Check, AlertTriangle, Save, ShieldCheck, Users, Cog, Pencil } from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { useWorkspaceStore } from "@/store/workspaceStore";

interface CustomRole { id: string; name: string }
interface Member {
    id: string;
    role: string;
    roleId: string | null;
    customRole: CustomRole | null;
    user: { id: string; email: string; name: string | null };
}
interface Invitation {
    id: string;
    email: string;
    role: string;
    roleId: string | null;
    customRole: CustomRole | null;
    expiresAt: string;
    createdAt: string;
}
interface WorkspaceRole {
    id: string;
    name: string;
    description: string | null;
    permissions: any;
    isSystem: boolean;
    _count?: { members: number; invitations: number };
}
interface SectionDef { key: string; label: string; verbs: Array<'view' | 'create' | 'update' | 'delete'> }
interface MetaDef    { key: 'manageRoles' | 'inviteMembers' | 'manageWorkspace'; label: string }

type Tab = 'general' | 'members' | 'roles' | 'danger';

const VERB_LABEL: Record<string, string> = { view: 'View', create: 'Create', update: 'Update', delete: 'Delete' };

export default function WorkspaceSettingsPage() {
    const { activeWorkspaceId } = useWorkspaceStore();
    const { user } = useAuthStore();
    const [tab, setTab] = useState<Tab>('general');

    // ─── workspace state ───
    const [name, setName] = useState("");
    const [members, setMembers] = useState<Member[]>([]);
    const [invitations, setInvitations] = useState<Invitation[]>([]);
    const [myRole, setMyRole] = useState<string>('MEMBER');
    const [myPerms, setMyPerms] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // ─── invite state ───
    const [inviting, setInviting] = useState(false);
    const [showInvite, setShowInvite] = useState(false);
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRoleId, setInviteRoleId] = useState<string>("");
    const [recentInviteUrl, setRecentInviteUrl] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // ─── roles state ───
    const [roles, setRoles] = useState<WorkspaceRole[]>([]);
    const [catalog, setCatalog] = useState<{ sections: SectionDef[]; metaFlags: MetaDef[] } | null>(null);
    const [editingRole, setEditingRole] = useState<WorkspaceRole | null>(null);

    const isOwner = myRole === 'OWNER';
    const canManageRoles = isOwner || !!myPerms?.meta?.manageRoles;
    const canInvite      = isOwner || !!myPerms?.meta?.inviteMembers;
    const canManageWs    = isOwner || !!myPerms?.meta?.manageWorkspace;

    // ─── data loading ───
    const load = useCallback(async () => {
        if (!activeWorkspaceId) return;
        setLoading(true);
        try {
            const [wsRes, rolesRes, catRes] = await Promise.all([
                api.get(`/workspaces/${activeWorkspaceId}`),
                api.get(`/workspaces/${activeWorkspaceId}/roles`),
                api.get(`/workspaces/roles/catalog`),
            ]);
            if (wsRes.data?.success) {
                setName(wsRes.data.workspace.name);
                setMembers(wsRes.data.workspace.members);
                setInvitations(wsRes.data.workspace.invitations || []);
                setMyRole(wsRes.data.role);
                setMyPerms(wsRes.data.permissions);
            }
            if (rolesRes.data?.success) {
                setRoles(rolesRes.data.roles);
                const member = rolesRes.data.roles.find((r: WorkspaceRole) => r.name === 'Member');
                if (member && !inviteRoleId) setInviteRoleId(member.id);
            }
            if (catRes.data?.success) {
                setCatalog({ sections: catRes.data.sections, metaFlags: catRes.data.metaFlags });
            }
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, [activeWorkspaceId, inviteRoleId]);

    useEffect(() => { load(); }, [activeWorkspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── workspace mutations ───
    const saveName = async () => {
        if (!activeWorkspaceId) return;
        setSaving(true);
        try { await api.put(`/workspaces/${activeWorkspaceId}`, { name }); }
        catch (e: any) { alert(e.response?.data?.message || e.message); }
        finally { setSaving(false); }
    };

    const sendInvite = async () => {
        if (!activeWorkspaceId || !inviteEmail.trim() || !inviteRoleId) return;
        setInviting(true);
        try {
            const r = await api.post(`/workspaces/${activeWorkspaceId}/invitations`, {
                email: inviteEmail.trim(),
                roleId: inviteRoleId,
            });
            if (r.data?.success) {
                setInviteEmail("");
                setShowInvite(false);
                const base = typeof window !== 'undefined' ? window.location.origin : '';
                setRecentInviteUrl(base + r.data.acceptUrl);
                await load();
            }
        } catch (e: any) { alert(e.response?.data?.message || e.message); }
        finally { setInviting(false); }
    };

    const cancelInvite = async (id: string) => {
        if (!activeWorkspaceId || !confirm('Cancel this invitation?')) return;
        try { await api.delete(`/workspaces/${activeWorkspaceId}/invitations/${id}`); await load(); }
        catch (e: any) { alert(e.response?.data?.message || e.message); }
    };

    const changeMemberRole = async (memberId: string, roleId: string) => {
        if (!activeWorkspaceId) return;
        try { await api.put(`/workspaces/${activeWorkspaceId}/members/${memberId}`, { roleId }); await load(); }
        catch (e: any) { alert(e.response?.data?.message || e.message); }
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

    // ─── role mutations ───
    const saveRole = async (role: WorkspaceRole, fields: Partial<WorkspaceRole>) => {
        if (!activeWorkspaceId) return;
        try {
            const body: any = {};
            if (fields.name !== undefined && !role.isSystem) body.name = fields.name;
            if (fields.description !== undefined) body.description = fields.description;
            if (fields.permissions !== undefined) body.permissions = fields.permissions;
            await api.put(`/workspaces/${activeWorkspaceId}/roles/${role.id}`, body);
            setEditingRole(null);
            await load();
        } catch (e: any) { alert(e.response?.data?.message || e.message); }
    };

    const createRole = async () => {
        if (!activeWorkspaceId || !catalog) return;
        const blank: any = { sections: {}, chat: { view: false, write: false }, meta: { manageRoles: false, inviteMembers: false, manageWorkspace: false } };
        catalog.sections.forEach(s => {
            blank.sections[s.key] = {};
            s.verbs.forEach(v => { blank.sections[s.key][v] = false; });
        });
        const name = prompt('Role name?')?.trim();
        if (!name) return;
        try {
            await api.post(`/workspaces/${activeWorkspaceId}/roles`, {
                name, description: null, permissions: blank,
            });
            await load();
        } catch (e: any) { alert(e.response?.data?.message || e.message); }
    };

    const deleteRole = async (role: WorkspaceRole) => {
        if (!activeWorkspaceId) return;
        if (!confirm(`Delete role "${role.name}"?`)) return;
        try { await api.delete(`/workspaces/${activeWorkspaceId}/roles/${role.id}`); await load(); }
        catch (e: any) { alert(e.response?.data?.message || e.message); }
    };

    // ─── render guards ───
    if (!activeWorkspaceId) return <div className="text-center text-muted-foreground py-12">No active workspace.</div>;
    if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

    const tabs: Array<{ id: Tab; label: string; icon: any; hidden?: boolean }> = [
        { id: 'general', label: 'General',    icon: Cog },
        { id: 'members', label: 'Members',    icon: Users },
        { id: 'roles',   label: 'Roles',      icon: ShieldCheck, hidden: !canManageRoles },
        { id: 'danger',  label: 'Danger',     icon: AlertTriangle, hidden: !isOwner },
    ];

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Building2 className="w-5 h-5" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold">Workspace Settings</h1>
                    <p className="text-sm text-muted-foreground">Manage workspace name, members, roles, and permissions.</p>
                </div>
            </div>

            <div className="flex flex-wrap gap-1 border-b border-border">
                {tabs.filter(t => !t.hidden).map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                        <t.icon className="w-4 h-4" /> {t.label}
                    </button>
                ))}
            </div>

            {tab === 'general' && (
                <section className="bg-card border border-border rounded-2xl p-5">
                    <h2 className="font-semibold mb-3">Workspace name</h2>
                    <div className="flex gap-2">
                        <input value={name} onChange={e => setName(e.target.value)} disabled={!canManageWs}
                            className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm disabled:opacity-60" />
                        {canManageWs && (
                            <button onClick={saveName} disabled={saving}
                                className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2 disabled:opacity-60">
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Save
                            </button>
                        )}
                    </div>
                </section>
            )}

            {tab === 'members' && (
                <>
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
                            {canInvite && (
                                <button onClick={() => setShowInvite(s => !s)}
                                    className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium">
                                    <Plus className="w-3.5 h-3.5" /> Invite member
                                </button>
                            )}
                        </div>

                        {showInvite && canInvite && (
                            <div className="mb-3 p-3 rounded-lg border border-dashed border-primary/40 bg-primary/5 space-y-2">
                                <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                                    placeholder="Email address"
                                    className="w-full bg-card border border-border rounded px-2.5 py-1.5 text-sm" />
                                <div className="flex gap-2">
                                    <select value={inviteRoleId} onChange={e => setInviteRoleId(e.target.value)}
                                        className="bg-card border border-border rounded px-2 py-1.5 text-xs">
                                        {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                    </select>
                                    <button onClick={sendInvite} disabled={inviting || !inviteEmail.trim() || !inviteRoleId}
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
                                const isSelf = m.user.id === user?.id;
                                const isOwnerRow = m.role === 'OWNER';
                                const editable = canManageRoles && !isOwnerRow;
                                const roleLabel = isOwnerRow ? 'Owner' : (m.customRole?.name || m.role);
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
                                                <select value={m.roleId || ''} onChange={e => changeMemberRole(m.id, e.target.value)}
                                                    className="bg-card border border-border rounded px-2 py-1 text-xs">
                                                    {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                                </select>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                                    {isOwnerRow ? <Crown className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                                    {roleLabel}
                                                </span>
                                            )}
                                            {(!isOwnerRow && (canManageRoles || isSelf)) ? (
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
                                                {(inv.customRole?.name || inv.role).toLowerCase()} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                                            </p>
                                        </div>
                                        {canInvite && (
                                            <button onClick={() => cancelInvite(inv.id)} className="text-muted-foreground hover:text-red-400">
                                                <X className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </>
            )}

            {tab === 'roles' && catalog && (
                <RolesTab
                    roles={roles}
                    catalog={catalog}
                    editingRole={editingRole}
                    setEditingRole={setEditingRole}
                    onCreate={createRole}
                    onSave={saveRole}
                    onDelete={deleteRole}
                />
            )}

            {tab === 'danger' && isOwner && (
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

function RolesTab(props: {
    roles: WorkspaceRole[];
    catalog: { sections: SectionDef[]; metaFlags: MetaDef[] };
    editingRole: WorkspaceRole | null;
    setEditingRole: (r: WorkspaceRole | null) => void;
    onCreate: () => void;
    onSave: (r: WorkspaceRole, fields: Partial<WorkspaceRole>) => Promise<void>;
    onDelete: (r: WorkspaceRole) => void;
}) {
    const { roles, catalog, editingRole, setEditingRole, onCreate, onSave, onDelete } = props;

    return (
        <section className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <h2 className="font-semibold">Roles</h2>
                    <p className="text-xs text-muted-foreground">Define per-feature access. Members keep the role you assign them.</p>
                </div>
                <button onClick={onCreate}
                    className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium">
                    <Plus className="w-3.5 h-3.5" /> New role
                </button>
            </div>

            <div className="space-y-2">
                {roles.map(r => (
                    <div key={r.id} className="border border-border rounded-xl bg-secondary/10">
                        <div className="flex items-center gap-3 p-3">
                            <ShieldCheck className={`w-4 h-4 ${r.isSystem ? 'text-primary' : 'text-muted-foreground'}`} />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">{r.name} {r.isSystem && <span className="ml-1 text-[10px] uppercase text-muted-foreground tracking-wide">system</span>}</p>
                                <p className="text-[11px] text-muted-foreground">
                                    {(r._count?.members ?? 0)} member(s) · {(r._count?.invitations ?? 0)} invite(s)
                                    {r.description ? ` · ${r.description}` : ''}
                                </p>
                            </div>
                            <button onClick={() => setEditingRole(editingRole?.id === r.id ? null : r)}
                                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                                <Pencil className="w-3.5 h-3.5" /> {editingRole?.id === r.id ? 'Close' : 'Edit'}
                            </button>
                            {!r.isSystem && (
                                <button onClick={() => onDelete(r)} className="text-muted-foreground hover:text-red-400">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                        {editingRole?.id === r.id && (
                            <RoleEditor role={r} catalog={catalog} onSave={(f) => onSave(r, f)} onCancel={() => setEditingRole(null)} />
                        )}
                    </div>
                ))}
            </div>
        </section>
    );
}

function RoleEditor(props: {
    role: WorkspaceRole;
    catalog: { sections: SectionDef[]; metaFlags: MetaDef[] };
    onSave: (fields: Partial<WorkspaceRole>) => Promise<void>;
    onCancel: () => void;
}) {
    const { role, catalog, onSave, onCancel } = props;

    const initial = useMemo(() => {
        const perms: any = role.permissions || {};
        const sections: Record<string, Record<string, boolean>> = {};
        catalog.sections.forEach(s => {
            sections[s.key] = {};
            s.verbs.forEach(v => { sections[s.key][v] = !!perms?.sections?.[s.key]?.[v]; });
        });
        const chat = { view: !!perms?.chat?.view, write: !!perms?.chat?.write };
        const meta: any = {};
        catalog.metaFlags.forEach(m => { meta[m.key] = !!perms?.meta?.[m.key]; });
        return { name: role.name, description: role.description || '', sections, chat, meta };
    }, [role, catalog]);

    const [draft, setDraft] = useState(initial);
    const [busy, setBusy] = useState(false);

    const toggleSection = (key: string, verb: string) =>
        setDraft(d => ({ ...d, sections: { ...d.sections, [key]: { ...d.sections[key], [verb]: !d.sections[key][verb] } } }));

    const toggleChat = (verb: 'view' | 'write') =>
        setDraft(d => ({ ...d, chat: { ...d.chat, [verb]: !d.chat[verb] } }));

    const toggleMeta = (key: string) =>
        setDraft(d => ({ ...d, meta: { ...d.meta, [key]: !d.meta[key] } }));

    const submit = async () => {
        setBusy(true);
        try {
            await onSave({
                name: draft.name,
                description: draft.description,
                permissions: { sections: draft.sections, chat: draft.chat, meta: draft.meta },
            });
        } finally { setBusy(false); }
    };

    return (
        <div className="border-t border-border p-4 space-y-4 bg-card/40">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                    <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Name</label>
                    <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} disabled={role.isSystem}
                        className="w-full mt-1 bg-secondary/40 border border-border rounded px-2.5 py-1.5 text-sm disabled:opacity-60" />
                </div>
                <div>
                    <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Description</label>
                    <input value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                        className="w-full mt-1 bg-secondary/40 border border-border rounded px-2.5 py-1.5 text-sm" />
                </div>
            </div>

            <div>
                <h3 className="text-xs font-semibold text-muted-foreground mb-2">Section access</h3>
                <div className="border border-border rounded-lg overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-secondary/40">
                            <tr>
                                <th className="text-left px-3 py-2 font-medium">Section</th>
                                <th className="px-3 py-2 w-16 font-medium">View</th>
                                <th className="px-3 py-2 w-16 font-medium">Create</th>
                                <th className="px-3 py-2 w-16 font-medium">Update</th>
                                <th className="px-3 py-2 w-16 font-medium">Delete</th>
                            </tr>
                        </thead>
                        <tbody>
                            {catalog.sections.map(s => (
                                <tr key={s.key} className="border-t border-border">
                                    <td className="px-3 py-2 text-foreground">{s.label}</td>
                                    {(['view', 'create', 'update', 'delete'] as const).map(v => (
                                        <td key={v} className="px-3 py-2 text-center">
                                            {s.verbs.includes(v) ? (
                                                <input type="checkbox" checked={!!draft.sections[s.key]?.[v]} onChange={() => toggleSection(s.key, v)} />
                                            ) : <span className="text-muted-foreground/40">—</span>}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div>
                <h3 className="text-xs font-semibold text-muted-foreground mb-2">Chat (inbox)</h3>
                <div className="flex gap-4">
                    <label className="inline-flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={draft.chat.view} onChange={() => toggleChat('view')} />
                        See chats
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={draft.chat.write} onChange={() => toggleChat('write')} />
                        Reply / send messages
                    </label>
                </div>
            </div>

            <div>
                <h3 className="text-xs font-semibold text-muted-foreground mb-2">Administrative</h3>
                <div className="flex flex-wrap gap-4">
                    {catalog.metaFlags.map(f => (
                        <label key={f.key} className="inline-flex items-center gap-2 text-xs">
                            <input type="checkbox" checked={!!draft.meta[f.key]} onChange={() => toggleMeta(f.key)} />
                            {f.label}
                        </label>
                    ))}
                </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5">Cancel</button>
                <button onClick={submit} disabled={busy}
                    className="bg-primary text-primary-foreground rounded px-4 py-1.5 text-xs font-medium flex items-center gap-1.5 disabled:opacity-60">
                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    Save role
                </button>
            </div>
        </div>
    );
}

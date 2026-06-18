// Granular workspace permission model.
//
// A workspace member's access is the union of (a) the implicit OWNER status
// (Workspace.ownerId === user.id → all access) and (b) the permission matrix
// stored on their assigned WorkspaceRole.
//
// Sections map roughly 1:1 to the sidebar entries in the dashboard. Adding
// a new section here also makes it appear in the role editor automatically.

export type CrudFlag = 'view' | 'create' | 'update' | 'delete';

export type SectionPermission = Partial<Record<CrudFlag, boolean>>;

export type ChatPermission = {
    view?: boolean;
    write?: boolean;
};

export type MetaPermission = {
    manageRoles?: boolean;
    inviteMembers?: boolean;
    manageWorkspace?: boolean;
};

export type RolePermissions = {
    sections?: Record<string, SectionPermission>;
    chat?: ChatPermission;
    meta?: MetaPermission;
};

// Canonical section catalog. Each section has a human-readable label and the
// CRUD verbs it actually supports — the role editor uses this to render
// only the relevant checkboxes per row.
export const SECTIONS: Array<{
    key: string;
    label: string;
    verbs: CrudFlag[];
}> = [
    { key: 'dashboard',   label: 'Dashboard',     verbs: ['view'] },
    { key: 'inbox',       label: 'Inbox',         verbs: ['view'] },
    { key: 'whatsapp',    label: 'WhatsApp',      verbs: ['view', 'create', 'update', 'delete'] },
    { key: 'instagram',   label: 'Instagram',     verbs: ['view', 'create', 'update', 'delete'] },
    { key: 'contacts',    label: 'Contacts',      verbs: ['view', 'create', 'update', 'delete'] },
    { key: 'agents',      label: 'AI Agents',     verbs: ['view', 'create', 'update', 'delete'] },
    { key: 'oversight',   label: 'Oversight',     verbs: ['view', 'create', 'update', 'delete'] },
    { key: 'tables',      label: 'Data Tables',   verbs: ['view', 'create', 'update', 'delete'] },
    { key: 'providers',   label: 'AI Providers',  verbs: ['view', 'create', 'update', 'delete'] },
    { key: 'automations', label: 'Automations',   verbs: ['view', 'create', 'update', 'delete'] },
    { key: 'campaigns',   label: 'Campaigns',     verbs: ['view', 'create', 'update', 'delete'] },
    { key: 'apikeys',     label: 'API Keys',      verbs: ['view', 'create', 'delete'] },
    { key: 'mcp',         label: 'MCP',           verbs: ['view', 'create', 'update', 'delete'] },
    { key: 'webhooks',    label: 'Webhooks',      verbs: ['view', 'create', 'update', 'delete'] },
    { key: 'billing',     label: 'Billing',       verbs: ['view'] },
];

export const META_FLAGS: Array<{ key: keyof MetaPermission; label: string }> = [
    { key: 'manageRoles',     label: 'Create / edit roles' },
    { key: 'inviteMembers',   label: 'Invite members to workspace' },
    { key: 'manageWorkspace', label: 'Rename / configure workspace' },
];

// Permission templates used to seed system roles per workspace.
function allTrue(verbs: CrudFlag[]): SectionPermission {
    const out: SectionPermission = {};
    verbs.forEach(v => { out[v] = true; });
    return out;
}

function viewOnly(verbs: CrudFlag[]): SectionPermission {
    return verbs.includes('view') ? { view: true } : {};
}

function buildAllSections(builder: (verbs: CrudFlag[]) => SectionPermission) {
    const sections: Record<string, SectionPermission> = {};
    SECTIONS.forEach(s => { sections[s.key] = builder(s.verbs); });
    return sections;
}

export function adminTemplate(): RolePermissions {
    return {
        sections: buildAllSections(allTrue),
        chat: { view: true, write: true },
        meta: { manageRoles: true, inviteMembers: true, manageWorkspace: true },
    };
}

export function memberTemplate(): RolePermissions {
    return {
        sections: buildAllSections(allTrue),
        chat: { view: true, write: true },
        meta: { manageRoles: false, inviteMembers: false, manageWorkspace: false },
    };
}

export function viewerTemplate(): RolePermissions {
    return {
        sections: buildAllSections(viewOnly),
        chat: { view: true, write: false },
        meta: { manageRoles: false, inviteMembers: false, manageWorkspace: false },
    };
}

export const SYSTEM_ROLES: Array<{ name: string; description: string; permissions: RolePermissions }> = [
    { name: 'Admin',  description: 'Full access including role and workspace management.', permissions: adminTemplate() },
    { name: 'Member', description: 'Full feature access without administrative control.',  permissions: memberTemplate() },
    { name: 'Viewer', description: 'Read-only access. Can see chats but cannot reply.',     permissions: viewerTemplate() },
];

// Runtime permission resolution. `null` permissions means OWNER (all access).
export function hasSection(perms: RolePermissions | null, section: string, verb: CrudFlag): boolean {
    if (perms === null) return true; // owner shortcut
    const s = perms.sections?.[section];
    return !!(s && s[verb]);
}

export function canViewChat(perms: RolePermissions | null): boolean {
    if (perms === null) return true;
    return !!perms.chat?.view;
}

export function canWriteChat(perms: RolePermissions | null): boolean {
    if (perms === null) return true;
    return !!perms.chat?.write;
}

export function hasMeta(perms: RolePermissions | null, flag: keyof MetaPermission): boolean {
    if (perms === null) return true;
    return !!perms.meta?.[flag];
}

// Light-weight validator used by the role editor endpoint. Strips unknown
// keys and coerces missing flags to false so the stored JSON is canonical.
export function sanitizePermissions(input: any): RolePermissions {
    const out: RolePermissions = { sections: {}, chat: {}, meta: {} };
    const src = input && typeof input === 'object' ? input : {};
    SECTIONS.forEach(s => {
        const row = (src.sections || {})[s.key] || {};
        const entry: SectionPermission = {};
        s.verbs.forEach(v => { entry[v] = !!row[v]; });
        out.sections![s.key] = entry;
    });
    out.chat = {
        view:  !!(src.chat?.view),
        write: !!(src.chat?.write),
    };
    out.meta = {
        manageRoles:     !!(src.meta?.manageRoles),
        inviteMembers:   !!(src.meta?.inviteMembers),
        manageWorkspace: !!(src.meta?.manageWorkspace),
    };
    return out;
}

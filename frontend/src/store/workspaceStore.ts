import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Permission matrix mirror of backend `RolePermissions`. `permissions === null`
// when the user is the workspace owner — they always have full access and
// the matrix is bypassed entirely.
export interface RolePermissions {
    sections?: Record<string, { view?: boolean; create?: boolean; update?: boolean; delete?: boolean }>;
    chat?: { view?: boolean; write?: boolean };
    meta?: { manageRoles?: boolean; inviteMembers?: boolean; manageWorkspace?: boolean };
}

export interface WorkspaceSummary {
    id: string;
    name: string;
    ownerId: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | string;
    roleName?: string | null;
    permissions?: RolePermissions | null;
    isOwner: boolean;
    planId?: string | null;
    subscriptionStatus?: string;
}

interface WorkspaceState {
    workspaces: WorkspaceSummary[];
    activeWorkspaceId: string | null;
    hasHydrated: boolean;
    setWorkspaces: (ws: WorkspaceSummary[]) => void;
    setActiveWorkspace: (id: string) => void;
    setHasHydrated: (v: boolean) => void;
    reset: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
    persist(
        (set, get) => ({
            workspaces: [],
            activeWorkspaceId: null,
            hasHydrated: false,
            setWorkspaces: (workspaces) => {
                const current = get().activeWorkspaceId;
                // If the previously-active workspace no longer exists, fall back to the first.
                const stillExists = current && workspaces.find(w => w.id === current);
                set({
                    workspaces,
                    activeWorkspaceId: stillExists ? current : (workspaces[0]?.id || null),
                });
            },
            setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
            setHasHydrated: (v) => set({ hasHydrated: v }),
            reset: () => set({ workspaces: [], activeWorkspaceId: null }),
        }),
        {
            name: 'alchatbot-workspace-storage',
            onRehydrateStorage: () => (state) => { state?.setHasHydrated(true); },
        }
    )
);

// Permission shortcuts. Always resolved against the active workspace.
function active(): WorkspaceSummary | null {
    const { activeWorkspaceId, workspaces } = useWorkspaceStore.getState();
    return workspaces.find(w => w.id === activeWorkspaceId) || null;
}

export function canPerm(section: string, verb: 'view' | 'create' | 'update' | 'delete' = 'view'): boolean {
    const w = active();
    if (!w) return false;
    if (w.isOwner) return true;
    const flags = w.permissions?.sections?.[section];
    return !!(flags && flags[verb]);
}

export function canChatView(): boolean {
    const w = active();
    if (!w) return false;
    if (w.isOwner) return true;
    return !!w.permissions?.chat?.view;
}

export function canChatWrite(): boolean {
    const w = active();
    if (!w) return false;
    if (w.isOwner) return true;
    return !!w.permissions?.chat?.write;
}

export function canMetaFlag(flag: 'manageRoles' | 'inviteMembers' | 'manageWorkspace'): boolean {
    const w = active();
    if (!w) return false;
    if (w.isOwner) return true;
    return !!w.permissions?.meta?.[flag];
}

// Hook variants — re-render the component when the active workspace
// changes. Components should prefer these over the bare functions to
// stay reactive.
export const usePerm = (section: string, verb: 'view' | 'create' | 'update' | 'delete' = 'view') => {
    const id = useWorkspaceStore(s => s.activeWorkspaceId);
    const list = useWorkspaceStore(s => s.workspaces);
    const w = list.find(x => x.id === id);
    if (!w) return false;
    if (w.isOwner) return true;
    return !!(w.permissions?.sections?.[section]?.[verb]);
};

export const usePermChatView = () => {
    const id = useWorkspaceStore(s => s.activeWorkspaceId);
    const list = useWorkspaceStore(s => s.workspaces);
    const w = list.find(x => x.id === id);
    if (!w) return false;
    return w.isOwner || !!w.permissions?.chat?.view;
};

export const usePermChatWrite = () => {
    const id = useWorkspaceStore(s => s.activeWorkspaceId);
    const list = useWorkspaceStore(s => s.workspaces);
    const w = list.find(x => x.id === id);
    if (!w) return false;
    return w.isOwner || !!w.permissions?.chat?.write;
};

export const usePermMeta = (flag: 'manageRoles' | 'inviteMembers' | 'manageWorkspace') => {
    const id = useWorkspaceStore(s => s.activeWorkspaceId);
    const list = useWorkspaceStore(s => s.workspaces);
    const w = list.find(x => x.id === id);
    if (!w) return false;
    return w.isOwner || !!w.permissions?.meta?.[flag];
};

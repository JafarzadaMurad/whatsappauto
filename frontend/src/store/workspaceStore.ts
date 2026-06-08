import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface WorkspaceSummary {
    id: string;
    name: string;
    ownerId: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
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

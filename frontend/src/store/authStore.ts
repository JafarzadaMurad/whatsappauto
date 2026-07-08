import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
    id: string;
    name?: string;
    email: string;
    role?: string;
    emailVerified?: boolean;
    // Admin-managed per-user visibility. Section keys listed in
    // hiddenSections are removed from the sidebar entirely; entries in
    // lockedSections still render with a lock icon and gated route.
    hiddenSections?: string[];
    lockedSections?: string[];
}

interface AuthState {
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;
    hasHydrated: boolean;
    login: (user: User, token: string) => void;
    logout: () => void;
    setHasHydrated: (state: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            user: null,
            token: null,
            isAuthenticated: false,
            hasHydrated: false,
            login: (user, token) => set({ user, token, isAuthenticated: true }),
            logout: () => set({ user: null, token: null, isAuthenticated: false }),
            setHasHydrated: (state) => set({ hasHydrated: state }),
        }),
        {
            name: 'alchatbot-auth-storage',
            onRehydrateStorage: () => (state) => {
                state?.setHasHydrated(true);
            }
        }
    )
);

import io, { Socket } from "socket.io-client";

/**
 * Central helper for opening a Socket.IO connection to the backend.
 *
 * Backends now scope every emit to `workspace:<id>` rooms. The client
 * has to hand the server its JWT + current workspace on the handshake
 * so the socket joins the right room. Without both, the socket connects
 * fine but sees no events — bugs like "inbox goes quiet" become silent
 * failures, so we route every callsite through this helper.
 *
 * Reads the token straight out of the Zustand-persisted auth blob so we
 * don't need the store's setter here. Workspace id comes from the
 * workspace store, or from an override.
 */
// The persisted key. This read used to say `auth-storage` while the
// store writes `alchatbot-auth-storage`, so the token was always null:
// every socket connected unauthenticated, joined no rooms, and quietly
// received nothing. Kept as a named constant so the two can't drift
// apart again without it being obvious.
const AUTH_STORAGE_KEY = 'alchatbot-auth-storage';
const WORKSPACE_STORAGE_KEY = 'alchatbot-workspace-storage';
export function createSocket(opts?: { workspaceId?: string | null }): Socket {
    const base = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/api\/?$/, '') || window.location.origin;
    let token: string | null = null;
    let workspaceId: string | null = opts?.workspaceId ?? null;
    if (typeof window !== 'undefined') {
        try {
            const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                token = parsed?.state?.token || null;
            }
        } catch { /* corrupt storage — fall through unauthenticated */ }
        if (!workspaceId) {
            // Zustand persists the workspace store under
            // `alchatbot-workspace-storage` — see workspaceStore.ts. We
            // pull `activeWorkspaceId` out of that blob so the handshake
            // joins the correct room. Old plain `workspaceId` key kept
            // as a last-ditch fallback for pre-Zustand builds.
            try {
                const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    workspaceId = parsed?.state?.activeWorkspaceId || null;
                }
            } catch { /* ignore */ }
            if (!workspaceId) {
                try { workspaceId = window.localStorage.getItem('workspaceId'); } catch { /* ignore */ }
            }
        }
    }
    return io(base, {
        transports: ['websocket'],
        auth: { token, workspaceId },
    });
}

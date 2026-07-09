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
 * Reads the token from localStorage (Zustand-persisted `auth-storage`)
 * so we don't need the store's setter here. Workspace id comes from the
 * same source or from an override.
 */
export function createSocket(opts?: { workspaceId?: string | null }): Socket {
    const base = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/api\/?$/, '') || window.location.origin;
    let token: string | null = null;
    let workspaceId: string | null = opts?.workspaceId ?? null;
    if (typeof window !== 'undefined') {
        try {
            const raw = window.localStorage.getItem('auth-storage');
            if (raw) {
                const parsed = JSON.parse(raw);
                token = parsed?.state?.token || null;
            }
        } catch { /* corrupt storage — fall through unauthenticated */ }
        if (!workspaceId) {
            try {
                workspaceId = window.localStorage.getItem('workspaceId');
            } catch { /* ignore */ }
        }
    }
    return io(base, {
        transports: ['websocket'],
        auth: { token, workspaceId },
    });
}

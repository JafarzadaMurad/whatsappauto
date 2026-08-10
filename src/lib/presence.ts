// Who is using the platform right now, and where.
//
// Kept in memory rather than in a table. Presence is worthless five
// minutes after the fact and would otherwise be the single busiest write
// in the database — every route change from every open tab. What is worth
// keeping (last seen, page history) is small enough to hold per user, and
// dies with the process, which is the correct lifetime for "who is online".
//
// One person can have several tabs. They are tracked per socket and
// collapsed per user on read, because "Murad is on /dashboard/inbox" is
// the useful sentence, not "socket a7f3 is".

import { logger } from '../utils/logger';

export type PresenceSocket = {
    socketId: string;
    userId: string;
    workspaceId: string | null;
    path: string | null;
    connectedAt: number;
    lastSeenAt: number;
    userAgent: string | null;
    ip: string | null;
};

export type PresenceUser = {
    userId: string;
    workspaceId: string | null;
    /** Where their most recently active tab is. */
    path: string | null;
    tabs: number;
    connectedAt: number;
    lastSeenAt: number;
    userAgent: string | null;
    ip: string | null;
    /** Recent pages, newest first. Capped — this is a trail, not an archive. */
    recentPaths: { path: string; at: number }[];
};

const sockets = new Map<string, PresenceSocket>();

// Page trails outlive the socket, so a tab that reconnects (laptop lid,
// flaky wifi, a deploy) doesn't lose where the person has been.
const trails = new Map<string, { path: string; at: number }[]>();
const TRAIL_LIMIT = 25;

// Last seen for people who have since closed every tab. Bounded so a busy
// month can't grow it without limit.
const lastSeen = new Map<string, { at: number; path: string | null; workspaceId: string | null }>();
const LAST_SEEN_LIMIT = 500;

export function presenceConnect(s: {
    socketId: string; userId: string; workspaceId: string | null;
    userAgent?: string | null; ip?: string | null;
}) {
    const now = Date.now();
    sockets.set(s.socketId, {
        socketId: s.socketId,
        userId: s.userId,
        workspaceId: s.workspaceId,
        path: null,
        connectedAt: now,
        lastSeenAt: now,
        userAgent: s.userAgent || null,
        ip: s.ip || null,
    });
}

export function presenceDisconnect(socketId: string) {
    const s = sockets.get(socketId);
    if (!s) return;
    sockets.delete(socketId);

    // Only record last-seen once their final tab goes; otherwise closing
    // one of three tabs would read as leaving.
    const stillHere = [...sockets.values()].some(x => x.userId === s.userId);
    if (!stillHere) {
        lastSeen.set(s.userId, { at: Date.now(), path: s.path, workspaceId: s.workspaceId });
        if (lastSeen.size > LAST_SEEN_LIMIT) {
            // Drop the oldest. Map preserves insertion order, and every
            // write re-inserts, so the first key is the least recent.
            const oldest = lastSeen.keys().next().value;
            if (oldest) lastSeen.delete(oldest);
        }
    }
}

/** The browser reports a route change. Also serves as a heartbeat. */
export function presencePage(socketId: string, path: string) {
    const s = sockets.get(socketId);
    if (!s) return;
    const cleaned = String(path || '').slice(0, 200);
    const now = Date.now();
    s.lastSeenAt = now;
    if (s.path === cleaned) return;   // a re-render is not a navigation
    s.path = cleaned;

    const trail = trails.get(s.userId) || [];
    trail.unshift({ path: cleaned, at: now });
    trails.set(s.userId, trail.slice(0, TRAIL_LIMIT));
}

export function presenceHeartbeat(socketId: string) {
    const s = sockets.get(socketId);
    if (s) s.lastSeenAt = Date.now();
}

/** Everyone with at least one open tab, most recently active first. */
export function onlineUsers(): PresenceUser[] {
    const byUser = new Map<string, PresenceUser>();

    for (const s of sockets.values()) {
        const existing = byUser.get(s.userId);
        if (!existing) {
            byUser.set(s.userId, {
                userId: s.userId,
                workspaceId: s.workspaceId,
                path: s.path,
                tabs: 1,
                connectedAt: s.connectedAt,
                lastSeenAt: s.lastSeenAt,
                userAgent: s.userAgent,
                ip: s.ip,
                recentPaths: trails.get(s.userId) || [],
            });
            continue;
        }
        existing.tabs++;
        existing.connectedAt = Math.min(existing.connectedAt, s.connectedAt);
        // The page shown is the one they touched last — with three tabs
        // open, that is the one they are actually looking at.
        if (s.lastSeenAt >= existing.lastSeenAt) {
            existing.lastSeenAt = s.lastSeenAt;
            existing.path = s.path;
            existing.workspaceId = s.workspaceId;
        }
    }

    return [...byUser.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

/** People who were here and aren't now. */
export function recentlySeen(): { userId: string; at: number; path: string | null; workspaceId: string | null }[] {
    const online = new Set([...sockets.values()].map(s => s.userId));
    return [...lastSeen.entries()]
        .filter(([userId]) => !online.has(userId))
        .map(([userId, v]) => ({ userId, ...v }))
        .sort((a, b) => b.at - a.at);
}

export function presenceStats() {
    const users = onlineUsers();
    return {
        onlineUsers: users.length,
        openTabs: sockets.size,
    };
}

// A socket that dies without a disconnect event (a killed browser, a
// dropped network) would otherwise sit in the map forever, showing
// somebody as online days after they left.
const STALE_MS = 5 * 60_000;

export function startPresenceSweeper(intervalMs = 60_000) {
    setInterval(() => {
        const cutoff = Date.now() - STALE_MS;
        let dropped = 0;
        for (const [id, s] of sockets) {
            if (s.lastSeenAt < cutoff) { presenceDisconnect(id); dropped++; }
        }
        if (dropped) logger.debug(`[presence] swept ${dropped} stale socket(s)`);
    }, intervalMs).unref?.();
}

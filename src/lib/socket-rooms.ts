import { io } from '../server';
import { prisma } from './prisma';

// instanceId / accountId → workspaceId cache. Populated by the WhatsApp
// instance manager on startInstance (and lazily on first IG event) and
// consumed by every hot broadcast path (message.new, poll updates,
// receipts, AI replies) so we don't do a DB lookup on every packet.
const instanceWorkspaces = new Map<string, string | null>();
const igAccountWorkspaces = new Map<string, string | null>();

export function setInstanceWorkspace(instanceId: string, workspaceId: string | null) {
    instanceWorkspaces.set(instanceId, workspaceId);
}
export function forgetInstanceWorkspace(instanceId: string) {
    instanceWorkspaces.delete(instanceId);
}
export function setIgAccountWorkspace(accountId: string, workspaceId: string | null) {
    igAccountWorkspaces.set(accountId, workspaceId);
}

async function ensureInstanceWorkspaceId(instanceId: string): Promise<string | null> {
    const cached = instanceWorkspaces.get(instanceId);
    if (cached !== undefined) return cached;
    try {
        const inst = await prisma.instance.findUnique({
            where: { id: instanceId },
            select: { workspaceId: true },
        });
        const wsId = inst?.workspaceId ?? null;
        instanceWorkspaces.set(instanceId, wsId);
        return wsId;
    } catch {
        return null;
    }
}

async function ensureIgAccountWorkspaceId(accountId: string): Promise<string | null> {
    const cached = igAccountWorkspaces.get(accountId);
    if (cached !== undefined) return cached;
    try {
        const acc = await prisma.instagramAccount.findUnique({
            where: { id: accountId },
            select: { workspaceId: true },
        });
        const wsId = acc?.workspaceId ?? null;
        igAccountWorkspaces.set(accountId, wsId);
        return wsId;
    } catch {
        return null;
    }
}

/**
 * Workspace-scoped emit. Anything sent through here only reaches sockets
 * that joined `workspace:<id>` at handshake time. Falls back to `io.emit`
 * ONLY when the instance's workspace is genuinely unknown (mid-migration
 * rows without a workspaceId) — that path is behind a cache miss so it
 * doesn't spam the DB.
 */
export async function emitToWorkspace(instanceId: string, event: string, payload: any) {
    const wsId = await ensureInstanceWorkspaceId(instanceId);
    if (wsId) io.to(`workspace:${wsId}`).emit(event, payload);
    else io.emit(event, payload);
}

/**
 * Non-awaited flavour. If the workspace is already cached the emit is
 * synchronous (matching the old io.emit semantics). Cache miss falls
 * back to the async path so the caller doesn't stall.
 */
export function emitToWorkspaceSync(instanceId: string, event: string, payload: any) {
    const wsId = instanceWorkspaces.get(instanceId);
    if (wsId) io.to(`workspace:${wsId}`).emit(event, payload);
    else if (wsId === null) io.emit(event, payload);
    else void emitToWorkspace(instanceId, event, payload);
}

// Instagram flavour — same behaviour but keyed by InstagramAccount.id.
export function emitToIgWorkspaceSync(accountId: string, event: string, payload: any) {
    const wsId = igAccountWorkspaces.get(accountId);
    if (wsId) io.to(`workspace:${wsId}`).emit(event, payload);
    else if (wsId === null) io.emit(event, payload);
    else void ensureIgAccountWorkspaceId(accountId).then(id => {
        if (id) io.to(`workspace:${id}`).emit(event, payload);
        else io.emit(event, payload);
    });
}

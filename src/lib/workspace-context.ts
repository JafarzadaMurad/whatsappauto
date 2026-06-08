import type { Request } from 'express';

// All scoped queries should use this helper to fetch the active
// workspace id from the request. The auth middleware always sets it.
export function getWorkspaceId(req: Request): string {
    const id = req.workspaceId;
    if (!id) throw new Error('Workspace id missing on request (auth middleware not run?)');
    return id;
}

export function getUserId(req: Request): string {
    const id = (req as any).user?.id;
    if (!id) throw new Error('User id missing on request (auth middleware not run?)');
    return id;
}

export function getWorkspaceRole(req: Request): string {
    return req.workspaceRole || 'MEMBER';
}

// Permission gates for write operations.
export function canWrite(req: Request): boolean {
    const role = getWorkspaceRole(req);
    return role === 'OWNER' || role === 'ADMIN' || role === 'MEMBER';
}

export function canAdmin(req: Request): boolean {
    const role = getWorkspaceRole(req);
    return role === 'OWNER' || role === 'ADMIN';
}

export function canOwn(req: Request): boolean {
    return getWorkspaceRole(req) === 'OWNER';
}

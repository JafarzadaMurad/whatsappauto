import type { Request, Response, NextFunction } from 'express';
import {
    RolePermissions,
    CrudFlag,
    MetaPermission,
    hasSection,
    hasMeta,
    canViewChat,
    canWriteChat,
} from './permissions';

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

// `permissions` is `null` for the workspace owner — they always have full
// access regardless of any role configuration.
export function getPermissions(req: Request): RolePermissions | null {
    if (req.workspaceRole === 'OWNER') return null;
    return req.workspacePermissions || { sections: {}, chat: {}, meta: {} };
}

export function isOwner(req: Request): boolean {
    return req.workspaceRole === 'OWNER';
}

export function canAccess(req: Request, section: string, verb: CrudFlag = 'view'): boolean {
    return hasSection(getPermissions(req), section, verb);
}

export function canInboxView(req: Request): boolean {
    return canViewChat(getPermissions(req));
}

export function canInboxWrite(req: Request): boolean {
    return canWriteChat(getPermissions(req));
}

export function canMeta(req: Request, flag: keyof MetaPermission): boolean {
    return hasMeta(getPermissions(req), flag);
}

// Legacy helpers — kept so older call sites keep compiling. Prefer
// `canAccess()` and friends for new code.
export function canWrite(req: Request): boolean {
    // "Can do *any* non-view operation in *any* section" — mostly used by
    // very coarse legacy guards. Owner always; otherwise anyone with at
    // least one create/update/delete flag set.
    if (isOwner(req)) return true;
    const perms = getPermissions(req);
    if (!perms?.sections) return false;
    for (const s of Object.values(perms.sections)) {
        if (s.create || s.update || s.delete) return true;
    }
    return false;
}

export function canAdmin(req: Request): boolean {
    return isOwner(req) || canMeta(req, 'manageWorkspace');
}

export function canOwn(req: Request): boolean {
    return isOwner(req);
}

// Express middleware factory. Use as:
//   router.delete('/foo/:id', requirePerm('whatsapp', 'delete'), controller.delete)
export function requirePerm(section: string, verb: CrudFlag = 'view') {
    return (req: Request, res: Response, next: NextFunction) => {
        if (canAccess(req, section, verb)) return next();
        return res.status(403).json({ success: false, message: `Permission denied: ${section}.${verb}` });
    };
}

export function requireMeta(flag: keyof MetaPermission) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (canMeta(req, flag)) return next();
        return res.status(403).json({ success: false, message: `Permission denied: ${flag}` });
    };
}

export function requireChatView(req: Request, res: Response, next: NextFunction) {
    if (canInboxView(req)) return next();
    return res.status(403).json({ success: false, message: 'Permission denied: chat.view' });
}

export function requireChatWrite(req: Request, res: Response, next: NextFunction) {
    if (canInboxWrite(req)) return next();
    return res.status(403).json({ success: false, message: 'Permission denied: chat.write' });
}

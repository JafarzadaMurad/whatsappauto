import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { getOrCreatePersonalWorkspace } from '../lib/workspace-migration';
import { RolePermissions } from '../lib/permissions';

declare module 'express-serve-static-core' {
    interface Request {
        workspaceId?: string;
        workspaceRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | string;
        workspacePermissions?: RolePermissions | null;
    }
}

// Resolves the active workspace + permissions for the request.
// Preference order:
//   1. X-Workspace-Id header (if user is a member)
//   2. The user's personal workspace (created on demand)
async function resolveWorkspace(req: Request, userId: string) {
    const requested = String(req.headers['x-workspace-id'] || '').trim();
    if (requested) {
        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: requested, userId } },
            select: {
                role: true,
                workspaceId: true,
                customRole: { select: { permissions: true } },
                workspace: { select: { ownerId: true } },
            },
        });
        if (member) {
            req.workspaceId = member.workspaceId;
            // Owner is determined by Workspace.ownerId — keep `role` for legacy
            // callers but always treat the actual owner as OWNER.
            const isOwner = member.workspace.ownerId === userId;
            req.workspaceRole = isOwner ? 'OWNER' : (member.role as any);
            req.workspacePermissions = isOwner ? null : ((member.customRole?.permissions as any) || {});
            return;
        }
        // Fall through — header pointed to a workspace the user isn't in.
    }
    const wsId = await getOrCreatePersonalWorkspace(userId);
    req.workspaceId = wsId;
    req.workspaceRole = 'OWNER';
    req.workspacePermissions = null;
}

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const token = authHeader.split(' ')[1];

        // Check if it's an API Key (starts with sk_)
        if (token.startsWith('sk_')) {
            const apiKey = await prisma.apiKey.findUnique({
                where: { key: token },
                include: { user: { select: { id: true, email: true, name: true } } }
            });

            if (!apiKey || !apiKey.user) {
                return res.status(401).json({ success: false, message: 'Invalid API Key' });
            }

            await prisma.apiKey.update({
                where: { id: apiKey.id },
                data: { lastUsedAt: new Date() }
            });

            (req as any).user = apiKey.user;
            if (apiKey.workspaceId) {
                req.workspaceId = apiKey.workspaceId;
                const member = await prisma.workspaceMember.findUnique({
                    where: { workspaceId_userId: { workspaceId: apiKey.workspaceId, userId: apiKey.user.id } },
                    select: {
                        role: true,
                        customRole: { select: { permissions: true } },
                        workspace: { select: { ownerId: true } },
                    },
                });
                const isOwner = member?.workspace?.ownerId === apiKey.user.id;
                req.workspaceRole = (isOwner ? 'OWNER' : (member?.role || 'OWNER')) as any;
                req.workspacePermissions = isOwner ? null : ((member?.customRole?.permissions as any) || null);
            } else {
                await resolveWorkspace(req, apiKey.user.id);
            }
            return next();
        }

        // Otherwise assume it's a JWT
        const decoded = jwt.verify(token, config.JWT_SECRET) as { id: string };

        const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: { id: true, email: true, name: true, role: true, emailVerified: true }
        });

        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid token' });
        }

        (req as any).user = user;
        await resolveWorkspace(req, user.id);
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
};

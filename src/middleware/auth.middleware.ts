import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { getOrCreatePersonalWorkspace } from '../lib/workspace-migration';

declare module 'express-serve-static-core' {
    interface Request {
        workspaceId?: string;
        workspaceRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
    }
}

// Resolves the active workspace for the request.
// Preference order:
//   1. X-Workspace-Id header (if user is a member)
//   2. The user's personal workspace (created on demand)
// Sets req.workspaceId and req.workspaceRole.
async function resolveWorkspace(req: Request, userId: string) {
    const requested = String(req.headers['x-workspace-id'] || '').trim();
    if (requested) {
        const member = await prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId: requested, userId } },
            select: { role: true, workspaceId: true },
        });
        if (member) {
            req.workspaceId = member.workspaceId;
            req.workspaceRole = member.role as any;
            return;
        }
        // Fall through — header pointed to a workspace the user isn't in.
    }
    const wsId = await getOrCreatePersonalWorkspace(userId);
    req.workspaceId = wsId;
    req.workspaceRole = 'OWNER';
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
            // API keys default to the workspace they were created in.
            if (apiKey.workspaceId) {
                req.workspaceId = apiKey.workspaceId;
                const member = await prisma.workspaceMember.findUnique({
                    where: { workspaceId_userId: { workspaceId: apiKey.workspaceId, userId: apiKey.user.id } },
                    select: { role: true },
                });
                req.workspaceRole = (member?.role || 'OWNER') as any;
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

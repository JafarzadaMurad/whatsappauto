// Who is on the platform right now — the admin-facing read of lib/presence.
//
// Presence itself holds only ids; names, emails and workspaces are joined
// on read so the in-memory map stays small and never goes stale against
// the database.

import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { onlineUsers, recentlySeen, presenceStats } from '../../lib/presence';

export class PresenceController {
    async live(_req: Request, res: Response) {
        try {
            const online = onlineUsers();
            const recent = recentlySeen().slice(0, 50);

            const ids = Array.from(new Set([
                ...online.map(u => u.userId),
                ...recent.map(u => u.userId),
            ]));
            const workspaceIds = Array.from(new Set(
                [...online, ...recent].map(u => u.workspaceId).filter(Boolean) as string[]
            ));

            const [users, workspaces] = await Promise.all([
                prisma.user.findMany({
                    where: { id: { in: ids } },
                    select: { id: true, name: true, email: true, role: true },
                }),
                prisma.workspace.findMany({
                    where: { id: { in: workspaceIds } },
                    select: { id: true, name: true },
                }),
            ]);
            const userById = new Map(users.map(u => [u.id, u]));
            const wsById = new Map(workspaces.map(w => [w.id, w]));

            const decorate = (u: { userId: string; workspaceId: string | null }) => {
                const person = userById.get(u.userId);
                return {
                    name: person?.name || null,
                    email: person?.email || null,
                    role: person?.role || null,
                    workspaceName: u.workspaceId ? (wsById.get(u.workspaceId)?.name || null) : null,
                };
            };

            return res.json({
                success: true,
                stats: presenceStats(),
                online: online.map(u => ({ ...u, ...decorate(u) })),
                recent: recent.map(u => ({ ...u, ...decorate(u) })),
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * What one person has actually been doing, drawn from the records that
     * already exist rather than from a new tracking table: the pages they
     * are on now, their copilot sessions, and their credit spend.
     */
    async user(req: Request, res: Response) {
        try {
            const userId = String(req.params.id);
            const person = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true, name: true, email: true, role: true, createdAt: true,
                },
            });
            if (!person) return res.status(404).json({ success: false, message: 'User not found' });

            const live = onlineUsers().find(u => u.userId === userId) || null;
            const seen = recentlySeen().find(u => u.userId === userId) || null;

            const [sessions, ledger] = await Promise.all([
                prisma.copilotSession.findMany({
                    where: { userId },
                    orderBy: { updatedAt: 'desc' },
                    take: 20,
                    select: { id: true, title: true, mode: true, totalCredits: true, updatedAt: true },
                }),
                prisma.creditLedger.findMany({
                    where: { userId },
                    orderBy: { createdAt: 'desc' },
                    take: 50,
                    select: {
                        createdAt: true, provider: true, model: true, cause: true,
                        creditsUsed: true, inputTokens: true, outputTokens: true,
                    },
                }),
            ]);

            return res.json({
                success: true,
                user: person,
                online: !!live,
                path: live?.path ?? seen?.path ?? null,
                lastSeenAt: live?.lastSeenAt ?? seen?.at ?? null,
                tabs: live?.tabs ?? 0,
                userAgent: live?.userAgent ?? null,
                ip: live?.ip ?? null,
                recentPaths: live?.recentPaths ?? [],
                sessions,
                ledger,
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

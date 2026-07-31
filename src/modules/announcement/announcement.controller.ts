// Product announcements.
//
// New capability that nobody discovers may as well not exist. Rather
// than mailing everyone, admins publish a short notice here and it
// appears in-app until each user dismisses it. Unread state is derived
// from the absence of an AnnouncementRead row, so publishing something
// makes it unread for everyone with no backfill.

import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';

const upsertSchema = z.object({
    title: z.string().min(1).max(160),
    body: z.string().min(1).max(4000),
    kind: z.enum(['feature', 'fix', 'notice']).default('feature'),
    linkUrl: z.string().max(500).nullable().optional(),
    linkLabel: z.string().max(60).nullable().optional(),
    isPublished: z.boolean().optional(),
});

export class AnnouncementController {
    // ─── User-facing ────────────────────────────────────────────────

    // Everything published, newest first, each flagged read/unread for
    // the caller. The bell badge counts the unread ones.
    async listForMe(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const rows = await prisma.announcement.findMany({
                where: { isPublished: true },
                orderBy: { publishedAt: 'desc' },
                take: 50,
                include: {
                    reads: { where: { userId }, select: { readAt: true } },
                },
            });
            const announcements = rows.map(a => ({
                id: a.id,
                title: a.title,
                body: a.body,
                kind: a.kind,
                linkUrl: a.linkUrl,
                linkLabel: a.linkLabel,
                publishedAt: a.publishedAt,
                read: a.reads.length > 0,
            }));
            return res.json({
                success: true,
                announcements,
                unreadCount: announcements.filter(a => !a.read).length,
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async markRead(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            // upsert so double-clicking the same notice is harmless.
            await prisma.announcementRead.upsert({
                where: { announcementId_userId: { announcementId: id, userId } },
                update: {},
                create: { announcementId: id, userId },
            });
            return res.json({ success: true });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async markAllRead(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const published = await prisma.announcement.findMany({
                where: { isPublished: true },
                select: { id: true },
            });
            await prisma.announcementRead.createMany({
                data: published.map(a => ({ announcementId: a.id, userId })),
                skipDuplicates: true,
            });
            return res.json({ success: true, marked: published.length });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── Admin ──────────────────────────────────────────────────────

    async listAll(_req: Request, res: Response) {
        try {
            const rows = await prisma.announcement.findMany({
                orderBy: { createdAt: 'desc' },
                include: { _count: { select: { reads: true } } },
            });
            return res.json({ success: true, announcements: rows });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async create(req: Request, res: Response) {
        try {
            const data = upsertSchema.parse(req.body);
            const row = await prisma.announcement.create({
                data: {
                    title: data.title,
                    body: data.body,
                    kind: data.kind,
                    linkUrl: data.linkUrl || null,
                    linkLabel: data.linkLabel || null,
                    isPublished: data.isPublished ?? false,
                    // Stamped on first publish so "newest first" ordering
                    // reflects when users could actually see it.
                    publishedAt: data.isPublished ? new Date() : null,
                },
            });
            return res.status(201).json({ success: true, announcement: row });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async update(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const data = upsertSchema.partial().parse(req.body);
            const existing = await prisma.announcement.findUnique({ where: { id } });
            if (!existing) return res.status(404).json({ success: false, message: 'Announcement not found' });

            const patch: any = { ...data };
            if (data.isPublished !== undefined) {
                // Keep the original publish time on re-publish so an edit
                // doesn't shove an old notice back to the top of everyone's
                // list.
                patch.publishedAt = data.isPublished
                    ? (existing.publishedAt ?? new Date())
                    : null;
            }
            const row = await prisma.announcement.update({ where: { id }, data: patch });
            return res.json({ success: true, announcement: row });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async remove(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            await prisma.announcement.delete({ where: { id } });
            return res.json({ success: true });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

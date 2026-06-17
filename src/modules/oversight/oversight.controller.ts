import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { getWorkspaceId } from '../../lib/workspace-context';
import { runOversightAgent, applySuggestion, computeNextRunAt } from './oversight.service';

const oversightSchema = z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional().nullable(),
    providerId: z.string().min(1),
    model: z.string().min(1).max(100),
    systemPrompt: z.string().max(8000).optional().nullable(),
    intervalDays: z.number().int().min(1).max(60),
    runHour: z.number().int().min(0).max(23),
    lookbackDays: z.number().int().min(1).max(30),
    isActive: z.boolean().optional(),
    watchedAgentIds: z.array(z.string()).min(1, 'Pick at least one agent to watch'),
});

export class OversightController {
    // ─── Oversight agents ────────────────────────────────────
    async list(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const items = await prisma.oversightAgent.findMany({
                where: { workspaceId },
                orderBy: { createdAt: 'desc' },
                include: {
                    provider: { select: { provider: true } },
                    watches: { include: { agent: { select: { id: true, name: true } } } },
                    _count: { select: { suggestions: true, runs: true } },
                },
            });
            // Pending + unread suggestion counts so the UI can show
            // badges per oversight without an extra round-trip.
            const ids = items.map(i => i.id);
            const pendingGrouped = ids.length === 0 ? [] : await prisma.oversightSuggestion.groupBy({
                by: ['oversightAgentId', 'status'],
                where: { oversightAgentId: { in: ids } },
                _count: { _all: true },
            });
            const unreadGrouped = ids.length === 0 ? [] : await prisma.oversightSuggestion.groupBy({
                by: ['oversightAgentId'],
                where: { oversightAgentId: { in: ids }, readAt: null },
                _count: { _all: true },
            });
            const pendingMap = new Map<string, number>();
            const unreadMap = new Map<string, number>();
            for (const g of pendingGrouped) {
                if (g.status === 'pending') pendingMap.set(g.oversightAgentId, g._count._all);
            }
            for (const g of unreadGrouped) unreadMap.set(g.oversightAgentId, g._count._all);

            return res.json({
                success: true,
                items: items.map(i => ({
                    ...i,
                    pendingCount: pendingMap.get(i.id) || 0,
                    unreadCount: unreadMap.get(i.id) || 0,
                })),
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async create(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const data = oversightSchema.parse(req.body);

            // Verify every watched agent belongs to the workspace
            const watched = await prisma.agent.findMany({
                where: { id: { in: data.watchedAgentIds }, workspaceId },
                select: { id: true },
            });
            if (watched.length !== data.watchedAgentIds.length) {
                return res.status(400).json({ success: false, message: 'One or more watched agents do not belong to this workspace.' });
            }

            const nextRunAt = computeNextRunAt(null, data.intervalDays, data.runHour);
            const created = await prisma.oversightAgent.create({
                data: {
                    workspaceId,
                    name: data.name,
                    description: data.description || null,
                    providerId: data.providerId,
                    model: data.model,
                    systemPrompt: data.systemPrompt || null,
                    intervalDays: data.intervalDays,
                    runHour: data.runHour,
                    lookbackDays: data.lookbackDays,
                    isActive: data.isActive ?? true,
                    nextRunAt,
                    watches: { create: data.watchedAgentIds.map(id => ({ agentId: id })) },
                },
                include: { watches: { include: { agent: { select: { id: true, name: true } } } } },
            });
            return res.json({ success: true, item: created });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async update(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const existing = await prisma.oversightAgent.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Oversight agent not found' });

            const data = oversightSchema.partial().parse(req.body);
            // If watched list is touched, replace it entirely (simpler than diffing).
            if (data.watchedAgentIds) {
                const owned = await prisma.agent.findMany({
                    where: { id: { in: data.watchedAgentIds }, workspaceId },
                    select: { id: true },
                });
                if (owned.length !== data.watchedAgentIds.length) {
                    return res.status(400).json({ success: false, message: 'One or more agents do not belong to this workspace.' });
                }
                await prisma.oversightAgentWatch.deleteMany({ where: { oversightAgentId: id } });
                await prisma.oversightAgentWatch.createMany({
                    data: data.watchedAgentIds.map(aid => ({ oversightAgentId: id, agentId: aid })),
                });
            }

            const nextRunAt = (data.intervalDays || data.runHour !== undefined)
                ? computeNextRunAt(existing.lastRunAt, data.intervalDays ?? existing.intervalDays, data.runHour ?? existing.runHour)
                : existing.nextRunAt;

            const updated = await prisma.oversightAgent.update({
                where: { id },
                data: {
                    ...(data.name !== undefined ? { name: data.name } : {}),
                    ...(data.description !== undefined ? { description: data.description } : {}),
                    ...(data.providerId !== undefined ? { providerId: data.providerId } : {}),
                    ...(data.model !== undefined ? { model: data.model } : {}),
                    ...(data.systemPrompt !== undefined ? { systemPrompt: data.systemPrompt } : {}),
                    ...(data.intervalDays !== undefined ? { intervalDays: data.intervalDays } : {}),
                    ...(data.runHour !== undefined ? { runHour: data.runHour } : {}),
                    ...(data.lookbackDays !== undefined ? { lookbackDays: data.lookbackDays } : {}),
                    ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
                    ...(nextRunAt ? { nextRunAt } : {}),
                },
                include: { watches: { include: { agent: { select: { id: true, name: true } } } } },
            });
            return res.json({ success: true, item: updated });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async remove(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const existing = await prisma.oversightAgent.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Oversight agent not found' });
            await prisma.oversightAgent.delete({ where: { id } });
            return res.json({ success: true });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Fire-and-wait: run immediately, return the new suggestions.
    async runNow(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const existing = await prisma.oversightAgent.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Oversight agent not found' });

            const result = await runOversightAgent(id);
            return res.json({ success: result.ok, ...result });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── Suggestions feed ────────────────────────────────────
    // Workspace-wide list of pending + recent suggestions for the
    // sidebar feed. Marks them as read on read.
    async listSuggestions(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const status = (req.query.status as string) || 'pending';
            const oversightId = req.query.oversightId as string | undefined;

            const items = await prisma.oversightSuggestion.findMany({
                where: {
                    oversightAgent: { workspaceId },
                    ...(oversightId ? { oversightAgentId: oversightId } : {}),
                    ...(status === 'all' ? {} : { status }),
                },
                orderBy: { createdAt: 'desc' },
                take: 100,
                include: {
                    oversightAgent: { select: { id: true, name: true } },
                    targetAgent: { select: { id: true, name: true } },
                    run: { select: { id: true, startedAt: true, summary: true } },
                },
            });
            return res.json({ success: true, items });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async unreadCount(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const count = await prisma.oversightSuggestion.count({
                where: { oversightAgent: { workspaceId }, readAt: null, status: { in: ['pending', 'applied', 'apply_failed'] } },
            });
            return res.json({ success: true, count });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async markRead(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const schema = z.object({ ids: z.array(z.string()).optional() });
            const { ids } = schema.parse(req.body);
            const result = await prisma.oversightSuggestion.updateMany({
                where: {
                    oversightAgent: { workspaceId },
                    ...(ids && ids.length ? { id: { in: ids } } : {}),
                    readAt: null,
                },
                data: { readAt: new Date() },
            });
            return res.json({ success: true, marked: result.count });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async approve(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const existing = await prisma.oversightSuggestion.findFirst({
                where: { id, oversightAgent: { workspaceId } },
            });
            if (!existing) return res.status(404).json({ success: false, message: 'Suggestion not found' });

            const result = await applySuggestion(id, userId);
            if (!result.ok) return res.status(400).json({ success: false, message: result.error });
            return res.json({ success: true });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async reject(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const existing = await prisma.oversightSuggestion.findFirst({
                where: { id, oversightAgent: { workspaceId } },
            });
            if (!existing) return res.status(404).json({ success: false, message: 'Suggestion not found' });
            await prisma.oversightSuggestion.update({
                where: { id },
                data: { status: 'rejected', reviewedAt: new Date(), reviewedBy: userId },
            });
            return res.json({ success: true });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

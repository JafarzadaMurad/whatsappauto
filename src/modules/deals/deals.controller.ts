import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

const getWs = (req: Request): string | null => (req as any).workspaceId || null;
const getUserId = (req: Request): string | null => (req as any).user?.id || null;

// ─── Pipelines ──────────────────────────────────────────────────────

const createPipelineSchema = z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional().nullable(),
    color: z.string().max(20).optional().nullable(),
    currency: z.string().max(6).optional(),
    isDefault: z.boolean().optional(),
    stages: z.array(z.object({
        name: z.string().min(1).max(60),
        color: z.string().max(20).optional().nullable(),
        isWon: z.boolean().optional(),
        isLost: z.boolean().optional(),
        probability: z.number().int().min(0).max(100).optional().nullable(),
    })).min(1).max(20).optional(),
});

const DEFAULT_STAGES: { name: string; color: string; isWon?: boolean; isLost?: boolean; probability?: number }[] = [
    { name: 'New',        color: 'slate',   probability: 10 },
    { name: 'Contacted',  color: 'blue',    probability: 25 },
    { name: 'Qualified',  color: 'violet',  probability: 50 },
    { name: 'Proposal',   color: 'amber',   probability: 70 },
    { name: 'Won',        color: 'emerald', isWon: true,  probability: 100 },
    { name: 'Lost',       color: 'red',     isLost: true, probability: 0 },
];

export const listPipelines = async (req: Request, res: Response) => {
    try {
        const ws = getWs(req);
        if (!ws) return res.status(400).json({ success: false, message: 'workspace context missing' });
        const pipelines = await prisma.dealPipeline.findMany({
            where: { workspaceId: ws },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
            include: {
                stages: { orderBy: { order: 'asc' } },
                _count: { select: { deals: true } },
            },
        });
        return res.json({ success: true, pipelines });
    } catch (e: any) {
        logger.error({ err: e.message }, '[deals] list pipelines failed');
        return res.status(500).json({ success: false, message: e.message });
    }
};

export const createPipeline = async (req: Request, res: Response) => {
    try {
        const ws = getWs(req);
        const userId = getUserId(req);
        if (!ws || !userId) return res.status(400).json({ success: false, message: 'context missing' });
        const data = createPipelineSchema.parse(req.body);

        // If this is the first pipeline in the workspace it becomes the
        // default. If the caller asked to make it default, unset the
        // previous default in the same transaction.
        const existingCount = await prisma.dealPipeline.count({ where: { workspaceId: ws } });
        const isDefault = data.isDefault ?? (existingCount === 0);

        const stages = (data.stages && data.stages.length > 0 ? data.stages : DEFAULT_STAGES);

        const pipeline = await prisma.$transaction(async (tx) => {
            if (isDefault) {
                await tx.dealPipeline.updateMany({
                    where: { workspaceId: ws, isDefault: true },
                    data: { isDefault: false },
                });
            }
            const p = await tx.dealPipeline.create({
                data: {
                    userId, workspaceId: ws,
                    name: data.name,
                    description: data.description || null,
                    color: data.color || null,
                    currency: (data.currency || 'USD').toUpperCase().slice(0, 6),
                    isDefault,
                    order: existingCount,
                    stages: {
                        create: stages.map((s, i) => ({
                            name: s.name,
                            color: s.color || null,
                            order: i,
                            isWon: !!s.isWon,
                            isLost: !!s.isLost,
                            probability: s.probability ?? null,
                        })),
                    },
                },
                include: { stages: { orderBy: { order: 'asc' } } },
            });
            return p;
        });
        return res.status(201).json({ success: true, pipeline });
    } catch (e: any) {
        if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
        logger.error({ err: e.message }, '[deals] create pipeline failed');
        return res.status(500).json({ success: false, message: e.message });
    }
};

const updatePipelineSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    color: z.string().max(20).nullable().optional(),
    currency: z.string().max(6).optional(),
    isDefault: z.boolean().optional(),
    order: z.number().int().optional(),
});

export const updatePipeline = async (req: Request, res: Response) => {
    try {
        const ws = getWs(req);
        if (!ws) return res.status(400).json({ success: false, message: 'workspace context missing' });
        const id = req.params.id as string;
        const data = updatePipelineSchema.parse(req.body);

        const existing = await prisma.dealPipeline.findFirst({ where: { id, workspaceId: ws } });
        if (!existing) return res.status(404).json({ success: false, message: 'pipeline not found' });

        if (data.isDefault === true) {
            await prisma.dealPipeline.updateMany({
                where: { workspaceId: ws, isDefault: true, NOT: { id } },
                data: { isDefault: false },
            });
        }

        const pipeline = await prisma.dealPipeline.update({
            where: { id },
            data: {
                ...(data.name !== undefined ? { name: data.name } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.color !== undefined ? { color: data.color } : {}),
                ...(data.currency !== undefined ? { currency: data.currency.toUpperCase().slice(0, 6) } : {}),
                ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
                ...(data.order !== undefined ? { order: data.order } : {}),
            },
            include: { stages: { orderBy: { order: 'asc' } } },
        });
        return res.json({ success: true, pipeline });
    } catch (e: any) {
        if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
        return res.status(500).json({ success: false, message: e.message });
    }
};

export const deletePipeline = async (req: Request, res: Response) => {
    try {
        const ws = getWs(req);
        if (!ws) return res.status(400).json({ success: false, message: 'workspace context missing' });
        const id = req.params.id as string;
        const existing = await prisma.dealPipeline.findFirst({ where: { id, workspaceId: ws } });
        if (!existing) return res.status(404).json({ success: false, message: 'pipeline not found' });
        await prisma.dealPipeline.delete({ where: { id } });
        return res.json({ success: true });
    } catch (e: any) {
        return res.status(500).json({ success: false, message: e.message });
    }
};

// ─── Stages ─────────────────────────────────────────────────────────

const createStageSchema = z.object({
    name: z.string().min(1).max(60),
    color: z.string().max(20).optional().nullable(),
    isWon: z.boolean().optional(),
    isLost: z.boolean().optional(),
    probability: z.number().int().min(0).max(100).nullable().optional(),
    afterStageId: z.string().uuid().optional(),  // insert after this stage
});

export const createStage = async (req: Request, res: Response) => {
    try {
        const ws = getWs(req);
        if (!ws) return res.status(400).json({ success: false, message: 'workspace context missing' });
        const pipelineId = req.params.pipelineId as string;
        const data = createStageSchema.parse(req.body);
        const pipeline = await prisma.dealPipeline.findFirst({ where: { id: pipelineId, workspaceId: ws } });
        if (!pipeline) return res.status(404).json({ success: false, message: 'pipeline not found' });

        // Figure out the insertion order.
        let order: number;
        if (data.afterStageId) {
            const anchor = await prisma.dealStage.findFirst({ where: { id: data.afterStageId, pipelineId } });
            if (!anchor) return res.status(400).json({ success: false, message: 'afterStageId does not belong to this pipeline' });
            await prisma.dealStage.updateMany({
                where: { pipelineId, order: { gt: anchor.order } },
                data: { order: { increment: 1 } },
            });
            order = anchor.order + 1;
        } else {
            const last = await prisma.dealStage.findFirst({ where: { pipelineId }, orderBy: { order: 'desc' } });
            order = (last?.order ?? -1) + 1;
        }

        const stage = await prisma.dealStage.create({
            data: {
                pipelineId,
                name: data.name,
                color: data.color || null,
                order,
                isWon: !!data.isWon,
                isLost: !!data.isLost,
                probability: data.probability ?? null,
            },
        });
        return res.status(201).json({ success: true, stage });
    } catch (e: any) {
        if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
        return res.status(500).json({ success: false, message: e.message });
    }
};

const updateStageSchema = createStageSchema.partial().omit({ afterStageId: true });

export const updateStage = async (req: Request, res: Response) => {
    try {
        const ws = getWs(req);
        if (!ws) return res.status(400).json({ success: false, message: 'workspace context missing' });
        const stageId = req.params.stageId as string;
        const data = updateStageSchema.parse(req.body);

        const stage = await prisma.dealStage.findFirst({
            where: { id: stageId, pipeline: { workspaceId: ws } },
        });
        if (!stage) return res.status(404).json({ success: false, message: 'stage not found' });

        const updated = await prisma.dealStage.update({
            where: { id: stageId },
            data: {
                ...(data.name !== undefined ? { name: data.name } : {}),
                ...(data.color !== undefined ? { color: data.color } : {}),
                ...(data.isWon !== undefined ? { isWon: data.isWon } : {}),
                ...(data.isLost !== undefined ? { isLost: data.isLost } : {}),
                ...(data.probability !== undefined ? { probability: data.probability } : {}),
            },
        });
        return res.json({ success: true, stage: updated });
    } catch (e: any) {
        if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
        return res.status(500).json({ success: false, message: e.message });
    }
};

const reorderStagesSchema = z.object({
    stageIds: z.array(z.string().uuid()).min(1),
});

export const reorderStages = async (req: Request, res: Response) => {
    try {
        const ws = getWs(req);
        if (!ws) return res.status(400).json({ success: false, message: 'workspace context missing' });
        const pipelineId = req.params.pipelineId as string;
        const { stageIds } = reorderStagesSchema.parse(req.body);
        const pipeline = await prisma.dealPipeline.findFirst({ where: { id: pipelineId, workspaceId: ws }, include: { stages: true } });
        if (!pipeline) return res.status(404).json({ success: false, message: 'pipeline not found' });

        const known = new Set(pipeline.stages.map(s => s.id));
        if (!stageIds.every(id => known.has(id))) return res.status(400).json({ success: false, message: 'stageIds contain unknown ids' });

        await prisma.$transaction(
            stageIds.map((id, i) => prisma.dealStage.update({ where: { id }, data: { order: i } }))
        );
        return res.json({ success: true });
    } catch (e: any) {
        if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
        return res.status(500).json({ success: false, message: e.message });
    }
};

export const deleteStage = async (req: Request, res: Response) => {
    try {
        const ws = getWs(req);
        if (!ws) return res.status(400).json({ success: false, message: 'workspace context missing' });
        const stageId = req.params.stageId as string;
        const stage = await prisma.dealStage.findFirst({
            where: { id: stageId, pipeline: { workspaceId: ws } },
            include: { _count: { select: { deals: true } } },
        });
        if (!stage) return res.status(404).json({ success: false, message: 'stage not found' });
        if (stage._count.deals > 0) {
            return res.status(400).json({ success: false, message: 'Cannot delete a stage that still has deals. Move them first.' });
        }
        await prisma.dealStage.delete({ where: { id: stageId } });
        return res.json({ success: true });
    } catch (e: any) {
        return res.status(500).json({ success: false, message: e.message });
    }
};

// ─── Deals ──────────────────────────────────────────────────────────

const createDealSchema = z.object({
    pipelineId: z.string().uuid(),
    stageId: z.string().uuid().optional(),  // defaults to first stage
    clientId: z.string().uuid().optional().nullable(),
    title: z.string().min(1).max(200),
    description: z.string().max(4000).optional().nullable(),
    value: z.union([z.number(), z.string()]).optional().nullable(),
    expectedCloseAt: z.string().datetime().optional().nullable(),
    assignedUserId: z.string().uuid().optional().nullable(),
    tags: z.array(z.string().max(40)).optional(),
});

export const listDeals = async (req: Request, res: Response) => {
    try {
        const ws = getWs(req);
        if (!ws) return res.status(400).json({ success: false, message: 'workspace context missing' });
        const pipelineId = req.query.pipelineId as string | undefined;
        const clientId = req.query.clientId as string | undefined;
        const deals = await prisma.deal.findMany({
            where: {
                workspaceId: ws,
                ...(pipelineId ? { pipelineId } : {}),
                ...(clientId ? { clientId } : {}),
            },
            include: {
                client: { select: { id: true, phone: true, name: true, channel: true, profilePicUrl: true, status: true } },
                stage: { select: { id: true, name: true, color: true, isWon: true, isLost: true } },
            },
            orderBy: [{ stageId: 'asc' }, { order: 'asc' }],
        });
        return res.json({ success: true, deals });
    } catch (e: any) {
        return res.status(500).json({ success: false, message: e.message });
    }
};

export const createDeal = async (req: Request, res: Response) => {
    try {
        const ws = getWs(req);
        const userId = getUserId(req);
        if (!ws || !userId) return res.status(400).json({ success: false, message: 'context missing' });
        const data = createDealSchema.parse(req.body);

        const pipeline = await prisma.dealPipeline.findFirst({
            where: { id: data.pipelineId, workspaceId: ws },
            include: { stages: { orderBy: { order: 'asc' } } },
        });
        if (!pipeline) return res.status(404).json({ success: false, message: 'pipeline not found' });

        const stageId = data.stageId || pipeline.stages[0]?.id;
        if (!stageId) return res.status(400).json({ success: false, message: 'pipeline has no stages' });
        if (!pipeline.stages.find(s => s.id === stageId)) {
            return res.status(400).json({ success: false, message: 'stage does not belong to this pipeline' });
        }

        // Place new deal at the end of the target column.
        const last = await prisma.deal.findFirst({ where: { stageId }, orderBy: { order: 'desc' } });
        const nextOrder = (last?.order ?? -1) + 1;

        // Optional client link: verify the client belongs to this workspace.
        if (data.clientId) {
            const client = await prisma.client.findFirst({ where: { id: data.clientId, workspaceId: ws } });
            if (!client) return res.status(400).json({ success: false, message: 'client not found in this workspace' });
        }

        const deal = await prisma.deal.create({
            data: {
                userId, workspaceId: ws,
                pipelineId: data.pipelineId,
                stageId,
                clientId: data.clientId || null,
                title: data.title,
                description: data.description || null,
                value: data.value != null ? String(data.value) : null,
                expectedCloseAt: data.expectedCloseAt ? new Date(data.expectedCloseAt) : null,
                assignedUserId: data.assignedUserId || null,
                order: nextOrder,
                tags: data.tags || [],
            },
            include: {
                client: { select: { id: true, phone: true, name: true, channel: true, profilePicUrl: true, status: true } },
                stage: { select: { id: true, name: true, color: true, isWon: true, isLost: true } },
            },
        });
        return res.status(201).json({ success: true, deal });
    } catch (e: any) {
        if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
        logger.error({ err: e.message }, '[deals] create deal failed');
        return res.status(500).json({ success: false, message: e.message });
    }
};

const updateDealSchema = z.object({
    stageId: z.string().uuid().optional(),
    clientId: z.string().uuid().nullable().optional(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).nullable().optional(),
    value: z.union([z.number(), z.string()]).nullable().optional(),
    expectedCloseAt: z.string().datetime().nullable().optional(),
    assignedUserId: z.string().uuid().nullable().optional(),
    tags: z.array(z.string().max(40)).optional(),
    order: z.number().int().optional(),
});

export const updateDeal = async (req: Request, res: Response) => {
    try {
        const ws = getWs(req);
        if (!ws) return res.status(400).json({ success: false, message: 'workspace context missing' });
        const id = req.params.id as string;
        const data = updateDealSchema.parse(req.body);

        const existing = await prisma.deal.findFirst({ where: { id, workspaceId: ws } });
        if (!existing) return res.status(404).json({ success: false, message: 'deal not found' });

        // Verify new stage belongs to the same pipeline.
        if (data.stageId && data.stageId !== existing.stageId) {
            const stage = await prisma.dealStage.findFirst({ where: { id: data.stageId, pipelineId: existing.pipelineId } });
            if (!stage) return res.status(400).json({ success: false, message: 'stage does not belong to this deal\'s pipeline' });
        }

        const deal = await prisma.deal.update({
            where: { id },
            data: {
                ...(data.stageId !== undefined ? { stageId: data.stageId } : {}),
                ...(data.clientId !== undefined ? { clientId: data.clientId } : {}),
                ...(data.title !== undefined ? { title: data.title } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.value !== undefined ? { value: data.value == null ? null : String(data.value) } : {}),
                ...(data.expectedCloseAt !== undefined ? { expectedCloseAt: data.expectedCloseAt ? new Date(data.expectedCloseAt) : null } : {}),
                ...(data.assignedUserId !== undefined ? { assignedUserId: data.assignedUserId } : {}),
                ...(data.tags !== undefined ? { tags: data.tags } : {}),
                ...(data.order !== undefined ? { order: data.order } : {}),
            },
            include: {
                client: { select: { id: true, phone: true, name: true, channel: true, profilePicUrl: true, status: true } },
                stage: { select: { id: true, name: true, color: true, isWon: true, isLost: true } },
            },
        });
        return res.json({ success: true, deal });
    } catch (e: any) {
        if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
        return res.status(500).json({ success: false, message: e.message });
    }
};

// Bulk move — used by the Kanban board when reordering many cards in
// one drag-end event. Each entry specifies the deal's new stageId and
// order. All updates happen in a single transaction.
const moveDealsSchema = z.object({
    moves: z.array(z.object({
        dealId: z.string().uuid(),
        stageId: z.string().uuid(),
        order: z.number().int(),
    })).min(1).max(200),
});

export const moveDeals = async (req: Request, res: Response) => {
    try {
        const ws = getWs(req);
        if (!ws) return res.status(400).json({ success: false, message: 'workspace context missing' });
        const { moves } = moveDealsSchema.parse(req.body);

        // Verify every deal belongs to the workspace before touching data.
        const ids = moves.map(m => m.dealId);
        const owned = await prisma.deal.findMany({
            where: { id: { in: ids }, workspaceId: ws },
            select: { id: true, pipelineId: true },
        });
        if (owned.length !== ids.length) return res.status(400).json({ success: false, message: 'unknown deal id in payload' });

        // Verify every target stage exists in the matching pipeline.
        const stageIds = Array.from(new Set(moves.map(m => m.stageId)));
        const stages = await prisma.dealStage.findMany({ where: { id: { in: stageIds } }, select: { id: true, pipelineId: true } });
        for (const move of moves) {
            const dealPipeline = owned.find(o => o.id === move.dealId)!.pipelineId;
            const stage = stages.find(s => s.id === move.stageId);
            if (!stage || stage.pipelineId !== dealPipeline) {
                return res.status(400).json({ success: false, message: 'stage/pipeline mismatch' });
            }
        }

        await prisma.$transaction(
            moves.map(m => prisma.deal.update({ where: { id: m.dealId }, data: { stageId: m.stageId, order: m.order } }))
        );
        return res.json({ success: true });
    } catch (e: any) {
        if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
        return res.status(500).json({ success: false, message: e.message });
    }
};

export const deleteDeal = async (req: Request, res: Response) => {
    try {
        const ws = getWs(req);
        if (!ws) return res.status(400).json({ success: false, message: 'workspace context missing' });
        const id = req.params.id as string;
        const existing = await prisma.deal.findFirst({ where: { id, workspaceId: ws } });
        if (!existing) return res.status(404).json({ success: false, message: 'deal not found' });
        await prisma.deal.delete({ where: { id } });
        return res.json({ success: true });
    } catch (e: any) {
        return res.status(500).json({ success: false, message: e.message });
    }
};

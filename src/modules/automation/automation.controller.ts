import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { checkPlanLimit, PlanLimitError } from '../../lib/plan-limits';
import { getWorkspaceId } from '../../lib/workspace-context';

const nodeSchema = z.object({
    id: z.string(),
    type: z.string(),
    position: z.object({ x: z.number(), y: z.number() }),
    data: z.record(z.string(), z.any()).default({})
});

const edgeSchema = z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    sourceHandle: z.string().nullable().optional(),
    targetHandle: z.string().nullable().optional()
});

const upsertSchema = z.object({
    name: z.string().min(1),
    isActive: z.boolean().optional(),
    nodes: z.array(nodeSchema).optional(),
    edges: z.array(edgeSchema).optional()
});

export class AutomationController {
    async list(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const automations = await prisma.automation.findMany({
                where: { workspaceId },
                orderBy: { updatedAt: 'desc' }
            });
            return res.json({ success: true, automations });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async get(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const automation = await prisma.automation.findFirst({ where: { id, workspaceId } });
            if (!automation) return res.status(404).json({ success: false, message: 'Automation not found' });
            return res.json({ success: true, automation });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async create(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const data = upsertSchema.parse(req.body);
            await checkPlanLimit(workspaceId, 'automation');
            const automation = await prisma.automation.create({
                data: {
                    userId,
                    workspaceId,
                    name: data.name,
                    isActive: data.isActive ?? false,
                    nodes: (data.nodes || []) as any,
                    edges: (data.edges || []) as any
                }
            });
            return res.status(201).json({ success: true, automation });
        } catch (error: any) {
            if (error instanceof PlanLimitError) return res.status(403).json({ success: false, message: error.message, code: error.code });
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async update(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const data = upsertSchema.parse(req.body);

            const existing = await prisma.automation.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Automation not found' });

            const automation = await prisma.automation.update({
                where: { id },
                data: {
                    name: data.name,
                    ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
                    ...(data.nodes !== undefined ? { nodes: data.nodes as any } : {}),
                    ...(data.edges !== undefined ? { edges: data.edges as any } : {})
                }
            });
            return res.json({ success: true, automation });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async executions(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const auto = await prisma.automation.findFirst({ where: { id, workspaceId } });
            if (!auto) return res.status(404).json({ success: false, message: 'Automation not found' });
            const executions = await prisma.automationExecution.findMany({
                where: { automationId: id },
                orderBy: { startedAt: 'desc' },
                take: 100,
            });
            return res.json({ success: true, executions });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async remove(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const existing = await prisma.automation.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Automation not found' });
            await prisma.automation.delete({ where: { id } });
            return res.json({ success: true, message: 'Automation deleted' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

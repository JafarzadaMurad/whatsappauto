import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { getWorkspaceId } from '../../lib/workspace-context';

const operatorSchema = z.object({
    name: z.string().min(1).max(80),
    phone: z.string().min(7).max(20)
        .transform(v => v.replace(/[^0-9]/g, '')),
    systemPrompt: z.string().max(2000).optional().nullable(),
    order: z.number().int().min(0).max(999).optional(),
    timeoutMin: z.number().int().min(1).max(1440).optional(),
    isActive: z.boolean().optional(),
});

async function ensureAgentBelongsToWorkspace(agentId: string, workspaceId: string) {
    return prisma.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } });
}

export class OperatorController {
    // List operators for an agent
    async list(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const agentId = req.params.agentId as string;
            const owns = await ensureAgentBelongsToWorkspace(agentId, workspaceId);
            if (!owns) return res.status(404).json({ success: false, message: 'Agent not found' });

            const operators = await prisma.operator.findMany({
                where: { agentId },
                orderBy: { order: 'asc' },
            });
            return res.json({ success: true, operators });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async create(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const agentId = req.params.agentId as string;
            const owns = await ensureAgentBelongsToWorkspace(agentId, workspaceId);
            if (!owns) return res.status(404).json({ success: false, message: 'Agent not found' });

            const data = operatorSchema.parse(req.body);
            const created = await prisma.operator.create({
                data: {
                    agentId, workspaceId,
                    name: data.name,
                    phone: data.phone,
                    systemPrompt: data.systemPrompt || null,
                    order: data.order ?? 0,
                    timeoutMin: data.timeoutMin ?? 30,
                    isActive: data.isActive ?? true,
                },
            });
            return res.json({ success: true, operator: created });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            if (e.code === 'P2002') return res.status(409).json({ success: false, message: 'Operator with this phone already exists for the agent' });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async update(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const existing = await prisma.operator.findFirst({
                where: { id, agent: { workspaceId } },
            });
            if (!existing) return res.status(404).json({ success: false, message: 'Operator not found' });

            const data = operatorSchema.partial().parse(req.body);
            const updated = await prisma.operator.update({
                where: { id },
                data: {
                    ...(data.name !== undefined ? { name: data.name } : {}),
                    ...(data.phone !== undefined ? { phone: data.phone } : {}),
                    ...(data.systemPrompt !== undefined ? { systemPrompt: data.systemPrompt || null } : {}),
                    ...(data.order !== undefined ? { order: data.order } : {}),
                    ...(data.timeoutMin !== undefined ? { timeoutMin: data.timeoutMin } : {}),
                    ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
                },
            });
            return res.json({ success: true, operator: updated });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async remove(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const existing = await prisma.operator.findFirst({
                where: { id, agent: { workspaceId } },
            });
            if (!existing) return res.status(404).json({ success: false, message: 'Operator not found' });

            await prisma.operator.delete({ where: { id } });
            return res.json({ success: true });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // Quick view of recent operator tickets for the Activity panel.
    async recentRequests(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const agentId = req.params.agentId as string;
            const owns = await ensureAgentBelongsToWorkspace(agentId, workspaceId);
            if (!owns) return res.status(404).json({ success: false, message: 'Agent not found' });

            const requests = await prisma.operatorRequest.findMany({
                where: { agentId },
                orderBy: { sentAt: 'desc' },
                take: 30,
                include: { operator: { select: { name: true, phone: true } } },
            });
            return res.json({ success: true, requests });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }
}

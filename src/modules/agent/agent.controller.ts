import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';

const createAgentSchema = z.object({
    name: z.string().min(1),
    providerId: z.string().uuid(),
    model: z.string().min(1),
    systemPrompt: z.string().optional(),
    allowedTableIds: z.array(z.string()).optional()
});

export class AgentController {
    async getAgents(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const agents = await prisma.agent.findMany({
                where: { userId },
                include: { provider: true, instances: true },
                orderBy: { createdAt: 'desc' }
            });
            return res.json({ success: true, agents });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getAgent(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            const agent = await prisma.agent.findFirst({
                where: { id, userId },
                include: { provider: true, instances: true }
            });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });
            return res.json({ success: true, agent });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async createAgent(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const data = createAgentSchema.parse(req.body);

            // Verify provider belongs to user
            const provider = await prisma.aiProvider.findFirst({ where: { id: data.providerId, userId } });
            if (!provider) return res.status(404).json({ success: false, message: 'Invalid AI Provider' });

            const agent = await prisma.agent.create({
                data: {
                    userId,
                    name: data.name,
                    providerId: data.providerId,
                    model: data.model,
                    systemPrompt: data.systemPrompt || "",
                    allowedTableIds: data.allowedTableIds || []
                }
            });

            return res.status(201).json({ success: true, agent });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateAgent(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            const data = createAgentSchema.parse(req.body);

            const existing = await prisma.agent.findFirst({ where: { id, userId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Agent not found' });

            const agent = await prisma.agent.update({
                where: { id },
                data: {
                    name: data.name,
                    providerId: data.providerId,
                    model: data.model,
                    systemPrompt: data.systemPrompt,
                    allowedTableIds: data.allowedTableIds || []
                }
            });

            return res.json({ success: true, agent });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async deleteAgent(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;

            const existing = await prisma.agent.findFirst({ where: { id, userId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Agent not found' });

            await prisma.agent.delete({ where: { id } });
            return res.json({ success: true, message: 'Agent deleted' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

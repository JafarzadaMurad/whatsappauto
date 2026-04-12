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

    async getConversations(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;

            const agent = await prisma.agent.findFirst({ where: { id, userId } });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

            const logs = await prisma.aiConversationLog.findMany({
                where: { agentId: id },
                orderBy: { createdAt: 'desc' }
            });

            // Group by remoteJid
            const grouped: Record<string, any> = {};
            for (const log of logs) {
                if (!grouped[log.remoteJid]) {
                    grouped[log.remoteJid] = {
                        remoteJid: log.remoteJid,
                        messageCount: 0,
                        totalTokens: 0,
                        lastMessageAt: log.createdAt,
                    };
                }
                grouped[log.remoteJid].messageCount++;
                grouped[log.remoteJid].totalTokens += log.totalTokens;
            }

            return res.json({ success: true, conversations: Object.values(grouped) });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getConversationMessages(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            const remoteJid = req.query.remoteJid as string;

            if (!remoteJid) return res.status(400).json({ success: false, message: 'remoteJid required' });

            const agent = await prisma.agent.findFirst({ where: { id, userId } });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

            const messages = await prisma.aiConversationLog.findMany({
                where: { agentId: id, remoteJid },
                orderBy: { createdAt: 'asc' }
            });

            return res.json({ success: true, messages });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getTokenStats(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;

            const agent = await prisma.agent.findFirst({ where: { id, userId } });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

            const logs = await prisma.aiConversationLog.findMany({
                where: { agentId: id },
                select: { provider: true, model: true, promptTokens: true, completionTokens: true, totalTokens: true }
            });

            // Group by provider + model
            const statsMap: Record<string, any> = {};
            for (const log of logs) {
                const key = `${log.provider}:${log.model}`;
                if (!statsMap[key]) {
                    statsMap[key] = { provider: log.provider, model: log.model, promptTokens: 0, completionTokens: 0, totalTokens: 0, requestCount: 0 };
                }
                statsMap[key].promptTokens += log.promptTokens;
                statsMap[key].completionTokens += log.completionTokens;
                statsMap[key].totalTokens += log.totalTokens;
                statsMap[key].requestCount++;
            }

            const stats = Object.values(statsMap);
            const totals = {
                promptTokens: stats.reduce((s: number, x: any) => s + x.promptTokens, 0),
                completionTokens: stats.reduce((s: number, x: any) => s + x.completionTokens, 0),
                totalTokens: stats.reduce((s: number, x: any) => s + x.totalTokens, 0),
                requestCount: stats.reduce((s: number, x: any) => s + x.requestCount, 0),
            };

            return res.json({ success: true, stats, totals });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

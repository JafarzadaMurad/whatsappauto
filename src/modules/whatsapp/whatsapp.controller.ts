import { Request, Response } from 'express';
import { InstanceManager } from './instance.manager';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { checkPlanLimit, PlanLimitError } from '../../lib/plan-limits';
import { getWorkspaceId } from '../../lib/workspace-context';

const createInstanceSchema = z.object({
    name: z.string().min(1),
});

export class WhatsappController {
    async listInstances(req: Request, res: Response) {
        const workspaceId = getWorkspaceId(req);
        const instances = await prisma.instance.findMany({
            where: { workspaceId },
            include: { agent: true },
            orderBy: { createdAt: 'desc' }
        });

        return res.status(200).json({ success: true, instances });
    }

    async createInstance(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const data = createInstanceSchema.parse(req.body);

            await checkPlanLimit(userId, 'whatsapp');

            const instance = await prisma.instance.create({
                data: {
                    userId,
                    workspaceId,
                    name: data.name,
                    status: 'DISCONNECTED',
                }
            });

            InstanceManager.startInstance(instance.id);

            return res.status(201).json({ success: true, instance });
        } catch (error: any) {
            if (error instanceof PlanLimitError) return res.status(403).json({ success: false, message: error.message, code: error.code });
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, errors: error.issues });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async deleteInstance(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const force = String(req.query.force || '') === 'true';

            const instance = await prisma.instance.findFirst({ where: { id, workspaceId } });
            if (!instance) {
                return res.status(404).json({ success: false, message: 'Instance not found' });
            }

            // Check campaigns that would lose their instance reference.
            const campaigns = await prisma.campaign.findMany({
                where: { instanceId: id },
                select: { id: true, name: true, status: true },
            });

            if (campaigns.length > 0 && !force) {
                return res.status(409).json({
                    success: false,
                    requiresConfirmation: true,
                    campaigns,
                    message: `${campaigns.length} campaign(s) use this number. They will stay but their number will show as "deleted".`,
                });
            }

            await InstanceManager.stopInstance(id as string);
            await prisma.instance.delete({ where: { id: id as string } });

            return res.status(200).json({
                success: true,
                message: 'Instance deleted',
                orphanedCampaigns: campaigns.length,
            });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async restartInstance(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const instance = await prisma.instance.findFirst({ where: { id, workspaceId } });
            if (!instance) return res.status(404).json({ success: false, message: 'Instance not found' });

            await InstanceManager.stopInstance(id);
            InstanceManager.startInstance(id);

            return res.json({ success: true, message: 'Instance restarting' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateInstance(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const schema = z.object({
                agentId: z.string().uuid().nullable().optional(),
                syncHistory: z.boolean().optional(),
            });
            const data = schema.parse(req.body);

            const instance = await prisma.instance.findFirst({ where: { id, workspaceId } });
            if (!instance) {
                return res.status(404).json({ success: false, message: 'Instance not found' });
            }

            const updated = await prisma.instance.update({
                where: { id },
                data: {
                    ...(data.agentId !== undefined ? { agentId: data.agentId } : {}),
                    ...(data.syncHistory !== undefined ? { syncHistory: data.syncHistory } : {}),
                },
            });

            return res.status(200).json({ success: true, instance: updated });
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, errors: error.issues });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

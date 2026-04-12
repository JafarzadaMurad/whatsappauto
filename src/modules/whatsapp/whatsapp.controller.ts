import { Request, Response } from 'express';
import { InstanceManager } from './instance.manager';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';

const createInstanceSchema = z.object({
    name: z.string().min(1),
});

export class WhatsappController {
    async listInstances(req: Request, res: Response) {
        const userId = (req as any).user.id;
        const instances = await prisma.instance.findMany({
            where: { userId },
            include: { agent: true },
            orderBy: { createdAt: 'desc' }
        });

        return res.status(200).json({ success: true, instances });
    }

    async createInstance(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const data = createInstanceSchema.parse(req.body);

            const instance = await prisma.instance.create({
                data: {
                    userId,
                    name: data.name,
                    status: 'DISCONNECTED',
                }
            });

            // Start the Baileys instance process
            InstanceManager.startInstance(instance.id);

            return res.status(201).json({ success: true, instance });
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, errors: error.issues });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async deleteInstance(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;

            const instance = await prisma.instance.findFirst({ where: { id, userId } });
            if (!instance) {
                return res.status(404).json({ success: false, message: 'Instance not found' });
            }

            await InstanceManager.stopInstance(id as string);

            await prisma.instance.delete({ where: { id: id as string } });

            return res.status(200).json({ success: true, message: 'Instance deleted' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async restartInstance(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;

            const instance = await prisma.instance.findFirst({ where: { id, userId } });
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
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            const schema = z.object({ agentId: z.string().uuid().nullable().optional() });
            const data = schema.parse(req.body);

            const instance = await prisma.instance.findFirst({ where: { id, userId } });
            if (!instance) {
                return res.status(404).json({ success: false, message: 'Instance not found' });
            }

            const updated = await prisma.instance.update({
                where: { id },
                data: { agentId: data.agentId !== undefined ? data.agentId : instance.agentId }
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

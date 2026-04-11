import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';

const updateClientSchema = z.object({
    status: z.string().optional(),
    tags: z.array(z.string()).optional(),
    customFields: z.record(z.string(), z.any()).optional()
});

export class ClientController {
    async getClients(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const clients = await prisma.client.findMany({
                where: { userId },
                orderBy: { updatedAt: 'desc' }
            });
            return res.json({ success: true, clients });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getClient(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            const client = await prisma.client.findFirst({
                where: { id, userId }
            });
            if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
            return res.json({ success: true, client });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateClient(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            const data = updateClientSchema.parse(req.body);

            const existing = await prisma.client.findFirst({ where: { id, userId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Client not found' });

            // Define update payload dynamically
            const updateData: any = {};
            if (data.status !== undefined) updateData.status = data.status;
            if (data.tags !== undefined) updateData.tags = data.tags;
            if (data.customFields !== undefined) updateData.customFields = data.customFields;

            const client = await prisma.client.update({
                where: { id },
                data: updateData
            });

            return res.json({ success: true, client });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async deleteClient(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;

            const existing = await prisma.client.findFirst({ where: { id, userId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Client not found' });

            await prisma.client.delete({ where: { id } });
            return res.json({ success: true, message: 'Client deleted' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

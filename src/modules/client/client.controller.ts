import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { getWorkspaceId } from '../../lib/workspace-context';

const updateClientSchema = z.object({
    name: z.string().nullable().optional(),
    status: z.string().optional(),
    tags: z.array(z.string()).optional(),
    summary: z.string().nullable().optional(),
    customFields: z.record(z.string(), z.any()).optional(),
    agentPaused: z.boolean().optional(),
});

const pauseSchema = z.object({
    phone: z.string().min(1),
    channel: z.enum(['whatsapp', 'instagram']).optional(),
    paused: z.boolean(),
});

export class ClientController {
    async getClients(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const clients = await prisma.client.findMany({
                where: { workspaceId },
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
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const client = await prisma.client.findFirst({
                where: { id, workspaceId }
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
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const data = updateClientSchema.parse(req.body);

            const existing = await prisma.client.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Client not found' });

            const updateData: any = {};
            if (data.name !== undefined) updateData.name = data.name;
            if (data.status !== undefined) updateData.status = data.status;
            if (data.tags !== undefined) updateData.tags = data.tags;
            if (data.summary !== undefined) updateData.summary = data.summary;
            if (data.customFields !== undefined) updateData.customFields = data.customFields;
            if (data.agentPaused !== undefined) {
                updateData.agentPaused = data.agentPaused;
                updateData.pausedAt = data.agentPaused ? new Date() : null;
            }

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

    // Pause / resume the agent for a contact identified by phone (or IGSID).
    // Used by the chat UI which has the contact's identifier but not always
    // the Client.id — we upsert so that flipping the toggle creates the
    // CRM row on demand.
    async pauseByPhone(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const data = pauseSchema.parse(req.body);
            const cleanPhone = data.phone.replace(/[^0-9]/g, '') || data.phone;

            const existing = await prisma.client.findFirst({ where: { workspaceId, phone: cleanPhone } });
            const client = existing
                ? await prisma.client.update({
                    where: { id: existing.id },
                    data: { agentPaused: data.paused, pausedAt: data.paused ? new Date() : null },
                })
                : await prisma.client.create({
                    data: {
                        userId, workspaceId,
                        phone: cleanPhone,
                        status: 'NEW',
                        tags: [],
                        channel: data.channel || null,
                        agentPaused: data.paused,
                        pausedAt: data.paused ? new Date() : null,
                    },
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
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const existing = await prisma.client.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Client not found' });

            await prisma.client.delete({ where: { id } });
            return res.json({ success: true, message: 'Client deleted' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import crypto from 'crypto';
import { getWorkspaceId } from '../../lib/workspace-context';

export class ApiKeyController {
    async createKey(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const { name } = req.body;

            if (!name) {
                return res.status(400).json({ success: false, message: 'Name is required' });
            }

            const keyString = 'sk_live_' + crypto.randomBytes(24).toString('hex');

            const apiKey = await prisma.apiKey.create({
                data: { userId, workspaceId, name, key: keyString }
            });

            return res.status(201).json({ success: true, apiKey });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async listKeys(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const keys = await prisma.apiKey.findMany({
                where: { workspaceId },
                orderBy: { createdAt: 'desc' }
            });
            return res.status(200).json({ success: true, keys });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async deleteKey(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const apiKey = await prisma.apiKey.findFirst({ where: { id, workspaceId } });

            if (!apiKey) {
                return res.status(404).json({ success: false, message: 'API Key not found' });
            }

            await prisma.apiKey.delete({ where: { id } });

            return res.status(200).json({ success: true, message: 'API Key deleted' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

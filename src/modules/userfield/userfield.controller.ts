import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { getWorkspaceId } from '../../lib/workspace-context';

const FIELD_TYPES = ['text', 'number', 'date', 'select', 'boolean'] as const;

const slugify = (s: string) =>
    s.toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || `field_${Date.now()}`;

const createSchema = z.object({
    label: z.string().min(1).max(80),
    key: z.string().min(1).max(40).regex(/^[a-z][a-z0-9_]*$/).optional(),
    type: z.enum(FIELD_TYPES),
    options: z.array(z.string().min(1)).optional(),
});

const updateSchema = z.object({
    label: z.string().min(1).max(80).optional(),
    type: z.enum(FIELD_TYPES).optional(),
    options: z.array(z.string().min(1)).optional(),
});

const reorderSchema = z.object({
    ids: z.array(z.string()).min(1),
});

export class UserFieldController {
    async list(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const rows = await prisma.userField.findMany({
                where: { workspaceId },
                orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
            });
            return res.json({ success: true, fields: rows });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async create(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const data = createSchema.parse(req.body);
            const key = data.key || slugify(data.label);

            const conflict = await prisma.userField.findFirst({ where: { workspaceId, key } });
            if (conflict) return res.status(409).json({ success: false, message: `Field key "${key}" already exists` });

            const lastOrder = await prisma.userField.aggregate({ where: { workspaceId }, _max: { order: true } });
            const order = (lastOrder._max.order ?? -1) + 1;

            const row = await prisma.userField.create({
                data: {
                    userId, workspaceId, key,
                    label: data.label,
                    type: data.type,
                    options: data.type === 'select' ? (data.options || []) : [],
                    order,
                },
            });
            return res.status(201).json({ success: true, field: row });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async update(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const data = updateSchema.parse(req.body);

            const existing = await prisma.userField.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Field not found' });

            const row = await prisma.userField.update({
                where: { id },
                data: {
                    ...(data.label !== undefined ? { label: data.label } : {}),
                    ...(data.type !== undefined ? { type: data.type } : {}),
                    ...(data.options !== undefined ? { options: data.type === 'select' || existing.type === 'select' ? data.options : [] } : {}),
                },
            });
            return res.json({ success: true, field: row });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async remove(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const existing = await prisma.userField.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Field not found' });

            await prisma.userField.delete({ where: { id } });
            return res.json({ success: true, message: 'Field deleted' });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // Drag-to-reorder: pass the ids in their new order.
    async reorder(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const { ids } = reorderSchema.parse(req.body);
            const owned = await prisma.userField.findMany({ where: { workspaceId }, select: { id: true } });
            const ownedSet = new Set(owned.map(r => r.id));
            for (const id of ids) if (!ownedSet.has(id)) return res.status(400).json({ success: false, message: 'Unknown field id' });
            await prisma.$transaction(ids.map((id, i) => prisma.userField.update({ where: { id }, data: { order: i } })));
            return res.json({ success: true });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }
}

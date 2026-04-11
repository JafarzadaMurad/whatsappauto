import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';

const createTableSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    columns: z.array(z.object({
        id: z.string(),
        name: z.string(),
        type: z.enum(['text', 'number', 'boolean', 'relation']),
        relationTableId: z.string().optional()
    }))
});

const createRowSchema = z.object({
    data: z.record(z.string(), z.any())
});

export class CustomTableController {
    // --- TABLES ---

    async getTables(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const tables = await prisma.customTable.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' }
            });
            return res.json({ success: true, tables });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async getTable(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            const table = await prisma.customTable.findFirst({
                where: { id, userId }
            });
            if (!table) return res.status(404).json({ success: false, message: 'Table not found' });
            return res.json({ success: true, table });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async createTable(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const data = createTableSchema.parse(req.body);

            const table = await prisma.customTable.create({
                data: {
                    userId,
                    name: data.name,
                    description: data.description || "",
                    columns: data.columns as any
                }
            });

            return res.status(201).json({ success: true, table });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateTable(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            const data = createTableSchema.parse(req.body);

            const existing = await prisma.customTable.findFirst({ where: { id, userId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Table not found' });

            const table = await prisma.customTable.update({
                where: { id },
                data: {
                    name: data.name,
                    description: data.description !== undefined ? data.description : existing.description,
                    columns: data.columns as any
                }
            });

            return res.json({ success: true, table });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async deleteTable(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;

            const existing = await prisma.customTable.findFirst({ where: { id, userId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Table not found' });

            await prisma.customTable.delete({ where: { id } });
            return res.json({ success: true, message: 'Table deleted' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // --- ROWS ---

    async getRows(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const tableId = req.params.tableId as string;

            // Optional: verify access
            const table = await prisma.customTable.findFirst({ where: { id: tableId, userId } });
            if (!table) return res.status(404).json({ success: false, message: 'Table not found' });

            const rows = await prisma.customRow.findMany({
                where: { tableId },
                orderBy: { createdAt: 'desc' }
            });
            return res.json({ success: true, rows });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async createRow(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const tableId = req.params.tableId as string;
            const data = createRowSchema.parse(req.body);

            const table = await prisma.customTable.findFirst({ where: { id: tableId, userId } });
            if (!table) return res.status(404).json({ success: false, message: 'Table not found' });

            const row = await prisma.customRow.create({
                data: {
                    tableId,
                    data: data.data as any
                }
            });

            return res.status(201).json({ success: true, row });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateRow(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const tableId = req.params.tableId as string;
            const id = req.params.id as string;
            const data = createRowSchema.parse(req.body);

            const table = await prisma.customTable.findFirst({ where: { id: tableId, userId } });
            if (!table) return res.status(404).json({ success: false, message: 'Table not found' });

            const row = await prisma.customRow.update({
                where: { id },
                data: { data: data.data as any }
            });

            return res.json({ success: true, row });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async deleteRow(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const tableId = req.params.tableId as string;
            const id = req.params.id as string;

            const table = await prisma.customTable.findFirst({ where: { id: tableId, userId } });
            if (!table) return res.status(404).json({ success: false, message: 'Table not found' });

            await prisma.customRow.delete({ where: { id } });
            return res.json({ success: true, message: 'Row deleted' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

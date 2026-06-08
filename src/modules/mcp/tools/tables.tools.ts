import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { ok, fail, type RegisterToolFn } from '../mcp.server';

const columnSchema = z.object({
    id: z.string(),
    name: z.string().min(1),
    type: z.enum(['text', 'number', 'boolean', 'date', 'relation', 'select']),
    relationTableId: z.string().optional(),
});

async function ownsTable(workspaceId: string, tableId: string) {
    return prisma.customTable.findFirst({ where: { id: tableId, workspaceId } });
}

export function registerTableTools(reg: RegisterToolFn) {
    reg(
        'list_tables',
        'Lists the user\'s data tables. Each row includes id, name, description, columns.',
        {},
        async (_args, ctx) => {
            const rows = await prisma.customTable.findMany({
                where: { workspaceId: ctx.workspaceId },
                orderBy: { updatedAt: 'desc' },
            });
            return ok(rows);
        },
    );

    reg(
        'get_table',
        'Returns a single data table with its column definitions and row count.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const row = await prisma.customTable.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
            if (!row) return fail(`Table ${id} not found`);
            const count = await prisma.customRow.count({ where: { tableId: id } });
            return ok({ ...row, rowCount: count });
        },
    );

    reg(
        'list_table_rows',
        'Returns rows from a data table (each row is just its `data` JSON keyed by column name).',
        { tableId: z.string(), limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).optional() },
        async ({ tableId, limit, offset }, ctx) => {
            const t = await ownsTable(ctx.workspaceId, tableId);
            if (!t) return fail(`Table ${tableId} not found`);
            const rows = await prisma.customRow.findMany({
                where: { tableId },
                orderBy: { createdAt: 'asc' },
                skip: offset || 0,
                take: Math.min(limit || 100, 500),
            });
            return ok(rows.map(r => ({ id: r.id, data: r.data })));
        },
    );

    reg(
        'create_table',
        'Creates a new data table with the given columns. Column types: text, number, boolean, date, relation, select.',
        { name: z.string().min(1), description: z.string().optional(), columns: z.array(columnSchema).min(1) },
        async ({ name, description, columns }, ctx) => {
            const row = await prisma.customTable.create({
                data: {
                    userId: ctx.userId,
                    workspaceId: ctx.workspaceId,
                    name,
                    description: description || null,
                    columns: columns as any,
                },
            });
            return ok(row);
        },
    );

    reg(
        'add_table_row',
        'Adds a row to a data table. `data` is an object keyed by the column `name` (not id) where values match the column type.',
        { tableId: z.string(), data: z.record(z.string(), z.any()) },
        async ({ tableId, data }, ctx) => {
            const t = await ownsTable(ctx.workspaceId, tableId);
            if (!t) return fail(`Table ${tableId} not found`);
            const row = await prisma.customRow.create({ data: { tableId, data: data as any } });
            return ok(row);
        },
    );

    reg(
        'update_table_row',
        'Updates a single row in a data table. The supplied `data` object is shallow-merged into the existing row.',
        { tableId: z.string(), rowId: z.string(), data: z.record(z.string(), z.any()) },
        async ({ tableId, rowId, data }, ctx) => {
            const t = await ownsTable(ctx.workspaceId, tableId);
            if (!t) return fail(`Table ${tableId} not found`);
            const existing = await prisma.customRow.findFirst({ where: { id: rowId, tableId } });
            if (!existing) return fail(`Row ${rowId} not found`);
            const merged = { ...(existing.data as any), ...data };
            const row = await prisma.customRow.update({ where: { id: rowId }, data: { data: merged as any } });
            return ok(row);
        },
    );

    reg(
        'delete_table_row',
        'Deletes one row from a data table.',
        { tableId: z.string(), rowId: z.string() },
        async ({ tableId, rowId }, ctx) => {
            const t = await ownsTable(ctx.workspaceId, tableId);
            if (!t) return fail(`Table ${tableId} not found`);
            const existing = await prisma.customRow.findFirst({ where: { id: rowId, tableId } });
            if (!existing) return fail(`Row ${rowId} not found`);
            await prisma.customRow.delete({ where: { id: rowId } });
            return ok({ deleted: true, rowId });
        },
    );
}

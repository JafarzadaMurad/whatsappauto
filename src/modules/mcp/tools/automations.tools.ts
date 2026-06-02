import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { isValidNodeType } from '../../automation/node-registry';
import { ok, fail, type RegisterToolFn } from '../mcp.server';

const positionSchema = z.object({ x: z.number(), y: z.number() });

const nodeSchema = z.object({
    id: z.string(),
    type: z.string(),
    position: positionSchema,
    data: z.record(z.string(), z.any()).default({}),
});

const edgeSchema = z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    sourceHandle: z.string().nullable().optional(),
    targetHandle: z.string().nullable().optional(),
});

function validateGraph(nodes: z.infer<typeof nodeSchema>[]): string | null {
    for (const n of nodes) {
        if (!isValidNodeType(n.type)) {
            return `Unknown node type "${n.type}". Call describe_automation_node_types to see valid ids.`;
        }
    }
    return null;
}

export function registerAutomationTools(reg: RegisterToolFn) {
    reg(
        'list_automations',
        'Lists all automations owned by the calling user, newest first. Returns id, name, isActive, node and edge counts, timestamps.',
        {},
        async (_args, ctx) => {
            const rows = await prisma.automation.findMany({
                where: { userId: ctx.userId },
                orderBy: { updatedAt: 'desc' },
            });
            return ok(rows.map(r => ({
                id: r.id, name: r.name, isActive: r.isActive,
                nodeCount: (r.nodes as any[])?.length || 0,
                edgeCount: (r.edges as any[])?.length || 0,
                createdAt: r.createdAt, updatedAt: r.updatedAt,
            })));
        },
    );

    reg(
        'get_automation',
        'Returns one automation with its full node + edge graph.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const row = await prisma.automation.findFirst({ where: { id, userId: ctx.userId } });
            if (!row) return fail(`Automation ${id} not found`);
            return ok(row);
        },
    );

    reg(
        'list_executions',
        'Returns recent execution records for an automation, newest first. Each row: id, status, triggerType, channel, contact, duration, error.',
        { automationId: z.string(), limit: z.number().int().min(1).max(200).optional() },
        async ({ automationId, limit }, ctx) => {
            const auto = await prisma.automation.findFirst({ where: { id: automationId, userId: ctx.userId } });
            if (!auto) return fail(`Automation ${automationId} not found`);
            const rows = await prisma.automationExecution.findMany({
                where: { automationId },
                orderBy: { startedAt: 'desc' },
                take: Math.min(limit || 50, 200),
            });
            return ok(rows);
        },
    );

    reg(
        'create_automation',
        'Creates a new automation. Provide nodes + edges in the same shape used by the UI. Call describe_automation_node_types first so the `type` strings and `data` field names are correct. The graph executes on incoming messages once `isActive` is true.',
        {
            name: z.string().min(1),
            isActive: z.boolean().optional(),
            nodes: z.array(nodeSchema).default([]),
            edges: z.array(edgeSchema).default([]),
        },
        async ({ name, isActive, nodes, edges }, ctx) => {
            const err = validateGraph(nodes);
            if (err) return fail(err);
            const row = await prisma.automation.create({
                data: {
                    userId: ctx.userId,
                    name,
                    isActive: isActive ?? false,
                    nodes: nodes as any,
                    edges: edges as any,
                },
            });
            return ok(row);
        },
    );

    reg(
        'update_automation',
        'Updates an existing automation. Any omitted field is left unchanged. When updating nodes/edges, you must supply the full arrays — partial graph patches are not supported.',
        {
            id: z.string(),
            name: z.string().min(1).optional(),
            isActive: z.boolean().optional(),
            nodes: z.array(nodeSchema).optional(),
            edges: z.array(edgeSchema).optional(),
        },
        async ({ id, name, isActive, nodes, edges }, ctx) => {
            const existing = await prisma.automation.findFirst({ where: { id, userId: ctx.userId } });
            if (!existing) return fail(`Automation ${id} not found`);
            if (nodes) {
                const err = validateGraph(nodes);
                if (err) return fail(err);
            }
            const row = await prisma.automation.update({
                where: { id },
                data: {
                    ...(name !== undefined ? { name } : {}),
                    ...(isActive !== undefined ? { isActive } : {}),
                    ...(nodes !== undefined ? { nodes: nodes as any } : {}),
                    ...(edges !== undefined ? { edges: edges as any } : {}),
                },
            });
            return ok(row);
        },
    );

    reg(
        'toggle_automation_active',
        'Activates or deactivates an automation. Inactive automations do not fire on incoming messages.',
        { id: z.string(), isActive: z.boolean() },
        async ({ id, isActive }, ctx) => {
            const existing = await prisma.automation.findFirst({ where: { id, userId: ctx.userId } });
            if (!existing) return fail(`Automation ${id} not found`);
            const row = await prisma.automation.update({ where: { id }, data: { isActive } });
            return ok({ id: row.id, isActive: row.isActive });
        },
    );

    reg(
        'delete_automation',
        'Permanently deletes an automation. The audit log entry is preserved. This action cannot be undone.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const existing = await prisma.automation.findFirst({ where: { id, userId: ctx.userId } });
            if (!existing) return fail(`Automation ${id} not found`);
            await prisma.automation.delete({ where: { id } });
            return ok({ deleted: true, id });
        },
    );
}

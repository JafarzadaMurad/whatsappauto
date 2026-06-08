import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { ok, fail, type RegisterToolFn } from '../mcp.server';

const FIELD_TYPES = ['text', 'number', 'date', 'select', 'boolean'] as const;

const slugify = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || `field_${Date.now()}`;

export function registerUserFieldTools(reg: RegisterToolFn) {
    reg(
        'list_user_fields',
        'Lists all user-defined custom fields on contacts (key, label, type, options, order).',
        {},
        async (_args, ctx) => {
            const rows = await prisma.userField.findMany({
                where: { workspaceId: ctx.workspaceId },
                orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
            });
            return ok(rows);
        },
    );

    reg(
        'create_user_field',
        'Defines a new custom field. Type must be one of: text, number, date, select, boolean. Pass `options` only when type is "select".',
        {
            label: z.string().min(1).max(80),
            key: z.string().min(1).max(40).regex(/^[a-z][a-z0-9_]*$/).optional(),
            type: z.enum(FIELD_TYPES),
            options: z.array(z.string().min(1)).optional(),
        },
        async (args, ctx) => {
            const key = args.key || slugify(args.label);
            const conflict = await prisma.userField.findFirst({ where: { workspaceId: ctx.workspaceId, key } });
            if (conflict) return fail(`Field key "${key}" already exists`);
            const lastOrder = await prisma.userField.aggregate({ where: { workspaceId: ctx.workspaceId }, _max: { order: true } });
            const order = (lastOrder._max.order ?? -1) + 1;
            const row = await prisma.userField.create({
                data: {
                    userId: ctx.userId,
                    workspaceId: ctx.workspaceId,
                    key,
                    label: args.label,
                    type: args.type,
                    options: args.type === 'select' ? (args.options || []) : [],
                    order,
                },
            });
            return ok(row);
        },
    );

    reg(
        'update_user_field',
        'Updates an existing custom field. Omitted parameters are left unchanged.',
        {
            id: z.string(),
            label: z.string().min(1).max(80).optional(),
            type: z.enum(FIELD_TYPES).optional(),
            options: z.array(z.string().min(1)).optional(),
        },
        async (args, ctx) => {
            const existing = await prisma.userField.findFirst({ where: { id: args.id, workspaceId: ctx.workspaceId } });
            if (!existing) return fail(`Field ${args.id} not found`);
            const row = await prisma.userField.update({
                where: { id: args.id },
                data: {
                    ...(args.label !== undefined ? { label: args.label } : {}),
                    ...(args.type !== undefined ? { type: args.type } : {}),
                    ...(args.options !== undefined ? { options: args.options } : {}),
                },
            });
            return ok(row);
        },
    );

    reg(
        'delete_user_field',
        'Deletes a custom field. Existing values in contacts.customFields are left in the database but stop being displayed.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const existing = await prisma.userField.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
            if (!existing) return fail(`Field ${id} not found`);
            await prisma.userField.delete({ where: { id } });
            return ok({ deleted: true, id });
        },
    );

    reg(
        'set_contact_field',
        'Writes a custom field value on a specific contact (phone for WhatsApp, IGSID for Instagram). Creates the contact if missing. Use after list_user_fields so you know the right `key`.',
        {
            phone: z.string().min(3),
            key: z.string().min(1),
            value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
        },
        async ({ phone, key, value }, ctx) => {
            const cleanPhone = phone.replace(/[^0-9]/g, '') || phone;
            const existing = await prisma.client.findFirst({
                where: { workspaceId: ctx.workspaceId, phone: cleanPhone },
                select: { id: true, customFields: true },
            });
            const merged: Record<string, any> = { ...((existing?.customFields as any) || {}), [key]: value };
            const client = existing
                ? await prisma.client.update({
                    where: { id: existing.id },
                    data: { customFields: merged },
                })
                : await prisma.client.create({
                    data: {
                        userId: ctx.userId,
                        workspaceId: ctx.workspaceId,
                        phone: cleanPhone,
                        status: 'NEW',
                        tags: [],
                        customFields: merged,
                    },
                });
            return ok({ clientId: client.id, phone: cleanPhone, key, value });
        },
    );

    reg(
        'get_contact_field',
        'Reads a single custom field value from a specific contact.',
        { phone: z.string().min(3), key: z.string().min(1) },
        async ({ phone, key }, ctx) => {
            const cleanPhone = phone.replace(/[^0-9]/g, '') || phone;
            const client = await prisma.client.findFirst({
                where: { workspaceId: ctx.workspaceId, phone: cleanPhone },
                select: { customFields: true },
            });
            const value = (client?.customFields as any)?.[key] ?? null;
            return ok({ phone: cleanPhone, key, value });
        },
    );
}

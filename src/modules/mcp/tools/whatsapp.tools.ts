import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { MessagingService } from '../../messaging/messaging.service';
import { ok, fail, type RegisterToolFn } from '../mcp.server';

const messaging = new MessagingService();

export function registerWhatsappTools(reg: RegisterToolFn) {
    reg(
        'list_whatsapp_instances',
        'Lists WhatsApp instances (connected numbers) owned by the calling user, with current status.',
        {},
        async (_args, ctx) => {
            const rows = await prisma.instance.findMany({
                where: { userId: ctx.userId },
                select: { id: true, name: true, status: true, agentId: true, createdAt: true, updatedAt: true },
                orderBy: { createdAt: 'desc' },
            });
            return ok(rows);
        },
    );

    reg(
        'get_whatsapp_instance',
        'Returns details about a specific WhatsApp instance.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const row = await prisma.instance.findFirst({ where: { id, userId: ctx.userId } });
            if (!row) return fail(`Instance ${id} not found`);
            return ok(row);
        },
    );

    reg(
        'create_whatsapp_instance',
        'Creates a new WhatsApp instance. After creation, the user must scan the QR code in the dashboard (Networks → WhatsApp) to link a phone — the QR cannot be returned through MCP.',
        { name: z.string().min(1), agentId: z.string().uuid().optional() },
        async ({ name, agentId }, ctx) => {
            if (agentId) {
                const agent = await prisma.agent.findFirst({ where: { id: agentId, userId: ctx.userId } });
                if (!agent) return fail(`Agent ${agentId} not found or not yours`);
            }
            const row = await prisma.instance.create({
                data: { userId: ctx.userId, name, agentId: agentId || null },
            });
            return ok({ ...row, note: 'Scan the QR code in the dashboard at /dashboard/whatsapp to finish linking.' });
        },
    );

    reg(
        'restart_whatsapp_instance',
        'Restarts a WhatsApp instance — useful when the connection is stuck.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const row = await prisma.instance.findFirst({ where: { id, userId: ctx.userId } });
            if (!row) return fail(`Instance ${id} not found`);
            // Mark status; the worker watches for status flips
            await prisma.instance.update({ where: { id }, data: { status: 'CONNECTING' } });
            return ok({ id, status: 'CONNECTING', note: 'A restart was requested. The worker will reconnect in a few seconds.' });
        },
    );

    reg(
        'delete_whatsapp_instance',
        'Permanently deletes a WhatsApp instance. The session is destroyed and the connection is dropped.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const row = await prisma.instance.findFirst({ where: { id, userId: ctx.userId } });
            if (!row) return fail(`Instance ${id} not found`);
            await prisma.instance.delete({ where: { id } });
            return ok({ deleted: true, id });
        },
    );

    reg(
        'send_whatsapp_text',
        'Sends a plain-text WhatsApp message from the given instance to a phone number (international format, e.g. 994501234567).',
        { instanceId: z.string().uuid(), to: z.string().min(5), text: z.string().min(1) },
        async ({ instanceId, to, text }, ctx) => {
            const inst = await prisma.instance.findFirst({ where: { id: instanceId, userId: ctx.userId } });
            if (!inst) return fail(`Instance ${instanceId} not found`);
            const result = await messaging.sendText(instanceId, to, text);
            return ok(result);
        },
    );

    reg(
        'send_whatsapp_media',
        'Sends a WhatsApp media message (image / video / audio / document). `url` must be publicly reachable; alChatBot fetches it on send. Optional caption appears with images / videos / documents.',
        {
            instanceId: z.string().uuid(),
            to: z.string().min(5),
            type: z.enum(['image', 'video', 'document', 'audio']),
            url: z.string().url(),
            caption: z.string().optional(),
            fileName: z.string().optional(),
            mimetype: z.string().optional(),
        },
        async ({ instanceId, to, type, url, caption, fileName, mimetype }, ctx) => {
            const inst = await prisma.instance.findFirst({ where: { id: instanceId, userId: ctx.userId } });
            if (!inst) return fail(`Instance ${instanceId} not found`);
            const result = await messaging.sendMedia(instanceId, to, type, url, caption, fileName, mimetype);
            return ok(result);
        },
    );
}

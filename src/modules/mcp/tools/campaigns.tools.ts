import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { ok, fail, type RegisterToolFn } from '../mcp.server';

export function registerCampaignTools(reg: RegisterToolFn) {
    reg(
        'list_campaigns',
        'Lists outbound message campaigns. Each row includes agent / instance names and recipient status counts.',
        {},
        async (_args, ctx) => {
            const rows = await prisma.campaign.findMany({
                where: { userId: ctx.userId },
                include: {
                    agent: { select: { name: true } },
                    instance: { select: { name: true } },
                    _count: { select: { recipients: true } },
                },
                orderBy: { createdAt: 'desc' },
            });
            return ok(rows);
        },
    );

    reg(
        'get_campaign',
        'Returns one campaign with its first 200 recipients and their status.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const row = await prisma.campaign.findFirst({
                where: { id, userId: ctx.userId },
                include: {
                    agent: { select: { name: true } },
                    instance: { select: { name: true } },
                    recipients: { take: 200, orderBy: { createdAt: 'asc' } },
                },
            });
            if (!row) return fail(`Campaign ${id} not found`);
            return ok(row);
        },
    );

    reg(
        'create_campaign',
        'Creates a new outbound campaign. The agent and instance must be owned by you. Each phone number in `phoneNumbers` becomes a recipient.',
        {
            name: z.string().min(1),
            agentId: z.string().uuid(),
            instanceId: z.string().uuid(),
            phoneNumbers: z.array(z.string().min(1)).min(1),
        },
        async ({ name, agentId, instanceId, phoneNumbers }, ctx) => {
            const [agent, instance] = await Promise.all([
                prisma.agent.findFirst({ where: { id: agentId, userId: ctx.userId } }),
                prisma.instance.findFirst({ where: { id: instanceId, userId: ctx.userId } }),
            ]);
            if (!agent) return fail(`Agent ${agentId} not found or not yours`);
            if (!instance) return fail(`Instance ${instanceId} not found or not yours`);

            const campaign = await prisma.campaign.create({
                data: { userId: ctx.userId, name, agentId, instanceId, status: 'PENDING' },
            });
            await prisma.campaignRecipient.createMany({
                data: phoneNumbers.map((p: string) => ({
                    campaignId: campaign.id,
                    phone: p,
                    remoteJid: `${p.replace(/[^0-9]/g, '')}@s.whatsapp.net`,
                    status: 'PENDING',
                })),
            });
            return ok(campaign);
        },
    );

    reg(
        'pause_campaign',
        'Pauses a running campaign. Pending recipients are halted; in-flight sends complete.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const existing = await prisma.campaign.findFirst({ where: { id, userId: ctx.userId } });
            if (!existing) return fail(`Campaign ${id} not found`);
            const row = await prisma.campaign.update({ where: { id }, data: { status: 'PAUSED' } });
            return ok(row);
        },
    );

    reg(
        'resume_campaign',
        'Resumes a paused campaign.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const existing = await prisma.campaign.findFirst({ where: { id, userId: ctx.userId } });
            if (!existing) return fail(`Campaign ${id} not found`);
            const row = await prisma.campaign.update({ where: { id }, data: { status: 'RUNNING' } });
            return ok(row);
        },
    );

    reg(
        'delete_campaign',
        'Deletes a campaign and its recipient rows.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const existing = await prisma.campaign.findFirst({ where: { id, userId: ctx.userId } });
            if (!existing) return fail(`Campaign ${id} not found`);
            await prisma.campaign.delete({ where: { id } });
            return ok({ deleted: true, id });
        },
    );
}

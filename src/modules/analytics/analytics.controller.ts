import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { getWorkspaceId } from '../../lib/workspace-context';
import {
    funnel, dailyVolume, channelSplit, tagConversion,
    agentPerformance, dropOff, kpis, contactList, count,
    AnalyticsFilters, Period,
} from './analytics.service';

const filtersSchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    status: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    channel: z.enum(['whatsapp', 'instagram']).optional(),
    agentId: z.string().uuid().optional(),
    instanceId: z.string().uuid().optional(),
    customField: z.object({ key: z.string(), value: z.any() }).optional(),
}).optional();

const querySchema = z.object({
    metric: z.enum(['funnel', 'daily_volume', 'channel_split', 'tag_conversion', 'agent_perf', 'drop_off', 'kpis', 'contact_list', 'count']),
    filters: filtersSchema,
    period: z.enum(['day', 'week', 'month']).optional(),
});

const widgetSchema = z.object({
    title: z.string().min(1).max(80),
    metric: z.string().min(1),
    filters: z.any().optional(),
    groupBy: z.string().optional().nullable(),
    visualType: z.enum(['kpi', 'line', 'bar', 'table', 'funnel']),
    size: z.enum(['sm', 'md', 'lg']).optional(),
    position: z.number().int().optional(),
});

export class AnalyticsController {
    async query(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const body = querySchema.parse(req.body);
            const filters: AnalyticsFilters = body.filters || {};
            const period: Period = body.period || 'day';

            let result: any;
            switch (body.metric) {
                case 'funnel':         result = await funnel(workspaceId, filters); break;
                case 'daily_volume':   result = await dailyVolume(workspaceId, filters, period); break;
                case 'channel_split':  result = await channelSplit(workspaceId, filters); break;
                case 'tag_conversion': result = await tagConversion(workspaceId, filters); break;
                case 'agent_perf':     result = await agentPerformance(workspaceId, filters); break;
                case 'drop_off':       result = await dropOff(workspaceId, filters); break;
                case 'kpis':           result = await kpis(workspaceId, filters); break;
                case 'contact_list':   result = await contactList(workspaceId, filters); break;
                case 'count':          result = await count(workspaceId, filters); break;
            }
            return res.json({ success: true, metric: body.metric, ...result });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // ─── Dashboard widgets CRUD ───
    async listWidgets(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const widgets = await prisma.dashboardWidget.findMany({
                where: { workspaceId },
                orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
            });
            return res.json({ success: true, widgets });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async createWidget(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const body = widgetSchema.parse(req.body);
            const maxPos = await prisma.dashboardWidget.aggregate({
                where: { workspaceId }, _max: { position: true },
            });
            const widget = await prisma.dashboardWidget.create({
                data: {
                    userId, workspaceId,
                    title: body.title,
                    metric: body.metric,
                    filters: (body.filters || {}) as any,
                    groupBy: body.groupBy || null,
                    visualType: body.visualType,
                    size: body.size || 'md',
                    position: body.position ?? ((maxPos._max.position || 0) + 1),
                },
            });
            return res.status(201).json({ success: true, widget });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async updateWidget(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = String(req.params.id);
            const body = widgetSchema.partial().parse(req.body);
            const existing = await prisma.dashboardWidget.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
            const widget = await prisma.dashboardWidget.update({
                where: { id },
                data: {
                    ...(body.title !== undefined ? { title: body.title } : {}),
                    ...(body.metric !== undefined ? { metric: body.metric } : {}),
                    ...(body.filters !== undefined ? { filters: body.filters as any } : {}),
                    ...(body.groupBy !== undefined ? { groupBy: body.groupBy || null } : {}),
                    ...(body.visualType !== undefined ? { visualType: body.visualType } : {}),
                    ...(body.size !== undefined ? { size: body.size } : {}),
                    ...(body.position !== undefined ? { position: body.position } : {}),
                },
            });
            return res.json({ success: true, widget });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async deleteWidget(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = String(req.params.id);
            const existing = await prisma.dashboardWidget.findFirst({ where: { id, workspaceId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
            await prisma.dashboardWidget.delete({ where: { id } });
            return res.json({ success: true });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }
}

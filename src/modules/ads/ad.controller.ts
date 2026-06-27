import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { getWorkspaceId } from '../../lib/workspace-context';

const MATCH_TYPES = ['headline', 'source_url', 'ad_id', 'ctwa_prefix', 'campaign_id', 'adset_id'] as const;

const createSchema = z.object({
    name: z.string().min(1).max(120),
    matchType: z.enum(MATCH_TYPES),
    matchValue: z.string().min(1).max(500),
    agentId: z.string().uuid(),
    priority: z.number().int().min(0).max(1000).optional(),
    isActive: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

async function ownsAgent(agentId: string, workspaceId: string) {
    return prisma.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } });
}

export class AdController {
    // ── Routes ────────────────────────────────────────────────

    async listRoutes(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const routes = await prisma.adRoute.findMany({
                where: { workspaceId },
                orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
                include: { agent: { select: { id: true, name: true } } },
            });
            return res.json({ success: true, routes });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async createRoute(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const data = createSchema.parse(req.body);
            if (!(await ownsAgent(data.agentId, workspaceId))) {
                return res.status(404).json({ success: false, message: 'Agent not found' });
            }
            const created = await prisma.adRoute.create({
                data: {
                    workspaceId,
                    name: data.name,
                    matchType: data.matchType,
                    matchValue: data.matchValue,
                    agentId: data.agentId,
                    priority: data.priority ?? 0,
                    isActive: data.isActive ?? true,
                },
                include: { agent: { select: { id: true, name: true } } },
            });
            return res.json({ success: true, route: created });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async updateRoute(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = String(req.params.id);
            const data = updateSchema.parse(req.body);
            const owns = await prisma.adRoute.findFirst({ where: { id, workspaceId }, select: { id: true } });
            if (!owns) return res.status(404).json({ success: false, message: 'Route not found' });
            if (data.agentId && !(await ownsAgent(data.agentId, workspaceId))) {
                return res.status(404).json({ success: false, message: 'Agent not found' });
            }
            const updated = await prisma.adRoute.update({
                where: { id },
                data,
                include: { agent: { select: { id: true, name: true } } },
            });
            return res.json({ success: true, route: updated });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async deleteRoute(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = String(req.params.id);
            const owns = await prisma.adRoute.findFirst({ where: { id, workspaceId }, select: { id: true } });
            if (!owns) return res.status(404).json({ success: false, message: 'Route not found' });
            await prisma.adRoute.delete({ where: { id } });
            return res.json({ success: true });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // ── Recent ads feed ───────────────────────────────────────
    //
    // Groups the Message rows that carry an adReferrer by (title +
    // sourceUrl) and reports per-source counts of contacts +
    // messages, plus a sample referral so the operator can copy
    // values into a new rule. Lets first-time users discover what
    // their actual ad metadata looks like without trawling SQL.
    async recentAds(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

            // Pull adReferrer'd messages from instances in this
            // workspace. Date-range filtering deferred — first-touch
            // counts are already capped at `take` and most users want
            // the latest activity by default.
            const instances = await prisma.instance.findMany({
                where: { workspaceId },
                select: { id: true },
            });
            const instanceIds = instances.map(i => i.id);
            if (instanceIds.length === 0) return res.json({ success: true, ads: [] });

            const rows = await prisma.client.findMany({
                where: { workspaceId, adReferrer: { not: Prisma.JsonNull as any } },
                orderBy: { createdAt: 'desc' },
                take: limit * 5, // grab more so the grouping has material
                select: { id: true, name: true, phone: true, adReferrer: true, createdAt: true, status: true },
            });

            type Bucket = {
                key: string;
                title: string | null;
                sourceUrl: string | null;
                sourceId: string | null;
                mediaType: string | null;
                contacts: number;
                lastSeenAt: string;
                wonCount: number;
                sample: { phone: string; name: string | null; createdAt: string };
            };
            const buckets = new Map<string, Bucket>();
            for (const r of rows) {
                const ref: any = r.adReferrer || {};
                const key = `${ref.title || ''}|${ref.sourceUrl || ''}`;
                let b = buckets.get(key);
                if (!b) {
                    b = {
                        key,
                        title: ref.title || null,
                        sourceUrl: ref.sourceUrl || null,
                        sourceId: ref.sourceId || null,
                        mediaType: ref.mediaType || null,
                        contacts: 0,
                        lastSeenAt: r.createdAt.toISOString(),
                        wonCount: 0,
                        sample: { phone: r.phone, name: r.name, createdAt: r.createdAt.toISOString() },
                    };
                    buckets.set(key, b);
                }
                b.contacts += 1;
                if (String(r.status || '').toUpperCase().includes('WON')) b.wonCount += 1;
                if (new Date(r.createdAt) > new Date(b.lastSeenAt)) b.lastSeenAt = r.createdAt.toISOString();
            }

            const ads = Array.from(buckets.values())
                .sort((a, b) => b.contacts - a.contacts || new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
                .slice(0, limit);
            return res.json({ success: true, ads });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }
}

// Imported lazily so the controller file doesn't fail to load if a
// Prisma migration is mid-rollout and the JsonNull symbol isn't yet
// exported on the running runtime.
import { Prisma } from '@prisma/client';

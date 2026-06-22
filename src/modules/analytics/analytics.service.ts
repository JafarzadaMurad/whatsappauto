import { prisma } from '../../lib/prisma';

// ─── Shared types ───
export type AnalyticsFilters = {
    from?: string;     // ISO date — defaults to 30 days ago
    to?: string;       // ISO date — defaults to now
    status?: string[]; // CRM status filter
    tags?: string[];   // any of these tags
    channel?: 'whatsapp' | 'instagram';
    agentId?: string;
    customField?: { key: string; value: any };
};

export type Period = 'day' | 'week' | 'month';

function dateRange(filters?: AnalyticsFilters): { from: Date; to: Date } {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return {
        from: filters?.from ? new Date(filters.from) : defaultFrom,
        to:   filters?.to   ? new Date(filters.to)   : now,
    };
}

function buildClientWhere(workspaceId: string, f: AnalyticsFilters) {
    const where: any = { workspaceId };
    if (f.status?.length) where.status = { in: f.status };
    if (f.tags?.length)   where.tags   = { hasSome: f.tags };
    if (f.channel)        where.channel = f.channel;
    if (f.customField?.key) {
        // Prisma Json path filter on a single key
        where.customFields = { path: [f.customField.key], equals: f.customField.value };
    }
    return where;
}

// ─── 1) Sales funnel ───
// NEW → LEAD → PURCHASED breakdown with conversion rates.
export async function funnel(workspaceId: string, f: AnalyticsFilters) {
    const { from, to } = dateRange(f);
    const where = {
        ...buildClientWhere(workspaceId, { ...f, status: undefined }),
        createdAt: { gte: from, lte: to },
    };
    const grouped = await prisma.client.groupBy({
        by: ['status'], where, _count: { _all: true },
    });
    const map: Record<string, number> = {};
    for (const row of grouped) map[row.status] = row._count._all;
    const steps = ['NEW', 'LEAD', 'PURCHASED', 'SPAM'];
    const rows = steps.map(s => ({ status: s, count: map[s] || 0 }));
    const total = rows.reduce((a, b) => a + b.count, 0);
    const lead = (map['LEAD'] || 0) + (map['PURCHASED'] || 0);
    const purchased = map['PURCHASED'] || 0;
    return {
        rows,
        total,
        rates: {
            leadRate:      total > 0 ? Math.round((lead / total) * 1000) / 10 : 0,
            purchaseRate:  total > 0 ? Math.round((purchased / total) * 1000) / 10 : 0,
            leadToPurchase: lead > 0  ? Math.round((purchased / lead) * 1000) / 10 : 0,
        },
    };
}

// ─── 2) Daily volume ───
// New inbound messages per day across selected channels.
export async function dailyVolume(workspaceId: string, f: AnalyticsFilters, period: Period = 'day') {
    const { from, to } = dateRange(f);
    // Workspace instance + IG account ids
    const [instances, igAccounts] = await Promise.all([
        prisma.instance.findMany({ where: { workspaceId }, select: { id: true } }),
        prisma.instagramAccount.findMany({ where: { workspaceId }, select: { id: true } }),
    ]);
    const instanceIds = instances.map(i => i.id);
    const igIds = igAccounts.map(a => a.id);
    if (instanceIds.length === 0 && igIds.length === 0) return { rows: [] };

    // Use raw SQL for DATE_TRUNC efficiency
    const trunc = period === 'week' ? 'week' : period === 'month' ? 'month' : 'day';
    const wantWa = !f.channel || f.channel === 'whatsapp';
    const wantIg = !f.channel || f.channel === 'instagram';

    const rows: Array<{ bucket: Date; channel: string; count: number }> = [];

    if (wantWa && instanceIds.length > 0) {
        const r: any[] = await prisma.$queryRawUnsafe(`
            SELECT DATE_TRUNC('${trunc}', "timestamp") AS bucket, COUNT(*)::int AS count
            FROM "Message"
            WHERE "instanceId" = ANY($1::text[])
              AND "isFromMe" = false
              AND "timestamp" >= $2 AND "timestamp" <= $3
            GROUP BY bucket ORDER BY bucket
        `, instanceIds, from, to);
        for (const x of r) rows.push({ bucket: x.bucket, channel: 'whatsapp', count: Number(x.count) });
    }
    if (wantIg && igIds.length > 0) {
        const r: any[] = await prisma.$queryRawUnsafe(`
            SELECT DATE_TRUNC('${trunc}', "createdAt") AS bucket, COUNT(*)::int AS count
            FROM "AiConversationLog"
            WHERE "instanceId" = ANY($1::text[])
              AND "userMessage" IS NOT NULL AND LENGTH("userMessage") > 0
              AND "createdAt" >= $2 AND "createdAt" <= $3
            GROUP BY bucket ORDER BY bucket
        `, igIds, from, to);
        for (const x of r) rows.push({ bucket: x.bucket, channel: 'instagram', count: Number(x.count) });
    }

    rows.sort((a, b) => a.bucket.getTime() - b.bucket.getTime());
    return { rows };
}

// ─── 3) Channel split ───
// One-shot total by channel for the period.
export async function channelSplit(workspaceId: string, f: AnalyticsFilters) {
    const { from, to } = dateRange(f);
    const where = {
        ...buildClientWhere(workspaceId, f),
        createdAt: { gte: from, lte: to },
    };
    const grouped = await prisma.client.groupBy({
        by: ['channel'], where, _count: { _all: true },
    });
    return {
        rows: grouped.map(g => ({ channel: g.channel || 'unknown', count: g._count._all })),
    };
}

// ─── 4) Tag conversion ───
// Per tag: how many contacts have it + how many became LEAD/PURCHASED.
export async function tagConversion(workspaceId: string, f: AnalyticsFilters) {
    const { from, to } = dateRange(f);
    const where = {
        ...buildClientWhere(workspaceId, { ...f, tags: undefined }),
        createdAt: { gte: from, lte: to },
    };
    const clients = await prisma.client.findMany({
        where,
        select: { tags: true, status: true },
    });
    const counts: Record<string, { total: number; lead: number; purchased: number }> = {};
    for (const c of clients) {
        for (const tag of (c.tags || [])) {
            if (!counts[tag]) counts[tag] = { total: 0, lead: 0, purchased: 0 };
            counts[tag].total += 1;
            if (c.status === 'LEAD' || c.status === 'PURCHASED') counts[tag].lead += 1;
            if (c.status === 'PURCHASED') counts[tag].purchased += 1;
        }
    }
    const rows = Object.entries(counts).map(([tag, v]) => ({
        tag, ...v,
        leadRate:     v.total > 0 ? Math.round((v.lead / v.total) * 1000) / 10 : 0,
        purchaseRate: v.total > 0 ? Math.round((v.purchased / v.total) * 1000) / 10 : 0,
    }));
    rows.sort((a, b) => b.total - a.total);
    return { rows: rows.slice(0, 30) };
}

// ─── 5) Agent performance ───
// Per agent: turn count, tokens, est cost. Cost uses rough $/1k token
// estimates that are good enough for trend; not billing-accurate.
const COST_PER_1K: Record<string, { input: number; output: number }> = {
    'gpt-4o':                { input: 0.0025, output: 0.01   },
    'gpt-4o-mini':           { input: 0.00015, output: 0.0006 },
    'gpt-4.1':               { input: 0.002,  output: 0.008  },
    'gpt-4.1-mini':          { input: 0.0004, output: 0.0016 },
    'gpt-4-turbo':           { input: 0.01,   output: 0.03   },
    'gpt-3.5-turbo':         { input: 0.0005, output: 0.0015 },
    'claude-3-5-sonnet':     { input: 0.003,  output: 0.015  },
    'claude-3-haiku':        { input: 0.00025, output: 0.00125 },
    'gemini-1.5-pro':        { input: 0.00125, output: 0.005 },
    'gemini-1.5-flash':      { input: 0.000075, output: 0.0003 },
};
function costFor(model: string, prompt: number, completion: number): number {
    const m = COST_PER_1K[model] || COST_PER_1K['gpt-4o-mini'];
    return ((prompt / 1000) * m.input) + ((completion / 1000) * m.output);
}

export async function agentPerformance(workspaceId: string, f: AnalyticsFilters) {
    const { from, to } = dateRange(f);
    const agents = await prisma.agent.findMany({
        where: { workspaceId, ...(f.agentId ? { id: f.agentId } : {}) },
        select: { id: true, name: true, isRouter: true, model: true, provider: { select: { provider: true } } },
    });
    if (agents.length === 0) return { rows: [], totals: { turns: 0, tokens: 0, costUsd: 0 } };

    const grouped = await prisma.aiConversationLog.groupBy({
        by: ['agentId'],
        where: {
            agentId: { in: agents.map(a => a.id) },
            createdAt: { gte: from, lte: to },
        },
        _count: { _all: true },
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true },
    });
    const byId = new Map(grouped.map(g => [g.agentId, g]));
    const rows = agents.map(a => {
        const g = byId.get(a.id);
        const prompt = g?._sum.promptTokens || 0;
        const completion = g?._sum.completionTokens || 0;
        const total = g?._sum.totalTokens || (prompt + completion);
        const cost = costFor(a.model, prompt, completion);
        return {
            agentId: a.id,
            name: a.name,
            isRouter: !!a.isRouter,
            provider: a.provider?.provider || 'UNKNOWN',
            model: a.model,
            turns: g?._count._all || 0,
            promptTokens: prompt,
            completionTokens: completion,
            totalTokens: total,
            estCostUsd: Math.round(cost * 10000) / 10000,
        };
    });
    rows.sort((a, b) => b.turns - a.turns);
    const totals = rows.reduce((acc, r) => ({
        turns: acc.turns + r.turns,
        tokens: acc.tokens + r.totalTokens,
        costUsd: acc.costUsd + r.estCostUsd,
    }), { turns: 0, tokens: 0, costUsd: 0 });
    totals.costUsd = Math.round(totals.costUsd * 10000) / 10000;
    return { rows, totals };
}

// ─── 6) Drop-off points ───
// The last assistant message in conversations that went cold (no
// follow-up from the customer for >24h). Grouped to surface which
// agent question loses customers most often.
export async function dropOff(workspaceId: string, f: AnalyticsFilters) {
    const { from, to } = dateRange(f);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const instances = await prisma.instance.findMany({ where: { workspaceId }, select: { id: true } });
    const instanceIds = instances.map(i => i.id);
    if (instanceIds.length === 0) return { rows: [] };

    // For each (instanceId, remoteJid), find the last message timestamp
    // and the most recent assistant turn before that. If the last
    // message was from the assistant and older than 24h, that's a
    // drop-off candidate.
    const rows: any[] = await prisma.$queryRawUnsafe(`
        WITH last_per_chat AS (
            SELECT "instanceId", "remoteJid",
                   MAX("timestamp") AS last_ts
            FROM "Message"
            WHERE "instanceId" = ANY($1::text[])
              AND "timestamp" >= $2 AND "timestamp" <= $3
            GROUP BY "instanceId", "remoteJid"
        )
        SELECT m."content" AS reply,
               COUNT(*)::int AS times,
               MAX(m."timestamp") AS latest
        FROM "Message" m
        JOIN last_per_chat lpc ON lpc."instanceId" = m."instanceId" AND lpc."remoteJid" = m."remoteJid" AND lpc.last_ts = m."timestamp"
        WHERE m."isFromMe" = true
          AND lpc.last_ts < $4
          AND m."content" IS NOT NULL AND LENGTH(m."content") > 10
        GROUP BY m."content"
        ORDER BY times DESC
        LIMIT 25
    `, instanceIds, from, to, cutoff);

    return { rows: rows.map(r => ({ reply: r.reply, times: Number(r.times), latest: r.latest })) };
}

// ─── 7) KPIs strip (small numbers for the top of the page) ───
export async function kpis(workspaceId: string, f: AnalyticsFilters) {
    const { from, to } = dateRange(f);
    const [totalContacts, newContacts, leadCount, purchasedCount, totalLogs, tokensAgg, operatorTickets] = await Promise.all([
        prisma.client.count({ where: { workspaceId } }),
        prisma.client.count({ where: { workspaceId, createdAt: { gte: from, lte: to } } }),
        prisma.client.count({ where: { workspaceId, status: 'LEAD', createdAt: { gte: from, lte: to } } }),
        prisma.client.count({ where: { workspaceId, status: 'PURCHASED', createdAt: { gte: from, lte: to } } }),
        prisma.aiConversationLog.count({
            where: {
                createdAt: { gte: from, lte: to },
                agent: { workspaceId },
            },
        }),
        prisma.aiConversationLog.aggregate({
            where: {
                createdAt: { gte: from, lte: to },
                agent: { workspaceId },
            },
            _sum: { totalTokens: true },
        }),
        prisma.operatorRequest.count({
            where: {
                createdAt: { gte: from, lte: to },
                agent: { workspaceId },
            },
        }),
    ]);
    return {
        totalContacts,
        newContacts,
        leadCount,
        purchasedCount,
        totalAiTurns: totalLogs,
        totalTokens: tokensAgg._sum.totalTokens || 0,
        operatorTickets,
    };
}

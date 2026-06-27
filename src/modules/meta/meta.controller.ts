import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { getWorkspaceId } from '../../lib/workspace-context';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import {
    getMetaAppCreds, exchangeCodeForToken, exchangeForLongLivedToken,
    getMe, listUserAdAccounts, listAdsInAccount, listCampaignsInAccount,
    listAdSetsInAccount, getAdInsights, setObjectStatus, formatMetaError,
} from './meta-graph';

// `email` was here originally but Marketing API doesn't need it,
// and including a scope the app isn't configured for triggers FB's
// dev-only "Invalid Scopes" warning. Only ads-required scopes here.
const META_OAUTH_SCOPE = ['ads_read', 'business_management', 'public_profile'].join(',');

function getRedirectUri(): string {
    const base = config.FRONTEND_URL || 'https://chatbot.tur.al';
    return `${base.replace(/\/$/, '')}/dashboard/meta/callback`;
}

const saveAccountSchema = z.object({
    accessToken: z.string().min(20),
    fbUserId: z.string().optional(),
    fbUserName: z.string().optional(),
    tokenExpiresAt: z.string().datetime().optional(),
    accounts: z.array(z.object({
        adAccountId: z.string().min(3),  // "act_XXXX"
        accountName: z.string().min(1),
        currency: z.string().optional(),
    })).min(1),
});

const bindAgentSchema = z.object({
    agentId: z.string().uuid(),
    adName: z.string().min(1).max(120),
});

export class MetaController {
    // ── OAuth ─────────────────────────────────────────────────

    // GET /api/meta/auth-url — returns the FB Login dialog URL the
    // browser should open. The user lands back at the dashboard
    // callback page, which posts the code to /api/meta/exchange.
    async authUrl(_req: Request, res: Response) {
        try {
            const creds = await getMetaAppCreds();
            if (!creds) return res.status(500).json({ success: false, message: 'Meta App ID / Secret are not configured in System Config.' });
            const redirectUri = getRedirectUri();
            // New "Facebook Login for Business" product requires
            // config_id (which encapsulates scope + redirect URIs +
            // login type set up in the Meta console). When the admin
            // has wired META_ADS_CONFIG_ID we use that URL shape.
            // Falls back to the classic scope= URL for apps still on
            // the legacy "Facebook Login" product.
            const url = creds.adsConfigId
                ? `https://www.facebook.com/v20.0/dialog/oauth` +
                    `?client_id=${creds.appId}` +
                    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
                    `&response_type=code` +
                    `&config_id=${creds.adsConfigId}`
                : `https://www.facebook.com/v20.0/dialog/oauth` +
                    `?client_id=${creds.appId}` +
                    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
                    `&response_type=code` +
                    `&scope=${encodeURIComponent(META_OAUTH_SCOPE)}`;
            return res.json({ success: true, url });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // POST /api/meta/exchange — the callback page posts {code}, we
    // do the short→long token swap, fetch the user profile + their
    // ad accounts, and return them so the UI can ask "which one of
    // these do you want to connect?"
    async exchange(req: Request, res: Response) {
        try {
            const code = String(req.body?.code || '').trim();
            if (!code) return res.status(400).json({ success: false, message: 'code is required' });

            const redirectUri = getRedirectUri();
            const shortTok = await exchangeCodeForToken(code, redirectUri);
            const longTok = await exchangeForLongLivedToken(shortTok.access_token);
            const me = await getMe(longTok.access_token);
            const accounts = await listUserAdAccounts(longTok.access_token);

            const expiresAt = longTok.expires_in
                ? new Date(Date.now() + longTok.expires_in * 1000).toISOString()
                : null;

            return res.json({
                success: true,
                accessToken: longTok.access_token,
                tokenExpiresAt: expiresAt,
                fbUserId: me.id,
                fbUserName: me.name,
                accounts: accounts.map(a => ({
                    adAccountId: a.id,
                    accountIdRaw: a.account_id,
                    accountName: a.name,
                    currency: a.currency,
                    status: a.account_status,
                })),
            });
        } catch (e: any) {
            logger.error({ err: e?.response?.data || e?.message }, '[meta] exchange failed');
            return res.status(500).json({ success: false, message: formatMetaError(e) });
        }
    }

    // ── Connected accounts ────────────────────────────────────

    async listAccounts(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const accounts = await prisma.metaAdAccount.findMany({
                where: { workspaceId },
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true, fbUserId: true, fbUserName: true, adAccountId: true,
                    accountName: true, currency: true, status: true, lastError: true,
                    lastSyncedAt: true, tokenExpiresAt: true, createdAt: true,
                    // accessToken stays server-side
                },
            });
            return res.json({ success: true, accounts });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // POST /api/meta/accounts — save one or more ad accounts picked
    // from /exchange's response.
    async saveAccounts(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const data = saveAccountSchema.parse(req.body);
            const expiresAt = data.tokenExpiresAt ? new Date(data.tokenExpiresAt) : null;
            const created = [] as any[];
            for (const acc of data.accounts) {
                const saved = await prisma.metaAdAccount.upsert({
                    where: { workspaceId_adAccountId: { workspaceId, adAccountId: acc.adAccountId } },
                    update: {
                        accessToken: data.accessToken, tokenExpiresAt: expiresAt,
                        fbUserId: data.fbUserId, fbUserName: data.fbUserName,
                        accountName: acc.accountName, currency: acc.currency,
                        status: 'active', lastError: null,
                    },
                    create: {
                        workspaceId,
                        accessToken: data.accessToken,
                        tokenExpiresAt: expiresAt,
                        fbUserId: data.fbUserId,
                        fbUserName: data.fbUserName,
                        adAccountId: acc.adAccountId,
                        accountName: acc.accountName,
                        currency: acc.currency,
                        status: 'active',
                    },
                });
                created.push({ id: saved.id, adAccountId: saved.adAccountId, accountName: saved.accountName });
            }
            return res.json({ success: true, accounts: created });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async deleteAccount(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = String(req.params.id);
            const owns = await prisma.metaAdAccount.findFirst({ where: { id, workspaceId }, select: { id: true } });
            if (!owns) return res.status(404).json({ success: false, message: 'Account not found' });
            await prisma.metaAdAccount.delete({ where: { id } });
            return res.json({ success: true });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // ── Ads + insights ────────────────────────────────────────

    async listAds(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = String(req.params.id);
            const acc = await prisma.metaAdAccount.findFirst({ where: { id, workspaceId } });
            if (!acc) return res.status(404).json({ success: false, message: 'Account not found' });

            try {
                const ads = await listAdsInAccount(acc.accessToken, acc.adAccountId);

                // Refresh the MetaAd cache used by the runtime routing
                // engine so a campaign-level / adset-level AdRoute can
                // resolve the hierarchy of an incoming click-to-WhatsApp
                // arrival without hitting Marketing API on the hot path.
                await Promise.all(ads.map(a => prisma.metaAd.upsert({
                    where: { adId: a.id },
                    update: {
                        metaAdAccountId: acc.id,
                        name: a.name || null,
                        adsetId: a.adset?.id || a.adset_id || null,
                        adsetName: a.adset?.name || null,
                        campaignId: a.campaign?.id || a.campaign_id || null,
                        campaignName: a.campaign?.name || null,
                        status: a.status || null,
                        effectiveStatus: a.effective_status || null,
                        thumbnailUrl: a.creative?.thumbnail_url || a.creative?.image_url || null,
                        createdTime: a.created_time ? new Date(a.created_time) : null,
                        lastSyncedAt: new Date(),
                    },
                    create: {
                        adId: a.id,
                        metaAdAccountId: acc.id,
                        name: a.name || null,
                        adsetId: a.adset?.id || a.adset_id || null,
                        adsetName: a.adset?.name || null,
                        campaignId: a.campaign?.id || a.campaign_id || null,
                        campaignName: a.campaign?.name || null,
                        status: a.status || null,
                        effectiveStatus: a.effective_status || null,
                        thumbnailUrl: a.creative?.thumbnail_url || a.creative?.image_url || null,
                        createdTime: a.created_time ? new Date(a.created_time) : null,
                        lastSyncedAt: new Date(),
                    },
                }).catch(() => null)));

                // Pull bindings AT ALL THREE LEVELS so the UI can compute
                // preemption (parent bound → child can't bind).
                const routes = await prisma.adRoute.findMany({
                    where: { workspaceId, matchType: { in: ['ad_id', 'adset_id', 'campaign_id'] } },
                    select: { id: true, matchType: true, matchValue: true, agentId: true, agent: { select: { name: true } }, isActive: true },
                });
                const routeBy: Record<string, Map<string, any>> = {
                    ad_id: new Map(),
                    adset_id: new Map(),
                    campaign_id: new Map(),
                };
                for (const r of routes) routeBy[r.matchType]?.set(r.matchValue, r);

                await prisma.metaAdAccount.update({
                    where: { id }, data: { lastSyncedAt: new Date(), status: 'active', lastError: null },
                }).catch(() => {});

                return res.json({
                    success: true,
                    ads: ads.map(a => {
                        const adsetRoute = a.adset?.id ? routeBy.adset_id.get(a.adset.id) : null;
                        const campaignRoute = a.campaign?.id ? routeBy.campaign_id.get(a.campaign.id) : null;
                        return {
                            id: a.id,
                            name: a.name,
                            status: a.status,
                            effectiveStatus: a.effective_status,
                            createdTime: a.created_time,
                            campaign: a.campaign,
                            adset: a.adset,
                            thumbnailUrl: a.creative?.thumbnail_url || a.creative?.image_url || null,
                            route: routeBy.ad_id.get(a.id) || null,
                            // What's binding this row from above (if anything).
                            // The frontend disables the bind dropdown when this is set.
                            inheritedRoute: campaignRoute
                                ? { ...campaignRoute, level: 'campaign' }
                                : adsetRoute
                                    ? { ...adsetRoute, level: 'adset' }
                                    : null,
                        };
                    }),
                });
            } catch (apiErr: any) {
                const msg = formatMetaError(apiErr);
                await prisma.metaAdAccount.update({
                    where: { id }, data: { status: 'error', lastError: msg.slice(0, 500) },
                }).catch(() => {});
                return res.status(502).json({ success: false, message: msg });
            }
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // GET /api/meta/accounts/:id/campaigns
    async listCampaigns(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = String(req.params.id);
            const acc = await prisma.metaAdAccount.findFirst({ where: { id, workspaceId } });
            if (!acc) return res.status(404).json({ success: false, message: 'Account not found' });

            try {
                const campaigns = await listCampaignsInAccount(acc.accessToken, acc.adAccountId);
                const routes = await prisma.adRoute.findMany({
                    where: { workspaceId, matchType: 'campaign_id', matchValue: { in: campaigns.map(c => c.id) } },
                    select: { id: true, matchValue: true, agentId: true, agent: { select: { name: true } }, isActive: true },
                });
                const routeByCampaignId = new Map(routes.map(r => [r.matchValue, r]));
                return res.json({
                    success: true,
                    campaigns: campaigns.map(c => ({
                        id: c.id,
                        name: c.name,
                        status: c.status,
                        effectiveStatus: c.effective_status,
                        objective: c.objective,
                        dailyBudget: c.daily_budget,
                        lifetimeBudget: c.lifetime_budget,
                        createdTime: c.created_time,
                        route: routeByCampaignId.get(c.id) || null,
                    })),
                });
            } catch (apiErr: any) {
                return res.status(502).json({ success: false, message: formatMetaError(apiErr) });
            }
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // GET /api/meta/accounts/:id/adsets
    async listAdSets(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = String(req.params.id);
            const acc = await prisma.metaAdAccount.findFirst({ where: { id, workspaceId } });
            if (!acc) return res.status(404).json({ success: false, message: 'Account not found' });

            try {
                const adsets = await listAdSetsInAccount(acc.accessToken, acc.adAccountId);
                const routes = await prisma.adRoute.findMany({
                    where: { workspaceId, matchType: { in: ['adset_id', 'campaign_id'] } },
                    select: { id: true, matchType: true, matchValue: true, agentId: true, agent: { select: { name: true } }, isActive: true },
                });
                const adsetRoute = new Map(routes.filter(r => r.matchType === 'adset_id').map(r => [r.matchValue, r]));
                const campaignRoute = new Map(routes.filter(r => r.matchType === 'campaign_id').map(r => [r.matchValue, r]));
                return res.json({
                    success: true,
                    adsets: adsets.map(s => {
                        const cRoute = s.campaign?.id ? campaignRoute.get(s.campaign.id) : null;
                        return {
                            id: s.id,
                            name: s.name,
                            status: s.status,
                            effectiveStatus: s.effective_status,
                            optimizationGoal: s.optimization_goal,
                            dailyBudget: s.daily_budget,
                            lifetimeBudget: s.lifetime_budget,
                            createdTime: s.created_time,
                            campaign: s.campaign,
                            route: adsetRoute.get(s.id) || null,
                            inheritedRoute: cRoute ? { ...cRoute, level: 'campaign' } : null,
                        };
                    }),
                });
            } catch (apiErr: any) {
                return res.status(502).json({ success: false, message: formatMetaError(apiErr) });
            }
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // GET /api/meta/accounts/:id/objects/:level/:objectId/insights
    async objectInsights(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = String(req.params.id);
            const objectId = String(req.params.objectId);
            const datePreset = String(req.query.preset || 'last_7d');
            const acc = await prisma.metaAdAccount.findFirst({ where: { id, workspaceId } });
            if (!acc) return res.status(404).json({ success: false, message: 'Account not found' });

            try {
                // The Marketing API insights edge takes any Ad / AdSet /
                // Campaign id at the same path, so getAdInsights doubles
                // as our generic helper.
                const insights = await getAdInsights(acc.accessToken, objectId, datePreset);
                return res.json({ success: true, insights });
            } catch (apiErr: any) {
                return res.status(502).json({ success: false, message: formatMetaError(apiErr) });
            }
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // GET /api/meta/accounts/:id/objects/:level/:objectId/contacts
    //
    // Returns CRM contacts whose first-touch attribution matches the
    // requested level. Ad-level uses the sourceId equality JSON path;
    // adset / campaign levels first resolve the list of cached
    // MetaAd ids underneath the parent, then match against any of
    // them via `in`.
    async objectContacts(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = String(req.params.id);
            const level = String(req.params.level);
            const objectId = String(req.params.objectId);
            const preset = String(req.query.preset || 'maximum');
            const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
            const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.pageSize || '15'), 10) || 15));

            const acc = await prisma.metaAdAccount.findFirst({ where: { id, workspaceId }, select: { id: true } });
            if (!acc) return res.status(404).json({ success: false, message: 'Account not found' });

            const dateFilter =
                preset === 'last_7d'  ? { createdAt: { gte: new Date(Date.now() - 7  * 24 * 3600 * 1000) } } :
                preset === 'last_30d' ? { createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } } :
                                        {};

            let where: any;
            if (level === 'ad') {
                where = {
                    workspaceId,
                    ...dateFilter,
                    adReferrer: { path: ['sourceId'], equals: objectId },
                };
            } else if (level === 'adset' || level === 'campaign') {
                // Resolve all cached ad ids under this parent, then OR
                // them via Postgres' JSON path-in filter.
                const childAds = await prisma.metaAd.findMany({
                    where: level === 'adset' ? { adsetId: objectId } : { campaignId: objectId },
                    select: { adId: true },
                });
                const ids = childAds.map(a => a.adId);
                if (ids.length === 0) return res.json({ success: true, contacts: [], total: 0, page, pageSize });
                where = {
                    workspaceId,
                    ...dateFilter,
                    adReferrer: { path: ['sourceId'], in: ids },
                };
            } else {
                return res.status(400).json({ success: false, message: 'Invalid level' });
            }

            const [contacts, total] = await Promise.all([
                prisma.client.findMany({
                    where,
                    orderBy: { createdAt: 'desc' },
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                    select: {
                        id: true, name: true, phone: true, status: true,
                        tags: true, createdAt: true, isAnonymous: true,
                        assignedAgent: { select: { id: true, name: true } },
                    },
                }),
                prisma.client.count({ where }),
            ]);

            return res.json({ success: true, contacts, total, page, pageSize });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // Generic bind for any of the 3 levels.
    // POST /api/meta/accounts/:id/objects/:level/:objectId/bind
    async bindObject(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = String(req.params.id);
            const level = String(req.params.level);  // 'campaign' | 'adset' | 'ad'
            const objectId = String(req.params.objectId);
            const data = bindAgentSchema.parse(req.body);

            const matchType =
                level === 'campaign' ? 'campaign_id' :
                level === 'adset'    ? 'adset_id'    :
                level === 'ad'       ? 'ad_id'       : null;
            if (!matchType) return res.status(400).json({ success: false, message: 'Invalid level — use campaign / adset / ad' });

            const acc = await prisma.metaAdAccount.findFirst({ where: { id, workspaceId }, select: { id: true } });
            if (!acc) return res.status(404).json({ success: false, message: 'Account not found' });
            const agent = await prisma.agent.findFirst({ where: { id: data.agentId, workspaceId }, select: { id: true } });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

            // Preemption guard — refuse to bind a child if any ancestor
            // already has its own binding. The cached MetaAd hierarchy
            // lets us walk up from an ad to its adset+campaign without
            // hitting Marketing API. Adsets walk up to their campaign.
            if (matchType === 'ad_id') {
                const metaAd = await prisma.metaAd.findUnique({ where: { adId: objectId }, select: { campaignId: true, adsetId: true } });
                if (metaAd?.adsetId) {
                    const adsetBound = await prisma.adRoute.findFirst({ where: { workspaceId, matchType: 'adset_id', matchValue: metaAd.adsetId } });
                    if (adsetBound) return res.status(409).json({ success: false, message: "This ad's ad set is already bound — unbind that first." });
                }
                if (metaAd?.campaignId) {
                    const cBound = await prisma.adRoute.findFirst({ where: { workspaceId, matchType: 'campaign_id', matchValue: metaAd.campaignId } });
                    if (cBound) return res.status(409).json({ success: false, message: "This ad's campaign is already bound — unbind that first." });
                }
            } else if (matchType === 'adset_id') {
                // We don't store adset→campaign in our cache directly,
                // but we can derive it from any MetaAd row in this adset.
                const sibling = await prisma.metaAd.findFirst({ where: { adsetId: objectId }, select: { campaignId: true } });
                if (sibling?.campaignId) {
                    const cBound = await prisma.adRoute.findFirst({ where: { workspaceId, matchType: 'campaign_id', matchValue: sibling.campaignId } });
                    if (cBound) return res.status(409).json({ success: false, message: "This ad set's campaign is already bound — unbind that first." });
                }
            }

            const existing = await prisma.adRoute.findFirst({ where: { workspaceId, matchType, matchValue: objectId } });
            const route = existing
                ? await prisma.adRoute.update({
                    where: { id: existing.id },
                    data: { agentId: data.agentId, name: data.adName, isActive: true, priority: 100 },
                    include: { agent: { select: { id: true, name: true } } },
                })
                : await prisma.adRoute.create({
                    data: {
                        workspaceId,
                        name: data.adName,
                        matchType,
                        matchValue: objectId,
                        agentId: data.agentId,
                        priority: 100,
                        isActive: true,
                    },
                    include: { agent: { select: { id: true, name: true } } },
                });
            return res.json({ success: true, route });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async unbindObject(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const level = String(req.params.level);
            const objectId = String(req.params.objectId);
            const matchType =
                level === 'campaign' ? 'campaign_id' :
                level === 'adset'    ? 'adset_id'    :
                level === 'ad'       ? 'ad_id'       : null;
            if (!matchType) return res.status(400).json({ success: false, message: 'Invalid level' });
            const existing = await prisma.adRoute.findFirst({ where: { workspaceId, matchType, matchValue: objectId } });
            if (!existing) return res.json({ success: true });
            await prisma.adRoute.delete({ where: { id: existing.id } });
            return res.json({ success: true });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // POST /api/meta/accounts/:id/objects/:level/:objectId/status
    // body: { status: 'ACTIVE' | 'PAUSED' }
    async setObjectStatus(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = String(req.params.id);
            const objectId = String(req.params.objectId);
            const status = String(req.body?.status || '');
            if (status !== 'ACTIVE' && status !== 'PAUSED') {
                return res.status(400).json({ success: false, message: "status must be 'ACTIVE' or 'PAUSED'" });
            }
            const acc = await prisma.metaAdAccount.findFirst({ where: { id, workspaceId } });
            if (!acc) return res.status(404).json({ success: false, message: 'Account not found' });

            try {
                await setObjectStatus(acc.accessToken, objectId, status as 'ACTIVE' | 'PAUSED');
                return res.json({ success: true, status });
            } catch (apiErr: any) {
                return res.status(502).json({ success: false, message: formatMetaError(apiErr) });
            }
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }
}

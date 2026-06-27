import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { getWorkspaceId } from '../../lib/workspace-context';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import {
    getMetaAppCreds, exchangeCodeForToken, exchangeForLongLivedToken,
    getMe, listUserAdAccounts, listAdsInAccount, getAdInsights, formatMetaError,
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
                // Mark which ads already have an AdRoute bound so the
                // UI can highlight them and show the agent name.
                const adIds = ads.map(a => a.id);
                const existingRoutes = adIds.length > 0 ? await prisma.adRoute.findMany({
                    where: { workspaceId, matchType: 'ad_id', matchValue: { in: adIds } },
                    select: { id: true, matchValue: true, agentId: true, agent: { select: { name: true } }, isActive: true },
                }) : [];
                const routeByAdId = new Map<string, any>();
                for (const r of existingRoutes) routeByAdId.set(r.matchValue, r);

                await prisma.metaAdAccount.update({
                    where: { id }, data: { lastSyncedAt: new Date(), status: 'active', lastError: null },
                }).catch(() => {});

                return res.json({
                    success: true,
                    ads: ads.map(a => ({
                        id: a.id,
                        name: a.name,
                        status: a.status,
                        effectiveStatus: a.effective_status,
                        createdTime: a.created_time,
                        campaign: a.campaign,
                        adset: a.adset,
                        thumbnailUrl: a.creative?.thumbnail_url || a.creative?.image_url || null,
                        route: routeByAdId.get(a.id) || null,
                    })),
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

    async adInsights(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = String(req.params.id);
            const adId = String(req.params.adId);
            const datePreset = String(req.query.preset || 'last_7d');
            const acc = await prisma.metaAdAccount.findFirst({ where: { id, workspaceId } });
            if (!acc) return res.status(404).json({ success: false, message: 'Account not found' });

            try {
                const insights = await getAdInsights(acc.accessToken, adId, datePreset);
                return res.json({ success: true, insights });
            } catch (apiErr: any) {
                return res.status(502).json({ success: false, message: formatMetaError(apiErr) });
            }
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // GET /api/meta/accounts/:id/ads/:adId/contacts?preset=&page=&pageSize=
    //
    // Paginated list of CRM contacts whose first-touch attribution
    // points at this exact Meta ad (Client.adReferrer.sourceId === adId).
    // Honours the same date-preset as the insights endpoint so the
    // count next to the stat tile always lines up with the displayed
    // ranges (Last 7 days / Last 30 days / All time).
    async adContacts(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = String(req.params.id);
            const adId = String(req.params.adId);
            const preset = String(req.query.preset || 'maximum');
            const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
            const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.pageSize || '15'), 10) || 15));

            const acc = await prisma.metaAdAccount.findFirst({ where: { id, workspaceId }, select: { id: true } });
            if (!acc) return res.status(404).json({ success: false, message: 'Account not found' });

            const dateFilter =
                preset === 'last_7d'  ? { createdAt: { gte: new Date(Date.now() - 7  * 24 * 3600 * 1000) } } :
                preset === 'last_30d' ? { createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } } :
                                        {};

            const where: any = {
                workspaceId,
                ...dateFilter,
                // Postgres JSON path filter — pulls only contacts whose
                // captured adReferrer.sourceId matches this Meta ad id.
                adReferrer: { path: ['sourceId'], equals: adId },
            };

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

    // POST /api/meta/accounts/:id/ads/:adId/bind — creates (or
    // updates) an AdRoute that maps this specific Meta ad ID to
    // an agent. Reuses the existing ad-routing engine instead of
    // building a parallel one.
    async bindAd(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = String(req.params.id);
            const adId = String(req.params.adId);
            const data = bindAgentSchema.parse(req.body);
            const acc = await prisma.metaAdAccount.findFirst({ where: { id, workspaceId }, select: { id: true } });
            if (!acc) return res.status(404).json({ success: false, message: 'Account not found' });
            const agent = await prisma.agent.findFirst({ where: { id: data.agentId, workspaceId }, select: { id: true } });
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });

            // One Meta ad ↔ one route. Replace any prior binding for
            // this ad ID so the operator's most recent choice wins.
            const existing = await prisma.adRoute.findFirst({
                where: { workspaceId, matchType: 'ad_id', matchValue: adId },
            });
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
                        matchType: 'ad_id',
                        matchValue: adId,
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

    async unbindAd(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const adId = String(req.params.adId);
            const existing = await prisma.adRoute.findFirst({
                where: { workspaceId, matchType: 'ad_id', matchValue: adId },
            });
            if (!existing) return res.json({ success: true });
            await prisma.adRoute.delete({ where: { id: existing.id } });
            return res.json({ success: true });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }
}

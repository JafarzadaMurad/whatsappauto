import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

// Shape we persist on Message.adReferrer and Client.adReferrer.
// Mirrors the externalAdReply struct from Baileys but with our own
// names so it survives Baileys version bumps.
export type AdReferrer = {
    sourceUrl: string | null;
    title: string | null;
    body: string | null;
    mediaType: string | null;
    ctwaClid: string | null;
    sourceType: string | null;   // 'ad' | 'biz_message' | 'organic' | ...
    sourceId: string | null;     // Meta's ad-creative id when present
    thumbnailUrl: string | null;
};

// Pull the externalAdReply struct off a raw Baileys message. WhatsApp
// puts it under message.<wrapperType>.contextInfo.externalAdReply for
// text+caption messages, or in messageContextInfo.externalAdReply on
// some media types. Returns null when this wasn't a click-to-WhatsApp
// arrival (the common case for repeat conversations).
export function extractAdReferrer(msg: any): AdReferrer | null {
    const m = msg?.message;
    if (!m) return null;
    const ear =
        m.extendedTextMessage?.contextInfo?.externalAdReply
        || m.imageMessage?.contextInfo?.externalAdReply
        || m.videoMessage?.contextInfo?.externalAdReply
        || m.audioMessage?.contextInfo?.externalAdReply
        || m.documentMessage?.contextInfo?.externalAdReply
        || m.stickerMessage?.contextInfo?.externalAdReply
        || m.conversation?.contextInfo?.externalAdReply
        || m.messageContextInfo?.externalAdReply
        || null;
    if (!ear) return null;

    return {
        sourceUrl: ear.sourceUrl ? String(ear.sourceUrl) : null,
        title: ear.title ? String(ear.title) : null,
        body: ear.body ? String(ear.body) : null,
        mediaType: ear.mediaType != null ? String(ear.mediaType) : null,
        ctwaClid: ear.ctwaClid ? String(ear.ctwaClid) : null,
        sourceType: ear.sourceType ? String(ear.sourceType) : null,
        sourceId: ear.sourceId ? String(ear.sourceId) : null,
        thumbnailUrl: ear.thumbnailUrl ? String(ear.thumbnailUrl) : null,
    };
}

// Extract ad metadata from an Instagram Messenger webhook payload.
// Meta ships it under messaging.referral (top level, next to the
// message field) when the DM arrived from a click-to-Instagram ad
// or the "Send Message" CTA on a boosted post. Structure at the
// time of writing:
//   referral: {
//     ref: '<optional referral hash>',
//     source: 'ADS',                        // or 'SHORTLINK', 'BUSINESS_INBOX'
//     type: 'OPEN_THREAD',
//     ads_context_data: {
//       ad_title: '...',
//       photo_url: '...',
//       video_url: '...',
//       product_id: '...',
//     },
//     // For CTWA-style flows Meta additionally exposes the ad id
//     ad_id: '...',
//   }
// Returns null when the DM did not arrive from an ad.
export function extractIgReferrer(messaging: any): AdReferrer | null {
    const ref = messaging?.referral;
    if (!ref) return null;
    const ctx = ref.ads_context_data || {};
    // We only consider ad-sourced referrals worth attributing;
    // shortlink / business inbox referrals aren't useful for
    // AdRoute matching.
    if (ref.source && String(ref.source).toUpperCase() !== 'ADS') return null;
    return {
        sourceUrl: ctx.photo_url || ctx.video_url || null,
        title: ctx.ad_title ? String(ctx.ad_title) : null,
        body: null,
        mediaType: ctx.video_url ? 'video' : ctx.photo_url ? 'image' : null,
        ctwaClid: ref.ref ? String(ref.ref) : null,
        sourceType: 'ad',
        sourceId: ref.ad_id ? String(ref.ad_id) : null,
        thumbnailUrl: ctx.photo_url || null,
    };
}

// Find the AdRoute that should claim this customer based on the ad
// metadata they arrived with. Highest-priority rule wins; within the
// same priority the oldest rule wins so layered rules stay
// predictable. Returns null when no rule matches (caller falls back
// to the instance's primary or router agent).
//
// campaign_id and adset_id matches need the Meta hierarchy: the
// externalAdReply only carries the ad id, so we look up the cached
// MetaAd row to resolve which campaign / adset the ad belongs to.
export async function matchAdRoute(workspaceId: string, ref: AdReferrer): Promise<{ id: string; agentId: string; name: string } | null> {
    const rules = await prisma.adRoute.findMany({
        where: { workspaceId, isActive: true },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, agentId: true, name: true, matchType: true, matchValue: true },
    });
    if (rules.length === 0) return null;

    // Resolve the ad's campaign / adset only when we actually have a
    // sourceId AND at least one rule cares about them — saves a DB
    // hit on most arrivals.
    const needsHierarchy = ref.sourceId && rules.some(r => r.matchType === 'campaign_id' || r.matchType === 'adset_id');
    let campaignId: string | null = null;
    let adsetId: string | null = null;
    if (needsHierarchy) {
        const metaAd = await prisma.metaAd.findFirst({
            where: { adId: ref.sourceId as string, metaAdAccount: { workspaceId } },
            select: { campaignId: true, adsetId: true },
        }).catch(() => null);
        campaignId = metaAd?.campaignId || null;
        adsetId = metaAd?.adsetId || null;
    }

    for (const r of rules) {
        if (testAdRoute(r.matchType, r.matchValue, ref, { campaignId, adsetId })) {
            return { id: r.id, agentId: r.agentId, name: r.name };
        }
    }
    return null;
}

export function testAdRoute(
    matchType: string,
    matchValue: string,
    ref: AdReferrer,
    hierarchy?: { campaignId?: string | null; adsetId?: string | null },
): boolean {
    const needle = String(matchValue || '').trim();
    if (!needle) return false;
    switch (matchType) {
        case 'headline':     return (ref.title || '').toLowerCase().includes(needle.toLowerCase());
        case 'source_url':   return (ref.sourceUrl || '').toLowerCase().includes(needle.toLowerCase());
        case 'ad_id':        return (ref.sourceId || '') === needle;
        case 'ctwa_prefix':  return (ref.ctwaClid || '').startsWith(needle);
        case 'campaign_id':  return !!hierarchy?.campaignId && hierarchy.campaignId === needle;
        case 'adset_id':     return !!hierarchy?.adsetId && hierarchy.adsetId === needle;
        default:             return false;
    }
}

// Bump hitCount + lastHitAt on the rule we just used. Fire-and-forget
// — the matching decision is already made by the time we call this.
export async function recordAdRouteHit(routeId: string): Promise<void> {
    try {
        await prisma.adRoute.update({
            where: { id: routeId },
            data: { hitCount: { increment: 1 }, lastHitAt: new Date() },
        });
    } catch (err: any) {
        logger.warn({ err: err?.message, routeId }, '[ad-route] hit increment failed');
    }
}

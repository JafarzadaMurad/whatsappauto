import axios from 'axios';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

// Marketing API is versioned — pin so a Meta v-bump doesn't silently
// change behaviour. Bump intentionally when we want new fields.
const GRAPH_VERSION = 'v20.0';
const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export async function getMetaAppCreds(): Promise<{ appId: string; appSecret: string } | null> {
    const rows = await prisma.systemConfig.findMany({
        where: { key: { in: ['META_APP_ID', 'META_APP_SECRET'] } },
    });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    if (!map.META_APP_ID || !map.META_APP_SECRET) return null;
    return { appId: map.META_APP_ID, appSecret: map.META_APP_SECRET };
}

// Exchange the short-lived auth code for a short-lived user token.
export async function exchangeCodeForToken(code: string, redirectUri: string) {
    const creds = await getMetaAppCreds();
    if (!creds) throw new Error('Meta app credentials are not configured');
    const res = await axios.get(`${BASE}/oauth/access_token`, {
        params: {
            client_id: creds.appId,
            client_secret: creds.appSecret,
            redirect_uri: redirectUri,
            code,
        },
    });
    return res.data as { access_token: string; expires_in?: number; token_type: string };
}

// Trade a short-lived user token for the ~60-day long-lived one.
export async function exchangeForLongLivedToken(shortToken: string) {
    const creds = await getMetaAppCreds();
    if (!creds) throw new Error('Meta app credentials are not configured');
    const res = await axios.get(`${BASE}/oauth/access_token`, {
        params: {
            grant_type: 'fb_exchange_token',
            client_id: creds.appId,
            client_secret: creds.appSecret,
            fb_exchange_token: shortToken,
        },
    });
    return res.data as { access_token: string; expires_in?: number; token_type: string };
}

export async function getMe(accessToken: string): Promise<{ id: string; name: string }> {
    const res = await axios.get(`${BASE}/me`, { params: { access_token: accessToken, fields: 'id,name' } });
    return res.data;
}

export type FbAdAccount = {
    id: string;          // "act_XXXXXXX"
    account_id: string;  // "XXXXXXX"
    name: string;
    currency?: string;
    account_status?: number;
};

export async function listUserAdAccounts(accessToken: string): Promise<FbAdAccount[]> {
    const res = await axios.get(`${BASE}/me/adaccounts`, {
        params: {
            access_token: accessToken,
            fields: 'id,account_id,name,currency,account_status',
            limit: 200,
        },
    });
    return (res.data?.data || []) as FbAdAccount[];
}

export type FbAd = {
    id: string;
    name: string;
    status: string;
    effective_status?: string;
    created_time?: string;
    campaign_id?: string;
    adset_id?: string;
    campaign?: { id: string; name: string };
    adset?: { id: string; name: string };
    creative?: { id: string; thumbnail_url?: string; image_url?: string };
};

export async function listAdsInAccount(accessToken: string, adAccountId: string, limit = 100): Promise<FbAd[]> {
    const res = await axios.get(`${BASE}/${adAccountId}/ads`, {
        params: {
            access_token: accessToken,
            fields: 'id,name,status,effective_status,created_time,campaign_id,adset_id,campaign{id,name},adset{id,name},creative{id,thumbnail_url,image_url}',
            limit,
        },
    });
    return (res.data?.data || []) as FbAd[];
}

export type AdInsights = {
    impressions?: string;
    clicks?: string;
    spend?: string;
    ctr?: string;
    cpm?: string;
    cpc?: string;
    reach?: string;
    actions?: Array<{ action_type: string; value: string }>;
    date_start?: string;
    date_stop?: string;
};

export async function getAdInsights(accessToken: string, adId: string, datePreset = 'last_7d'): Promise<AdInsights | null> {
    try {
        const res = await axios.get(`${BASE}/${adId}/insights`, {
            params: {
                access_token: accessToken,
                date_preset: datePreset,
                fields: 'impressions,clicks,spend,ctr,cpm,cpc,reach,actions',
            },
        });
        const arr = res.data?.data || [];
        return arr[0] || null;
    } catch (err: any) {
        // Ads with no impressions return an empty insights set rather
        // than a row; an exception is genuine (rate limit, scope) so
        // let it bubble.
        logger.warn({ err: err?.response?.data || err?.message, adId }, '[meta] insights fetch failed');
        return null;
    }
}

// Helper used by the controller when an API call fails — extracts
// Meta's structured error so the UI can show "token expired" instead
// of "axios threw something".
export function formatMetaError(err: any): string {
    const e = err?.response?.data?.error;
    if (e) {
        const code = e.code ? ` (code ${e.code})` : '';
        return `${e.message || 'Meta API error'}${code}`;
    }
    return err?.message || 'Unknown Meta error';
}

import { prisma } from '../../lib/prisma';
import { sessions } from './instance.manager';
import { logger } from '../../utils/logger';

const REFRESH_MS = 24 * 60 * 60 * 1000; // refresh profile pics older than 24h

// Fetches the contact's WhatsApp profile picture URL via Baileys and
// caches it on the Client row. Tries the high-res variant first and
// falls back to the smaller 'preview' when the contact's privacy
// blocks 'image'. Best-effort — never throws.
export async function refreshProfilePic(opts: {
    instanceId: string;
    clientId: string;
    jid: string;
}): Promise<string | null> {
    const { instanceId, clientId, jid } = opts;
    const sock = sessions.get(instanceId);
    if (!sock) {
        logger.warn({ instanceId, jid }, '[profile-pic] no live session — skipping');
        return null;
    }

    let url: string | null = null;
    let lastErr: string | null = null;
    for (const variant of ['image', 'preview'] as const) {
        try {
            const r = await (sock as any).profilePictureUrl(jid, variant);
            if (r) { url = r; break; }
        } catch (e: any) {
            lastErr = e?.message || String(e);
        }
    }

    try {
        await prisma.client.update({
            where: { id: clientId },
            data: { profilePicUrl: url || null, profilePicUpdatedAt: new Date() },
        });
        logger.info({ instanceId, jid, hasUrl: !!url, err: url ? null : lastErr }, '[profile-pic] refresh result');
    } catch (e: any) {
        logger.warn({ instanceId, jid, err: e?.message }, '[profile-pic] db update failed');
    }
    return url;
}

// Fire-and-forget refresh, skipping when the cache is fresh.
export function maybeRefreshProfilePicAsync(opts: {
    instanceId: string;
    clientId: string;
    jid: string;
    profilePicUpdatedAt?: Date | null;
}) {
    const { profilePicUpdatedAt } = opts;
    if (profilePicUpdatedAt && Date.now() - profilePicUpdatedAt.getTime() < REFRESH_MS) return;
    refreshProfilePic(opts).catch(() => {});
}

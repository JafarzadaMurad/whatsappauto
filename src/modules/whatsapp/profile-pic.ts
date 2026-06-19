import { prisma } from '../../lib/prisma';
import { sessions } from './instance.manager';
import { logger } from '../../utils/logger';

const REFRESH_MS = 24 * 60 * 60 * 1000; // refresh profile pics older than 24h

// Fetches the contact's WhatsApp profile picture URL via Baileys and
// caches it on the Client row. Idempotent and best-effort — silent on
// any error (the call returns a 401 for contacts with privacy locked
// down, which is normal).
export async function refreshProfilePic(opts: {
    instanceId: string;
    clientId: string;
    jid: string;
}) {
    const { instanceId, clientId, jid } = opts;
    const sock = sessions.get(instanceId);
    if (!sock) return;

    try {
        // 'image' returns the high-res photo, falls back internally to
        // the low-res ('preview') if the contact disabled the big one.
        const url = await sock.profilePictureUrl(jid, 'image').catch(() => null);
        await prisma.client.update({
            where: { id: clientId },
            data: { profilePicUrl: url || null, profilePicUpdatedAt: new Date() },
        });
    } catch (e: any) {
        logger.debug({ jid, err: e?.message }, '[profile-pic] refresh failed');
    }
}

// Decides whether to refresh in the background. Doesn't await; the
// caller stays on the hot path. Skips when the URL is already fresh.
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

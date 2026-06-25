import { prisma } from '../../lib/prisma';
import type { AdReferrer } from '../ads/ad-referrer';
import { matchAdRoute, recordAdRouteHit } from '../ads/ad-referrer';

// Create or update a CRM contact when a message arrives on any channel.
// Keeps the channel + source label up to date without overwriting AI-set
// fields like status, tags or summary. Returns the row id + the
// profile-pic timestamp so callers can lazily refresh the avatar.
export async function upsertCrmContact(opts: {
    userId: string;
    workspaceId: string;
    phone: string; // remoteJid digits (WhatsApp) or IGSID (Instagram)
    name?: string | null;
    channel: 'whatsapp' | 'instagram';
    sourceLabel?: string | null;
    // True when `phone` is a WhatsApp LID rather than a real phone
    // number. Only flips an existing record from anonymous→known if
    // we now have a real phone (never the other way around).
    isAnonymous?: boolean;
    // Click-to-WhatsApp metadata when this arrival came from a Meta
    // ad. Drives first-touch attribution + AdRoute matching for the
    // initial agent assignment.
    adReferrer?: AdReferrer | null;
}): Promise<{ id: string; profilePicUpdatedAt: Date | null } | null> {
    try {
        // Lookup is by (workspaceId, phone) so two members of the same
        // workspace see the same contact, while two unrelated workspaces
        // each keep their own.
        const existing = await prisma.client.findFirst({
            where: { workspaceId: opts.workspaceId, phone: opts.phone },
            select: { id: true, profilePicUpdatedAt: true, adReferrer: true, assignedAgentId: true },
        });
        if (existing) {
            const update: any = {
                ...(opts.name ? { name: opts.name } : {}),
                channel: opts.channel,
                ...(opts.sourceLabel ? { sourceLabel: opts.sourceLabel } : {}),
                ...(opts.isAnonymous === false ? { isAnonymous: false } : {}),
            };
            // First-touch attribution: only backfill if we don't already
            // have one. We never overwrite an earlier ad source — that's
            // the customer's original arrival and the analytics page
            // groups everything by it.
            if (opts.adReferrer && !existing.adReferrer) {
                update.adReferrer = opts.adReferrer;
            }
            // Ad routing only fires when no agent has been assigned yet
            // — respect the operator's handoffTo and the sticky pointer
            // set on the very first turn.
            if (opts.adReferrer && !existing.assignedAgentId) {
                const route = await matchAdRoute(opts.workspaceId, opts.adReferrer);
                if (route) {
                    update.assignedAgentId = route.agentId;
                    recordAdRouteHit(route.id).catch(() => {});
                }
            }
            await prisma.client.update({ where: { id: existing.id }, data: update });
            return { id: existing.id, profilePicUpdatedAt: existing.profilePicUpdatedAt };
        }
        // New contact path — set first-touch attribution + ad routing
        // up front. Either field is null on contacts that didn't come
        // from an ad.
        let assignedAgentId: string | null = null;
        if (opts.adReferrer) {
            const route = await matchAdRoute(opts.workspaceId, opts.adReferrer);
            if (route) {
                assignedAgentId = route.agentId;
                recordAdRouteHit(route.id).catch(() => {});
            }
        }
        const created = await prisma.client.create({
            data: {
                userId: opts.userId,
                workspaceId: opts.workspaceId,
                phone: opts.phone,
                name: opts.name || null,
                status: 'NEW',
                tags: [],
                channel: opts.channel,
                sourceLabel: opts.sourceLabel || null,
                isAnonymous: !!opts.isAnonymous,
                ...(opts.adReferrer ? { adReferrer: opts.adReferrer } : {}),
                ...(assignedAgentId ? { assignedAgentId } : {}),
            } as any,
            select: { id: true, profilePicUpdatedAt: true },
        });
        return { id: created.id, profilePicUpdatedAt: created.profilePicUpdatedAt };
    } catch {
        // non-critical — never block message handling on CRM upsert
        return null;
    }
}

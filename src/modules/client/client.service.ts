import { prisma } from '../../lib/prisma';

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
}): Promise<{ id: string; profilePicUpdatedAt: Date | null } | null> {
    try {
        // Lookup is by (workspaceId, phone) so two members of the same
        // workspace see the same contact, while two unrelated workspaces
        // each keep their own.
        const existing = await prisma.client.findFirst({
            where: { workspaceId: opts.workspaceId, phone: opts.phone },
            select: { id: true, profilePicUpdatedAt: true },
        });
        if (existing) {
            await prisma.client.update({
                where: { id: existing.id },
                data: {
                    ...(opts.name ? { name: opts.name } : {}),
                    channel: opts.channel,
                    ...(opts.sourceLabel ? { sourceLabel: opts.sourceLabel } : {}),
                    ...(opts.isAnonymous === false ? { isAnonymous: false } : {}),
                },
            });
            return { id: existing.id, profilePicUpdatedAt: existing.profilePicUpdatedAt };
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
            },
            select: { id: true, profilePicUpdatedAt: true },
        });
        return { id: created.id, profilePicUpdatedAt: created.profilePicUpdatedAt };
    } catch {
        // non-critical — never block message handling on CRM upsert
        return null;
    }
}

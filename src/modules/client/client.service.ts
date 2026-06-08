import { prisma } from '../../lib/prisma';

// Create or update a CRM contact when a message arrives on any channel.
// Keeps the channel + source label up to date without overwriting AI-set
// fields like status, tags or summary.
export async function upsertCrmContact(opts: {
    userId: string;
    workspaceId: string;
    phone: string; // remoteJid digits (WhatsApp) or IGSID (Instagram)
    name?: string | null;
    channel: 'whatsapp' | 'instagram';
    sourceLabel?: string | null;
}) {
    try {
        // Lookup is by (workspaceId, phone) so two members of the same
        // workspace see the same contact, while two unrelated workspaces
        // each keep their own.
        const existing = await prisma.client.findFirst({
            where: { workspaceId: opts.workspaceId, phone: opts.phone },
            select: { id: true },
        });
        if (existing) {
            await prisma.client.update({
                where: { id: existing.id },
                data: {
                    ...(opts.name ? { name: opts.name } : {}),
                    channel: opts.channel,
                    ...(opts.sourceLabel ? { sourceLabel: opts.sourceLabel } : {}),
                },
            });
        } else {
            await prisma.client.create({
                data: {
                    userId: opts.userId,
                    workspaceId: opts.workspaceId,
                    phone: opts.phone,
                    name: opts.name || null,
                    status: 'NEW',
                    tags: [],
                    channel: opts.channel,
                    sourceLabel: opts.sourceLabel || null,
                },
            });
        }
    } catch {
        // non-critical — never block message handling on CRM upsert
    }
}

import { prisma } from '../../lib/prisma';

// Create or update a CRM contact when a message arrives on any channel.
// Keeps the channel + source label up to date without overwriting AI-set
// fields like status, tags or summary.
export async function upsertCrmContact(opts: {
    userId: string;
    phone: string; // remoteJid digits (WhatsApp) or IGSID (Instagram)
    name?: string | null;
    channel: 'whatsapp' | 'instagram';
    sourceLabel?: string | null;
}) {
    try {
        await prisma.client.upsert({
            where: { userId_phone: { userId: opts.userId, phone: opts.phone } },
            update: {
                ...(opts.name ? { name: opts.name } : {}),
                channel: opts.channel,
                ...(opts.sourceLabel ? { sourceLabel: opts.sourceLabel } : {})
            },
            create: {
                userId: opts.userId,
                phone: opts.phone,
                name: opts.name || null,
                status: 'NEW',
                tags: [],
                channel: opts.channel,
                sourceLabel: opts.sourceLabel || null
            }
        });
    } catch {
        // non-critical — never block message handling on CRM upsert
    }
}

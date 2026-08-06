import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

// Result of resolving an incoming WhatsApp JID. effectiveJid is the
// canonical key we should use for DB writes — for normal contacts
// it's the same as rawJid, for LID contacts it's the @s.whatsapp.net
// JID once we've learned the underlying phone (either from the message
// itself or from a previously cached mapping).
export type ResolvedJid = {
    effectiveJid: string;
    phone: string;
    isAnonymous: boolean;
};

function digits(s: string): string {
    return (s || '').replace(/[^0-9]/g, '');
}

// Pull every field that has ever been seen to carry the real phone
// number alongside a LID. Baileys spelling varies by version, so we
// try them all and take whichever is non-empty.
function extractPhoneFromMsg(msg: any): string | null {
    if (!msg) return null;
    const candidates = [
        msg.key?.senderPn,
        msg.key?.participantPn,
        msg.key?.senderPnJid,
        msg.key?.remoteJidAlt,
        msg.senderPn,
        msg.participantPn,
        msg.senderPnJid,
        msg.userJid,
        msg.participantAlt,
        msg.peerRecipientPn,
    ];
    for (const c of candidates) {
        if (!c) continue;
        const d = digits(String(c).replace('@s.whatsapp.net', ''));
        if (d && d.length >= 7) return d;
    }
    return null;
}

// Resolve a JID + optional message to its canonical (phone-keyed) form.
// When a fresh LID→phone mapping is learned from msg.key.senderPn /
// participantPn / friends, the mapping row is upserted and a merge of
// existing LID-keyed data into the phone-keyed bucket is kicked off.
export async function resolveJid(instanceId: string, rawJid: string, msg?: any): Promise<ResolvedJid> {
    if (!rawJid.endsWith('@lid')) {
        // Plain phone JID — already canonical.
        const phone = digits(rawJid.replace('@s.whatsapp.net', ''));
        return { effectiveJid: rawJid, phone, isAnonymous: false };
    }

    // LID branch — diagnostic dump so we can see exactly which
    // Baileys field (if any) ships the real phone for a given message.
    // Logged once per message; safe because LIDs aren't a hot path.
    if (msg) {
        try {
            const probe = {
                rawJid,
                key: msg.key
                    ? {
                        remoteJid: msg.key.remoteJid,
                        remoteJidAlt: (msg.key as any).remoteJidAlt,
                        participant: (msg.key as any).participant,
                        participantAlt: (msg.key as any).participantAlt,
                        senderPn: (msg.key as any).senderPn,
                        senderPnJid: (msg.key as any).senderPnJid,
                        participantPn: (msg.key as any).participantPn,
                        fromMe: msg.key.fromMe,
                    }
                    : null,
                pushName: msg.pushName,
                userJid: (msg as any).userJid,
                senderPn: (msg as any).senderPn,
                participantPn: (msg as any).participantPn,
            };
            logger.info(`[${instanceId}] LID probe ${JSON.stringify(probe)}`);
        } catch { /* not critical */ }
    }

    // LID branch — try the message payload first (most reliable), then
    // the cached mapping table.
    const pnRaw = extractPhoneFromMsg(msg);

    if (pnRaw) {
        const phone = pnRaw; // already digits-only from extractPhoneFromMsg
        if (phone) {
            const phoneJid = `${phone}@s.whatsapp.net`;
            try {
                const existing = await prisma.lidMapping.findUnique({
                    where: { instanceId_lid: { instanceId, lid: rawJid } },
                });
                if (!existing) {
                    await prisma.lidMapping.create({
                        data: { instanceId, lid: rawJid, phone },
                    });
                    logger.info(`[${instanceId}] LID mapping learned: ${rawJid} -> ${phone}`);
                    // Fire-and-forget merge — promotes any data already
                    // stored under the LID into the phone-keyed records
                    // so the user stops seeing a duplicate conversation.
                    mergeLidIntoPhone(instanceId, rawJid, phoneJid, phone).catch(err =>
                        logger.warn({ err: err.message }, `[${instanceId}] LID merge failed`)
                    );
                }
            } catch (err: any) {
                logger.warn({ err: err.message }, `[${instanceId}] LID mapping write failed`);
            }
            return { effectiveJid: phoneJid, phone, isAnonymous: false };
        }
    }

    // No fresh resolution — look it up from cache.
    try {
        const cached = await prisma.lidMapping.findUnique({
            where: { instanceId_lid: { instanceId, lid: rawJid } },
        });
        if (cached) {
            return {
                effectiveJid: `${cached.phone}@s.whatsapp.net`,
                phone: cached.phone,
                isAnonymous: false,
            };
        }
    } catch { /* fall through */ }

    // Truly unresolved — store under the LID, mark as anonymous so the
    // UI doesn't pretend it's a phone number.
    return { effectiveJid: rawJid, phone: digits(rawJid.replace('@lid', '')), isAnonymous: true };
}

// Walk every place we keep per-jid data and re-key the LID rows to
// the phone JID. If a phone-keyed row already exists, merge fields
// rather than collide on the unique constraint.
export async function mergeLidIntoPhone(instanceId: string, lid: string, phoneJid: string, phone: string) {
    // 1. Raw Message rows
    await prisma.message.updateMany({
        where: { instanceId, remoteJid: lid },
        data: { remoteJid: phoneJid },
    }).catch(() => {});

    // 2. AiConversationLog rows
    await prisma.aiConversationLog.updateMany({
        where: { instanceId, remoteJid: lid },
        data: { remoteJid: phoneJid },
    }).catch(() => {});

    // 3. AgentActivityLog rows
    await prisma.agentActivityLog.updateMany({
        where: { instanceId, remoteJid: lid },
        data: { remoteJid: phoneJid, contactPhone: phone },
    }).catch(() => {});

    // 4. Contact — unique on (instanceId, remoteJid)
    try {
        const phoneContact = await prisma.contact.findUnique({
            where: { instanceId_remoteJid: { instanceId, remoteJid: phoneJid } },
        });
        const lidContact = await prisma.contact.findUnique({
            where: { instanceId_remoteJid: { instanceId, remoteJid: lid } },
        });
        if (lidContact) {
            if (phoneContact) {
                await prisma.contact.update({
                    where: { id: phoneContact.id },
                    data: {
                        name: phoneContact.name || lidContact.name,
                        pushName: phoneContact.pushName || lidContact.pushName,
                    },
                });
                await prisma.contact.delete({ where: { id: lidContact.id } }).catch(() => {});
            } else {
                await prisma.contact.update({
                    where: { id: lidContact.id },
                    data: { remoteJid: phoneJid },
                });
            }
        }
    } catch { /* best-effort */ }

    // 5. Client (CRM) — unique on (userId, phone). Need to walk all
    // workspaces that might have a record under the raw LID digits.
    try {
        const lidDigits = lid.replace('@lid', '');
        const lidClients = await prisma.client.findMany({ where: { phone: lidDigits } });
        for (const lc of lidClients) {
            const sameWsPhone = await prisma.client.findFirst({
                where: { workspaceId: lc.workspaceId, phone, NOT: { id: lc.id } },
            });
            if (sameWsPhone) {
                const mergedTags = Array.from(new Set([...(sameWsPhone.tags || []), ...(lc.tags || [])]));
                const mergedFields = {
                    ...((lc.customFields as Record<string, any>) || {}),
                    ...((sameWsPhone.customFields as Record<string, any>) || {}),
                };
                await prisma.client.update({
                    where: { id: sameWsPhone.id },
                    data: {
                        name: sameWsPhone.name || lc.name,
                        summary: sameWsPhone.summary || lc.summary,
                        tags: mergedTags,
                        customFields: mergedFields,
                        isAnonymous: false,
                    },
                });
                await prisma.client.delete({ where: { id: lc.id } }).catch(() => {});
            } else {
                await prisma.client.update({
                    where: { id: lc.id },
                    data: { phone, isAnonymous: false },
                }).catch(() => {});
            }
        }
    } catch { /* best-effort */ }
}

/**
 * The real phone behind a jid, from cache only.
 *
 * `resolveJid` needs a message to learn a new mapping. Everything that
 * runs *after* delivery — the agent, routing, reminders, automations —
 * only needs to read what the pipeline already cached, and each of them
 * was instead deriving digits straight off the jid. On a LID
 * conversation that yields WhatsApp's anonymous identity rather than a
 * number, so CRM lookups keyed on phone quietly missed: no name, no
 * assigned agent, no saved fields, and a 15-digit "phone" landing in
 * outgoing HTTP requests.
 *
 * Returns the digits of a plain jid unchanged, so callers can use it
 * everywhere without branching.
 */
export async function contactPhoneForJid(instanceId: string, remoteJid: string): Promise<string> {
    const bare = digits(remoteJid.replace('@s.whatsapp.net', '').replace('@lid', ''));
    if (!remoteJid.endsWith('@lid')) return bare;

    try {
        const cached = await prisma.lidMapping.findUnique({
            where: { instanceId_lid: { instanceId, lid: remoteJid } },
            select: { phone: true },
        });
        if (cached?.phone) return cached.phone;
    } catch { /* fall through to the LID digits */ }

    // WhatsApp has never told us this contact's number. The LID is all
    // there is; saying so once beats every downstream caller guessing.
    logger.warn(
        `[lid] no phone mapping · jid=${remoteJid} instance=${instanceId} ` +
        `— contact lookups and {{contact:phone}} will use the LID`
    );
    return bare;
}

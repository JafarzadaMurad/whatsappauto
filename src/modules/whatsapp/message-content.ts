// Extracts a human-readable text representation of a Baileys message.
// Falls back to a typed label like [Image] for media instead of the
// useless "[Media/Unsupported]" we used to show.
export function extractMessageContent(msg: any): { content: string; type: string } {
    const m = msg?.message;
    if (!m) return { content: '[Empty]', type: 'unknown' };

    if (m.conversation) return { content: m.conversation, type: 'text' };
    if (m.extendedTextMessage?.text) return { content: m.extendedTextMessage.text, type: 'text' };

    if (m.imageMessage) {
        const cap = m.imageMessage.caption;
        return { content: cap ? `🖼️ ${cap}` : '🖼️ Photo', type: 'image' };
    }
    if (m.videoMessage) {
        const cap = m.videoMessage.caption;
        return { content: cap ? `🎬 ${cap}` : '🎬 Video', type: 'video' };
    }
    if (m.audioMessage) {
        return { content: m.audioMessage.ptt ? '🎤 Voice message' : '🎵 Audio', type: 'audio' };
    }
    if (m.documentMessage) {
        const name = m.documentMessage.fileName || 'file';
        return { content: `📄 ${name}`, type: 'document' };
    }
    if (m.stickerMessage) return { content: '🎟️ Sticker', type: 'sticker' };
    if (m.locationMessage) return { content: '📍 Location', type: 'location' };
    if (m.contactMessage) {
        const cName = m.contactMessage.displayName || 'Contact';
        return { content: `👤 ${cName}`, type: 'contact' };
    }
    if (m.contactsArrayMessage) return { content: '👥 Contacts', type: 'contact' };
    if (m.reactionMessage) {
        const e = m.reactionMessage.text || '';
        return { content: `Reacted: ${e}`, type: 'reaction' };
    }
    if (m.protocolMessage) return { content: '', type: 'protocol' }; // system, skip
    if (m.pollCreationMessage) return { content: `📊 Poll: ${m.pollCreationMessage.name || ''}`, type: 'poll' };
    if (m.liveLocationMessage) return { content: '📍 Live location', type: 'location' };
    if (m.viewOnceMessage || m.viewOnceMessageV2) return { content: '👁️ View-once media', type: 'view_once' };

    return { content: '[Unsupported message]', type: 'unknown' };
}

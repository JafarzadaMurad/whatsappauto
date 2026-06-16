import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { logger } from '../../utils/logger';
import { config } from '../../config';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT_BY_MIME: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/webm': 'webm',
    'audio/wav': 'wav',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/zip': 'zip',
};

export type MediaSaveResult = {
    mediaUrl: string;     // server-side URL the frontend / API can hand out
    mediaMime: string;
    mediaName: string | null;
};

// Pulls the encrypted media blob from WhatsApp's CDN via Baileys, writes
// it to the same uploads directory the manual-upload endpoint serves
// from, returns the canonical /api/uploads/files/... URL. Returns null
// if the message has no downloadable media (text, sticker without
// image, etc.) or if WhatsApp rejected the fetch.
export async function downloadAndSaveMedia(msg: any): Promise<MediaSaveResult | null> {
    const m = msg?.message;
    if (!m) return null;

    // Map message kind → ("image" | "video" | "audio" | "document" | "sticker")
    // and pluck the corresponding sub-message so we can read its
    // mimetype / filename without re-deriving them later.
    let kind: 'image' | 'video' | 'audio' | 'document' | 'sticker' | null = null;
    let media: any = null;
    if (m.imageMessage)         { kind = 'image';    media = m.imageMessage; }
    else if (m.videoMessage)    { kind = 'video';    media = m.videoMessage; }
    else if (m.audioMessage)    { kind = 'audio';    media = m.audioMessage; }
    else if (m.documentMessage) { kind = 'document'; media = m.documentMessage; }
    else if (m.stickerMessage)  { kind = 'sticker';  media = m.stickerMessage; }
    if (!kind) return null;

    // WhatsApp often hands us mimetypes with codec parameters
    // (e.g. "audio/ogg; codecs=opus"). Strip the parameter list before
    // matching, otherwise EXT_BY_MIME misses and we save with a busted
    // extension like ".ogg; cod" that the browser refuses to play.
    const rawMime = String(media.mimetype || '');
    const baseMime = rawMime.split(';')[0].trim().toLowerCase();
    let ext = EXT_BY_MIME[baseMime];
    if (!ext) {
        const sub = baseMime.split('/')[1] || 'bin';
        // Keep only the safe alphanumeric prefix so a weird mime can't
        // smuggle in path separators or whitespace.
        ext = sub.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
    }
    // Voice notes default to ogg/opus container even when the codec
    // marker doesn't roundtrip cleanly.
    if (kind === 'audio' && (media.ptt || !ext)) ext = ext || 'ogg';
    const fileName = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
    const filePath = path.join(UPLOAD_DIR, fileName);

    try {
        const buffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { logger: logger as any, reuploadRequest: async () => msg } as any,
        );
        if (!buffer || (buffer as Buffer).length === 0) return null;

        fs.writeFileSync(filePath, buffer as Buffer);

        const base = (config.FRONTEND_URL || '').replace(/\/$/, '');
        return {
            // Persist the cleaned base mimetype so the browser <audio>/
            // <video> element gets a value it actually understands.
            mediaUrl: `${base}/api/uploads/files/${fileName}`,
            mediaMime: baseMime || `${kind}/unknown`,
            mediaName: media.fileName || null,
        };
    } catch (err: any) {
        logger.warn({ err: err.message, kind }, '[media] download failed');
        // Clean partial file if any
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
        return null;
    }
}

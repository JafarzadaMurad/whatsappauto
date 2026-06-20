import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

// Resolves a public /api/uploads/files/<name> URL or a bare filename to
// its actual file on disk. Returns null when the path escapes uploads/
// or the file doesn't exist.
function resolveLocalFile(mediaUrl: string): string | null {
    const m = mediaUrl.match(/\/api\/uploads\/files\/([^/?#]+)$/);
    const name = m ? m[1] : path.basename(mediaUrl);
    if (!/^[a-z0-9._-]+$/i.test(name)) return null;
    const full = path.join(UPLOAD_DIR, name);
    if (!full.startsWith(UPLOAD_DIR)) return null;
    if (!fs.existsSync(full)) return null;
    return full;
}

// Fetches the OpenAI API key from the workspace's AiProvider rows.
// Returns null when none configured — the caller should treat audio as
// "couldn't transcribe" and fall through to a textual placeholder.
async function getOpenAIKey(workspaceId: string): Promise<string | null> {
    const row = await prisma.aiProvider.findFirst({
        where: { workspaceId, provider: 'OPENAI' },
        select: { apiKey: true },
        orderBy: { updatedAt: 'desc' },
    });
    return row?.apiKey || null;
}

export type TranscribeResult = {
    text: string;
    language?: string;
    durationSec?: number;
};

// Transcribes an audio file via the OpenAI Whisper API (model
// `whisper-1`). Works with ogg/opus / mp3 / m4a / webm / wav. Throws
// on network / auth errors; returns an empty-text result when Whisper
// has nothing to transcribe (silence).
export async function transcribeAudioUrl(opts: {
    workspaceId: string;
    mediaUrl: string;
    mimetype?: string | null;
    language?: string | null;
}): Promise<TranscribeResult | null> {
    const apiKey = await getOpenAIKey(opts.workspaceId);
    if (!apiKey) {
        logger.warn({ workspaceId: opts.workspaceId }, '[whisper] no OpenAI key in workspace, skipping');
        return null;
    }

    const localPath = resolveLocalFile(opts.mediaUrl);
    if (!localPath) {
        logger.warn({ mediaUrl: opts.mediaUrl }, '[whisper] cannot resolve media to local file');
        return null;
    }

    const stat = fs.statSync(localPath);
    if (stat.size === 0) return null;
    if (stat.size > 25 * 1024 * 1024) {
        // OpenAI's hard cap; rare for WhatsApp voice notes
        logger.warn({ size: stat.size }, '[whisper] file too large for OpenAI');
        return null;
    }

    const fileBuf = fs.readFileSync(localPath);
    const fileBlob = new Blob([fileBuf], { type: opts.mimetype || 'audio/ogg' });
    const form = new FormData();
    form.append('file', fileBlob, path.basename(localPath));
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    if (opts.language) form.append('language', opts.language);

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form as any,
    });

    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Whisper API ${res.status}: ${txt.slice(0, 300)}`);
    }
    const json: any = await res.json();
    const text = String(json.text || '').trim();
    logger.info({ bytes: fileBuf.length, lang: json.language, dur: json.duration, chars: text.length }, '[whisper] transcribed');
    return {
        text,
        language: json.language,
        durationSec: typeof json.duration === 'number' ? Math.round(json.duration) : undefined,
    };
}

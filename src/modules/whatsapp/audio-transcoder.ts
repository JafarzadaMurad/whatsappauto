import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

// Re-encodes a browser-recorded audio clip (typically webm/opus) into
// ogg/opus, which is the only codec/container combo WhatsApp accepts
// for voice notes (ptt). Returns the new public URL + local path of
// the converted file. Throws if ffmpeg is missing or the conversion
// fails — callers should handle that and fall back to sending the
// clip as a regular audio attachment.
export async function transcodeToOggOpus(inputUrl: string): Promise<{ url: string; localPath: string }> {
    // Resolve URL → local file. /api/uploads/files/<name> is the public
    // path; the actual file lives in <cwd>/uploads/<name>.
    const m = inputUrl.match(/\/api\/uploads\/files\/([^/?#]+)$/);
    if (!m) throw new Error('Input must be a local upload URL');
    const inputPath = path.join(UPLOAD_DIR, m[1]);
    await fs.access(inputPath); // throws if missing

    const outName = crypto.randomBytes(12).toString('hex') + '.ogg';
    const outPath = path.join(UPLOAD_DIR, outName);

    await new Promise<void>((resolve, reject) => {
        const ff = spawn('ffmpeg', [
            '-i', inputPath,
            '-c:a', 'libopus',
            '-b:a', '64k',
            '-ac', '1',           // mono
            '-ar', '48000',       // 48 kHz — the rate WhatsApp expects
            '-vn',                // strip any video stream
            '-y',                 // overwrite
            outPath,
        ]);
        let stderr = '';
        ff.stderr.on('data', d => { stderr += d.toString(); });
        ff.on('close', code => {
            if (code === 0) return resolve();
            reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(0, 600)}`));
        });
        ff.on('error', err => reject(err));
    });

    const base = (config.FRONTEND_URL || '').replace(/\/$/, '');
    const url = `${base}/api/uploads/files/${outName}`;
    logger.info({ inputUrl, outName }, '[audio-transcoder] converted to ogg/opus');
    return { url, localPath: outPath };
}

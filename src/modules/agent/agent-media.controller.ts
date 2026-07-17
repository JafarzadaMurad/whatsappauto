// Media assets attached to a specific agent — the files the LLM can
// send to a customer on demand via the send_media tool. Owner-scoped;
// upload path reuses the general uploads/ directory + multer setup
// but writes a DB row that ties the file to an agent + human name.

import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { getWorkspaceId } from '../../lib/workspace-context';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase().slice(0, 8);
        const rand = crypto.randomBytes(12).toString('hex');
        cb(null, `${rand}${ext}`);
    },
});

// 50 MB matches WhatsApp Business API's per-file cap for video and
// keeps disk pressure bounded — larger files should stream via URL
// referenced by the agent's httpTools instead of being uploaded here.
export const agentMediaUpload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ok = /^(image|video|audio|application)\//.test(file.mimetype);
        if (!ok) return cb(new Error('Unsupported file type'));
        cb(null, true);
    },
});

function kindFromMime(mime: string): 'image' | 'video' | 'audio' | 'document' {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'document';
}

// Slugify user-supplied names into a shape that survives a system-
// prompt round-trip without confusing the model — lowercase, no spaces,
// keeps unicode letters, strips punctuation the tool wouldn't accept.
function slugName(raw: string): string {
    const trimmed = raw.trim().replace(/\.[a-z0-9]{1,8}$/i, ''); // drop extension if present
    return trimmed
        .replace(/[\s_/\\]+/g, '-')
        .replace(/[^\p{L}\p{N}\-]/gu, '')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 60) || `file-${Date.now().toString(36)}`;
}

async function ensureAgentInWorkspace(agentId: string, workspaceId: string | null) {
    if (!workspaceId) return null;
    return prisma.agent.findFirst({ where: { id: agentId, workspaceId } });
}

// De-collide a slug against the agent's existing media names by
// appending -2 / -3 / ... until unique.
async function uniqueName(agentId: string, base: string): Promise<string> {
    let name = base;
    let n = 2;
    while (true) {
        const clash = await prisma.agentMedia.findFirst({ where: { agentId, name } });
        if (!clash) return name;
        name = `${base}-${n++}`;
    }
}

export class AgentMediaController {
    async list(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const agentId = req.params.id as string;
            const agent = await ensureAgentInWorkspace(agentId, workspaceId);
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });
            const rows = await prisma.agentMedia.findMany({
                where: { agentId },
                orderBy: { createdAt: 'desc' },
            });
            return res.json({ success: true, media: rows });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async upload(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const agentId = req.params.id as string;
            const agent = await ensureAgentInWorkspace(agentId, workspaceId);
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });
            if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

            // Prefer the explicit name the UI sent (rename dialog), else
            // derive from the original filename.
            const suppliedName = z.string().min(1).max(120).optional().parse(req.body?.name);
            const description = z.string().max(2000).optional().parse(req.body?.description);
            const baseName = slugName(suppliedName || req.file.originalname);
            const name = await uniqueName(agentId, baseName);

            const base = (config.FRONTEND_URL || '').replace(/\/$/, '');
            const mediaUrl = `${base}/api/uploads/files/${req.file.filename}`;

            const row = await prisma.agentMedia.create({
                data: {
                    agentId,
                    workspaceId,
                    name,
                    filename: req.file.originalname,
                    mediaUrl,
                    mimeType: req.file.mimetype,
                    sizeBytes: req.file.size,
                    kind: kindFromMime(req.file.mimetype),
                    description: description || null,
                },
            });
            return res.status(201).json({ success: true, media: row });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async rename(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const agentId = req.params.id as string;
            const mediaId = req.params.mediaId as string;
            const body = z.object({
                name: z.string().min(1).max(120).optional(),
                description: z.string().max(2000).nullable().optional(),
            }).parse(req.body);

            const agent = await ensureAgentInWorkspace(agentId, workspaceId);
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });
            const existing = await prisma.agentMedia.findFirst({ where: { id: mediaId, agentId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Media not found' });

            const data: any = {};
            if (body.name && body.name !== existing.name) {
                const slug = slugName(body.name);
                data.name = await uniqueName(agentId, slug);
            }
            if (body.description !== undefined) data.description = body.description || null;

            const row = await prisma.agentMedia.update({ where: { id: mediaId }, data });
            return res.json({ success: true, media: row });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async remove(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const agentId = req.params.id as string;
            const mediaId = req.params.mediaId as string;
            const agent = await ensureAgentInWorkspace(agentId, workspaceId);
            if (!agent) return res.status(404).json({ success: false, message: 'Agent not found' });
            const existing = await prisma.agentMedia.findFirst({ where: { id: mediaId, agentId } });
            if (!existing) return res.status(404).json({ success: false, message: 'Media not found' });

            // Best-effort file delete — DB row goes away regardless so
            // the LLM catalogue stays consistent.
            try {
                const url = new URL(existing.mediaUrl);
                const parts = url.pathname.split('/');
                const fname = parts[parts.length - 1];
                if (fname && /^[a-f0-9]+(\.[a-zA-Z0-9]+)?$/i.test(fname)) {
                    fs.promises.unlink(path.join(UPLOAD_DIR, fname)).catch(() => {});
                }
            } catch { /* ignore */ }

            await prisma.agentMedia.delete({ where: { id: mediaId } });
            return res.json({ success: true });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

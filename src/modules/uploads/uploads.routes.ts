import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { authMiddleware } from '../../middleware/auth.middleware';
import { config } from '../../config';

const router: Router = Router();

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase().slice(0, 8);
        const rand = crypto.randomBytes(12).toString('hex');
        cb(null, `${rand}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB — large enough for video/PDF, capped to protect disk
    fileFilter: (_req, file, cb) => {
        // Accept any media / document — IG/WA enforce their own limits anyway
        const ok = /^(image|video|audio|application)\//.test(file.mimetype);
        if (!ok) return cb(new Error('Unsupported file type'));
        cb(null, true);
    }
});

router.post('/', authMiddleware, upload.single('file'), (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const base = (config.FRONTEND_URL || '').replace(/\/$/, '');
    const url = `${base}/api/uploads/files/${req.file.filename}`;
    return res.json({
        success: true,
        url,
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
    });
});

// Public file serving — no auth, because Meta / WhatsApp servers fetch by URL.
// Filenames are random hex, so guessing one is effectively impossible.
router.get('/files/:filename', (req: Request, res: Response) => {
    const name = String(req.params.filename || '');
    // Reject path traversal attempts before touching the filesystem
    if (!/^[a-f0-9]+(\.[a-zA-Z0-9]+)?$/i.test(name)) return res.status(400).end();
    const filePath = path.join(UPLOAD_DIR, name);
    if (!filePath.startsWith(UPLOAD_DIR)) return res.status(400).end();
    if (!fs.existsSync(filePath)) return res.status(404).end();
    return res.sendFile(filePath);
});

export default router;

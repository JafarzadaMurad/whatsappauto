import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';

const authService = new AuthService();

const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string().optional(),
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

export class AuthController {
    async register(req: Request, res: Response) {
        try {
            const data = registerSchema.parse(req.body);
            const result = await authService.register(data.email, data.password, data.name);
            return res.status(201).json({ success: true, ...result });
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, errors: error.issues });
            }
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    async login(req: Request, res: Response) {
        try {
            const data = loginSchema.parse(req.body);
            const result = await authService.login(data.email, data.password);
            return res.status(200).json({ success: true, ...result });
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, errors: error.issues });
            }
            return res.status(401).json({ success: false, message: error.message });
        }
    }

    async me(req: Request, res: Response) {
        // req.user will be populated by auth middleware
        return res.status(200).json({ success: true, user: (req as any).user });
    }

    // Public — expose the Google Client ID so the frontend can render the button
    async googleConfig(_req: Request, res: Response) {
        try {
            const row = await prisma.systemConfig.findUnique({ where: { key: 'GOOGLE_CLIENT_ID' } });
            return res.json({ success: true, clientId: row?.value || null });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // Sign in with a Google ID token returned by GIS / @react-oauth/google
    async googleLogin(req: Request, res: Response) {
        try {
            const schema = z.object({
                credential: z.string().optional(),
                access_token: z.string().optional()
            }).refine(v => v.credential || v.access_token, 'credential or access_token required');
            const parsed = schema.parse(req.body);
            const result = await authService.loginWithGoogle({
                credential: parsed.credential,
                accessToken: parsed.access_token
            });
            return res.json({ success: true, ...result });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(401).json({ success: false, message: error.message });
        }
    }
}

import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';

const authService = new AuthService();

const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string().optional(),
    // Optional on purpose: an unknown or mistyped code attributes
    // nothing and is never a reason to reject the sign-up.
    referralCode: z.string().max(32).optional(),
    referralSource: z.enum(['code', 'link']).optional(),
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

export class AuthController {
    async register(req: Request, res: Response) {
        try {
            const data = registerSchema.parse(req.body);
            const result = await authService.register(data.email, data.password, data.name, {
                code: data.referralCode,
                source: data.referralSource,
            });
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
    async verifyEmail(req: Request, res: Response) {
        try {
            const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
            await authService.verifyEmail(token);
            return res.json({ success: true });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    async resendVerification(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            await authService.resendVerification(userId);
            return res.json({ success: true });
        } catch (error: any) {
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    async forgotPassword(req: Request, res: Response) {
        try {
            const { email } = z.object({ email: z.string().email() }).parse(req.body);
            await authService.requestPasswordReset(email);
            // Always return success — don't leak which emails exist
            return res.json({ success: true });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async resetPassword(req: Request, res: Response) {
        try {
            const { token, password } = z.object({
                token: z.string().min(10),
                password: z.string().min(6)
            }).parse(req.body);
            await authService.resetPassword(token, password);
            return res.json({ success: true });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    // GET /auth/password-state — drives the profile form: whether to
    // show "Current password" (existing password) or "Set a password"
    // (Google-only account).
    async passwordState(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const state = await authService.getPasswordState(userId);
            return res.json({ success: true, ...state });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async changePassword(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { currentPassword, newPassword } = z.object({
                currentPassword: z.string().optional(),
                newPassword: z.string().min(6, 'Password must be at least 6 characters'),
            }).parse(req.body);
            const result = await authService.changePassword(userId, newPassword, currentPassword);
            return res.json({
                success: true,
                message: result.hadPassword ? 'Password updated' : 'Password set',
            });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(400).json({ success: false, message: error.message });
        }
    }

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

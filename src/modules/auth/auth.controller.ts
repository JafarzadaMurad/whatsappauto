import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { z } from 'zod';

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
}

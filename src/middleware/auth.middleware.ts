import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../lib/prisma';

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const token = authHeader.split(' ')[1];

        // Check if it's an API Key (starts with sk_)
        if (token.startsWith('sk_')) {
            const apiKey = await prisma.apiKey.findUnique({
                where: { key: token },
                include: { user: { select: { id: true, email: true, name: true } } }
            });

            if (!apiKey || !apiKey.user) {
                return res.status(401).json({ success: false, message: 'Invalid API Key' });
            }

            // Update last used timestamp
            await prisma.apiKey.update({
                where: { id: apiKey.id },
                data: { lastUsedAt: new Date() }
            });

            (req as any).user = apiKey.user;
            return next();
        }

        // Otherwise assume it's a JWT
        const decoded = jwt.verify(token, config.JWT_SECRET) as { id: string };

        const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: { id: true, email: true, name: true }
        });

        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid token' });
        }

        // Attach user to request
        (req as any).user = user;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
};

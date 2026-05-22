import { Request, Response, NextFunction } from 'express';

// Requires an authenticated ADMIN user. Must run after authMiddleware.
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user || user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    next();
};

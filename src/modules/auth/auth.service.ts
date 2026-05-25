import { prisma } from '../../lib/prisma';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../../config';

export class AuthService {
    async register(email: string, password: string, name?: string) {
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            throw new Error('User already exists');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Assign the default free plan, if one exists, with a trial end date
        const defaultPlan = await prisma.plan.findFirst({ where: { isDefault: true, isActive: true } });
        const subscriptionEndsAt = defaultPlan?.trialDays
            ? new Date(Date.now() + defaultPlan.trialDays * 24 * 60 * 60 * 1000)
            : null;

        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
                ...(defaultPlan ? {
                    planId: defaultPlan.id,
                    subscriptionStatus: defaultPlan.trialDays ? 'trialing' : 'active',
                    subscriptionEndsAt
                } : {})
            },
        });

        const token = this.generateToken(user.id);
        return { user: { id: user.id, email: user.email, name: user.name, role: user.role }, token };
    }

    async login(email: string, password: string) {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            throw new Error('Invalid email or password');
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            throw new Error('Invalid email or password');
        }

        const token = this.generateToken(user.id);
        return { user: { id: user.id, email: user.email, name: user.name, role: user.role }, token };
    }

    private generateToken(userId: string) {
        return jwt.sign({ id: userId }, config.JWT_SECRET, {
            expiresIn: config.JWT_EXPIRES_IN as any,
        });
    }
}

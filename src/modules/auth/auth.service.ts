import { prisma } from '../../lib/prisma';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { OAuth2Client } from 'google-auth-library';

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
        if (!user || !user.password) {
            throw new Error('Invalid email or password');
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            throw new Error('Invalid email or password');
        }

        const token = this.generateToken(user.id);
        return { user: { id: user.id, email: user.email, name: user.name, role: user.role }, token };
    }

    async loginWithGoogle(credential: string) {
        const cfg = await prisma.systemConfig.findUnique({ where: { key: 'GOOGLE_CLIENT_ID' } });
        const clientId = cfg?.value;
        if (!clientId) throw new Error('Google sign-in is not configured. Ask the admin to set Google Client ID.');

        const client = new OAuth2Client(clientId);
        const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
        const payload = ticket.getPayload();
        if (!payload?.sub || !payload.email) throw new Error('Invalid Google credential');

        const googleId = payload.sub;
        const email = payload.email;
        const name = payload.name || null;

        // Find by googleId first, then by email (link existing local account)
        let user = await prisma.user.findUnique({ where: { googleId } });
        if (!user) {
            user = await prisma.user.findUnique({ where: { email } });
            if (user) {
                user = await prisma.user.update({ where: { id: user.id }, data: { googleId } });
            }
        }

        if (!user) {
            // Brand new — assign default plan like normal registration
            const defaultPlan = await prisma.plan.findFirst({ where: { isDefault: true, isActive: true } });
            const subscriptionEndsAt = defaultPlan?.trialDays
                ? new Date(Date.now() + defaultPlan.trialDays * 24 * 60 * 60 * 1000) : null;
            user = await prisma.user.create({
                data: {
                    email, name, googleId,
                    password: null,
                    ...(defaultPlan ? {
                        planId: defaultPlan.id,
                        subscriptionStatus: defaultPlan.trialDays ? 'trialing' : 'active',
                        subscriptionEndsAt
                    } : {})
                }
            });
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

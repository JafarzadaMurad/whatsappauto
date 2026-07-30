import { prisma } from '../../lib/prisma';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { OAuth2Client } from 'google-auth-library';
import axios from 'axios';
import crypto from 'crypto';
import { sendMail, verificationEmail, resetPasswordEmail, appUrl } from '../../lib/mailer';
import { logger } from '../../utils/logger';

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

        const verifyToken = crypto.randomBytes(32).toString('hex');
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
                emailVerifyToken: verifyToken,
                emailVerifyExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
                ...(defaultPlan ? {
                    planId: defaultPlan.id,
                    subscriptionStatus: defaultPlan.trialDays ? 'trialing' : 'active',
                    subscriptionEndsAt
                } : {})
            },
        });

        // Fire-and-forget — registration succeeds even if SMTP isn't configured yet
        this.sendVerificationEmail(user.email, user.name, verifyToken).catch((err: any) =>
            logger.warn({ err: err.message, email: user.email }, '[Auth] verification email failed')
        );

        const token = this.generateToken(user.id);
        return { user: { id: user.id, email: user.email, name: user.name, role: user.role, emailVerified: user.emailVerified }, token };
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

    async loginWithGoogle(opts: { credential?: string; accessToken?: string }) {
        const cfg = await prisma.systemConfig.findUnique({ where: { key: 'GOOGLE_CLIENT_ID' } });
        const clientId = cfg?.value;
        if (!clientId) throw new Error('Google sign-in is not configured. Ask the admin to set Google Client ID.');

        let googleId: string;
        let email: string;
        let name: string | null = null;

        if (opts.credential) {
            // ID token flow — verify signature and audience
            const client = new OAuth2Client(clientId);
            const ticket = await client.verifyIdToken({ idToken: opts.credential, audience: clientId });
            const payload = ticket.getPayload();
            if (!payload?.sub || !payload.email) throw new Error('Invalid Google credential');
            googleId = payload.sub;
            email = payload.email;
            name = payload.name || null;
        } else if (opts.accessToken) {
            // Access-token flow (custom-button path): fetch userinfo from Google
            const r = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${opts.accessToken}` }
            });
            const u = r.data;
            if (!u?.sub || !u?.email) throw new Error('Invalid Google access token');
            googleId = String(u.sub);
            email = String(u.email);
            name = u.name || null;
        } else {
            throw new Error('Missing Google credential or access token');
        }

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

    // ─── Email verification ───
    async sendVerificationEmail(email: string, name: string | null, token: string) {
        const url = appUrl(`/verify-email?token=${token}`);
        const { subject, html } = verificationEmail(name, url);
        await sendMail({ to: email, subject, html });
    }

    async resendVerification(userId: string) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error('User not found');
        if (user.emailVerified) throw new Error('Email is already verified');
        const verifyToken = crypto.randomBytes(32).toString('hex');
        await prisma.user.update({
            where: { id: userId },
            data: {
                emailVerifyToken: verifyToken,
                emailVerifyExpires: new Date(Date.now() + 24 * 60 * 60 * 1000)
            }
        });
        await this.sendVerificationEmail(user.email, user.name, verifyToken);
    }

    async verifyEmail(token: string) {
        const user = await prisma.user.findUnique({ where: { emailVerifyToken: token } });
        if (!user) throw new Error('Invalid or already-used verification link');
        if (user.emailVerifyExpires && user.emailVerifyExpires < new Date()) {
            throw new Error('Verification link expired — request a new one');
        }
        await prisma.user.update({
            where: { id: user.id },
            data: { emailVerified: true, emailVerifyToken: null, emailVerifyExpires: null }
        });
    }

    // ─── Password reset ───
    async requestPasswordReset(email: string) {
        const user = await prisma.user.findUnique({ where: { email } });
        // Always succeed silently to avoid leaking which emails exist
        if (!user || !user.password) return;
        const resetToken = crypto.randomBytes(32).toString('hex');
        await prisma.user.update({
            where: { id: user.id },
            data: {
                passwordResetToken: resetToken,
                passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000) // 1 hour
            }
        });
        const url = appUrl(`/reset-password?token=${resetToken}`);
        const { subject, html } = resetPasswordEmail(user.name, url);
        try {
            await sendMail({ to: user.email, subject, html });
        } catch (err: any) {
            logger.warn({ err: err.message, email }, '[Auth] reset email failed');
        }
    }

    async resetPassword(token: string, newPassword: string) {
        const user = await prisma.user.findUnique({ where: { passwordResetToken: token } });
        if (!user) throw new Error('Invalid or already-used reset link');
        if (user.passwordResetExpires && user.passwordResetExpires < new Date()) {
            throw new Error('Reset link expired — request a new one');
        }
        const hashed = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashed,
                passwordResetToken: null,
                passwordResetExpires: null,
                emailVerified: true // proves access to inbox
            }
        });
    }

    // Signed-in password change. Google-only accounts have
    // `password === null` — they set a password for the first time here
    // (so the profile can be handed to a colleague who logs in with
    // email + password), and for them `currentPassword` isn't required
    // because there is nothing to verify against.
    async changePassword(userId: string, newPassword: string, currentPassword?: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, password: true },
        });
        if (!user) throw new Error('User not found');

        const hasPassword = !!user.password;
        if (hasPassword) {
            if (!currentPassword) throw new Error('Current password is required');
            const okPassword = await bcrypt.compare(currentPassword, user.password!);
            if (!okPassword) throw new Error('Current password is incorrect');
            const same = await bcrypt.compare(newPassword, user.password!);
            if (same) throw new Error('New password must be different from the current one');
        }

        const hashed = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: userId },
            data: {
                password: hashed,
                // Any outstanding reset link is void once the password
                // changes from inside the app.
                passwordResetToken: null,
                passwordResetExpires: null,
            },
        });
        return { hadPassword: hasPassword };
    }

    // Tells the profile UI whether to ask for the current password.
    async getPasswordState(userId: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { password: true, googleId: true },
        });
        return {
            hasPassword: !!user?.password,
            isGoogleAccount: !!user?.googleId,
        };
    }

    private generateToken(userId: string) {
        return jwt.sign({ id: userId }, config.JWT_SECRET, {
            expiresIn: config.JWT_EXPIRES_IN as any,
        });
    }
}

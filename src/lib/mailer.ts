import nodemailer from 'nodemailer';
import { prisma } from './prisma';
import { logger } from '../utils/logger';
import { config } from '../config';

let cachedTransporter: { signature: string; transporter: nodemailer.Transporter } | null = null;

async function getSmtpConfig() {
    const rows = await prisma.systemConfig.findMany({
        where: { key: { in: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_SECURE'] } }
    });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return {
        host: map.SMTP_HOST || '',
        port: Number(map.SMTP_PORT || 587),
        user: map.SMTP_USER || '',
        pass: map.SMTP_PASS || '',
        from: map.SMTP_FROM || map.SMTP_USER || '',
        secure: map.SMTP_SECURE === 'true' || Number(map.SMTP_PORT || 587) === 465
    };
}

async function getTransporter(): Promise<{ transporter: nodemailer.Transporter; from: string }> {
    const cfg = await getSmtpConfig();
    if (!cfg.host || !cfg.user || !cfg.pass) {
        throw new Error('SMTP is not configured. Ask the admin to set SMTP host/user/password in Admin → Email.');
    }
    const signature = `${cfg.host}|${cfg.port}|${cfg.user}|${cfg.pass}|${cfg.secure}`;
    if (cachedTransporter?.signature === signature) {
        return { transporter: cachedTransporter.transporter, from: cfg.from };
    }
    const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: { user: cfg.user, pass: cfg.pass }
    });
    cachedTransporter = { signature, transporter };
    return { transporter, from: cfg.from };
}

export async function sendMail(opts: { to: string; subject: string; html: string; text?: string }) {
    const { transporter, from } = await getTransporter();
    const info = await transporter.sendMail({
        from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text || opts.html.replace(/<[^>]+>/g, ' ')
    });
    logger.info({ to: opts.to, subject: opts.subject, messageId: info.messageId }, '[Mail] sent');
    return info;
}

// ─── Branded email shells ───
function baseLayout(title: string, body: string, ctaLabel?: string, ctaUrl?: string): string {
    return `<!doctype html>
<html><body style="margin:0;padding:32px;background:#0a0a0c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f5f5;">
  <div style="max-width:540px;margin:0 auto;background:#15151a;border:1px solid #2a2a30;border-radius:16px;padding:32px;">
    <h1 style="margin:0 0 16px 0;font-size:22px;color:#fbbf24;">alChatBot</h1>
    <h2 style="margin:0 0 16px 0;font-size:18px;color:#fff;">${title}</h2>
    <div style="font-size:14px;line-height:1.6;color:#d4d4d8;">${body}</div>
    ${ctaUrl && ctaLabel ? `<div style="margin:24px 0;text-align:center;">
      <a href="${ctaUrl}" style="display:inline-block;background:#fbbf24;color:#0a0a0c;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;">${ctaLabel}</a>
    </div>
    <div style="font-size:11px;color:#71717a;word-break:break-all;">Or paste this link in your browser: ${ctaUrl}</div>` : ''}
    <hr style="border:0;border-top:1px solid #2a2a30;margin:24px 0;" />
    <p style="font-size:11px;color:#71717a;margin:0;">If you didn't request this email you can safely ignore it.</p>
  </div>
</body></html>`;
}

export function verificationEmail(name: string | null, url: string): { subject: string; html: string } {
    return {
        subject: 'Verify your alChatBot email',
        html: baseLayout(
            `Hi ${name || 'there'} 👋`,
            `<p>Thanks for signing up. Please confirm this is your email by clicking the button below — the link expires in 24 hours.</p>`,
            'Verify email', url
        )
    };
}

export function resetPasswordEmail(name: string | null, url: string): { subject: string; html: string } {
    return {
        subject: 'Reset your alChatBot password',
        html: baseLayout(
            `Hi ${name || 'there'}`,
            `<p>We received a request to reset your password. Click the button to choose a new one — the link expires in 1 hour.</p>`,
            'Reset password', url
        )
    };
}

export function appUrl(path: string): string {
    const base = (config.FRONTEND_URL || 'https://chatbot.tural.ai').replace(/\/$/, '');
    return `${base}${path.startsWith('/') ? path : '/' + path}`;
}

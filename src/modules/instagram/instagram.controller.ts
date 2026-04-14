import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import axios from 'axios';
import { InstagramAiService } from './instagram.ai.service';

const VERIFY_TOKEN = 'alchatbot_verify_2024';
function getRedirectUri() {
    const base = config.FRONTEND_URL || 'https://chatbot.tur.al';
    return `${base.replace(/\/$/, '')}/api/instagram/callback`;
}

async function getMetaConfig() {
    const rows = await prisma.systemConfig.findMany({
        where: { key: { in: ['META_APP_ID', 'META_APP_SECRET', 'META_IG_APP_ID', 'META_IG_APP_SECRET'] } }
    });
    const cfg: Record<string, string> = {};
    rows.forEach(r => { cfg[r.key] = r.value; });
    return cfg;
}

export class InstagramController {
    // ─── OAuth: Generate login URL ───
    async getAuthUrl(req: Request, res: Response) {
        try {
            const cfg = await getMetaConfig();
            if (!cfg.META_IG_APP_ID) {
                return res.status(500).json({ success: false, message: 'Instagram App ID not configured' });
            }

            const redirectUri = getRedirectUri();
            const scope = 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments';
            const url = `https://www.instagram.com/oauth/authorize?enable_fb_login=0&force_authentication=1&client_id=${cfg.META_IG_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}`;

            return res.json({ success: true, url });
        } catch (error: any) {
            logger.error({ err: error }, 'Failed to generate Instagram auth URL');
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── OAuth: Handle callback ───
    async handleCallback(req: Request, res: Response) {
        try {
            const code = req.query.code as string;
            if (!code) return res.status(400).send('Missing code parameter');

            const cfg = await getMetaConfig();
            const redirectUri = getRedirectUri();

            // Exchange code for short-lived token
            const igSecret = cfg.META_IG_APP_SECRET || cfg.META_APP_SECRET; // Try IG App Secret first
            logger.info({ redirectUri, clientId: cfg.META_IG_APP_ID, codeLength: code?.length }, 'Instagram token exchange attempt');
            const tokenRes = await axios.post('https://api.instagram.com/oauth/access_token', new URLSearchParams({
                client_id: cfg.META_IG_APP_ID,
                client_secret: igSecret,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri,
                code,
            }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

            const shortToken = tokenRes.data.access_token;
            const igUserId = String(tokenRes.data.user_id);

            // Exchange for long-lived token (60 days)
            const longTokenRes = await axios.get('https://graph.instagram.com/access_token', {
                params: {
                    grant_type: 'ig_exchange_token',
                    client_secret: cfg.META_APP_SECRET,
                    access_token: shortToken,
                }
            });

            const longToken = longTokenRes.data.access_token;

            // Get user profile
            const profileRes = await axios.get(`https://graph.instagram.com/v21.0/${igUserId}`, {
                params: { fields: 'user_id,username', access_token: longToken }
            });

            const username = profileRes.data.username || 'unknown';

            // We need the userId from our auth - get it from the state or session
            // For now, redirect to frontend with token info to complete linking
            const frontendUrl = process.env.FRONTEND_URL || 'https://chatbot.tur.al';
            const params = new URLSearchParams({
                igUserId,
                username,
                token: longToken,
            });

            return res.redirect(`${frontendUrl}/dashboard/instagram/callback?${params.toString()}`);
        } catch (error: any) {
            const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            logger.error({ err: error, responseData: error.response?.data, status: error.response?.status }, 'Instagram OAuth callback failed: ' + detail);
            const frontendUrl = process.env.FRONTEND_URL || 'https://chatbot.tur.al';
            return res.redirect(`${frontendUrl}/dashboard/instagram?error=${encodeURIComponent(detail)}`);
        }
    }

    // ─── Save connected account (called from frontend after callback) ───
    async saveAccount(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { igUserId, username, accessToken, agentId } = req.body;

            if (!igUserId || !accessToken) {
                return res.status(400).json({ success: false, message: 'Missing igUserId or accessToken' });
            }

            const account = await prisma.instagramAccount.upsert({
                where: { igUserId },
                update: { accessToken, igUsername: username, agentId: agentId || null, userId },
                create: { userId, igUserId, igUsername: username, accessToken, agentId: agentId || null }
            });

            // Subscribe to webhooks for this account
            try {
                await axios.post(`https://graph.instagram.com/v21.0/${igUserId}/subscribed_apps`, null, {
                    params: {
                        subscribed_fields: 'messages,comments',
                        access_token: accessToken,
                    }
                });
                logger.info(`Subscribed to webhooks for IG user ${igUserId}`);
            } catch (subErr: any) {
                logger.warn({ err: subErr }, 'Failed to subscribe to IG webhooks (may need app review)');
            }

            return res.json({ success: true, account });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── List connected accounts ───
    async getAccounts(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const accounts = await prisma.instagramAccount.findMany({
                where: { userId },
                include: { agent: { select: { name: true, id: true } } },
                orderBy: { createdAt: 'desc' }
            });
            return res.json({ success: true, accounts });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── Update account (change agent, toggle active) ───
    async updateAccount(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            const { agentId, isActive } = req.body;

            const account = await prisma.instagramAccount.findFirst({ where: { id, userId } });
            if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

            const updated = await prisma.instagramAccount.update({
                where: { id },
                data: {
                    ...(agentId !== undefined ? { agentId: agentId || null } : {}),
                    ...(isActive !== undefined ? { isActive } : {}),
                }
            });

            return res.json({ success: true, account: updated });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── Delete account ───
    async deleteAccount(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;

            const account = await prisma.instagramAccount.findFirst({ where: { id, userId } });
            if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

            await prisma.instagramAccount.delete({ where: { id } });
            return res.json({ success: true, message: 'Account disconnected' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── Webhook verification (GET) ───
    async verifyWebhook(req: Request, res: Response) {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            logger.info('Instagram webhook verified');
            return res.status(200).send(challenge);
        }
        return res.sendStatus(403);
    }

    // ─── Webhook handler (POST) ───
    async handleWebhook(req: Request, res: Response) {
        // Always respond 200 quickly to Meta
        res.sendStatus(200);

        try {
            const body = req.body;
            if (body.object !== 'instagram') return;

            for (const entry of body.entry || []) {
                const igUserId = entry.id;

                // Handle DMs
                for (const messaging of entry.messaging || []) {
                    if (messaging.message && messaging.sender?.id !== igUserId) {
                        const senderId = messaging.sender.id;
                        const text = messaging.message.text;
                        if (!text) continue;

                        logger.info(`[IG] DM from ${senderId} to ${igUserId}: ${text}`);
                        InstagramAiService.handleDm(igUserId, senderId, text).catch(err => {
                            logger.error({ err }, '[IG] Failed to handle DM');
                        });
                    }
                }

                // Handle Comments
                for (const change of entry.changes || []) {
                    if (change.field === 'comments' && change.value) {
                        const comment = change.value;
                        const commentId = comment.id;
                        const text = comment.text;
                        const from = comment.from;
                        const mediaId = comment.media?.id;

                        if (!text || !from || from.id === igUserId) continue;

                        logger.info(`[IG] Comment from ${from.username} on media ${mediaId}: ${text}`);
                        InstagramAiService.handleComment(igUserId, commentId, text, from, mediaId).catch(err => {
                            logger.error({ err }, '[IG] Failed to handle comment');
                        });
                    }
                }
            }
        } catch (error) {
            logger.error({ err: error }, 'Error processing Instagram webhook');
        }
    }
}

import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import axios from 'axios';
import { InstagramAiService } from './instagram.ai.service';
import { checkPlanLimit, PlanLimitError } from '../../lib/plan-limits';
import { getWorkspaceId } from '../../lib/workspace-context';

const VERIFY_TOKEN = 'alchatbot_verify_2024';

// In-memory cache to deduplicate webhook events (Meta sometimes sends duplicates)
const processedEvents = new Map<string, number>();
function isDuplicate(key: string): boolean {
    const now = Date.now();
    // Cleanup old entries (older than 10 minutes)
    for (const [k, t] of processedEvents.entries()) {
        if (now - t > 600000) processedEvents.delete(k);
    }
    if (processedEvents.has(key)) return true;
    processedEvents.set(key, now);
    return false;
}
function getRedirectUri() {
    const base = config.FRONTEND_URL || 'https://chatbot.tur.al';
    return `${base.replace(/\/$/, '')}/dashboard/instagram/callback`;
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
            // Documented Instagram Business Login params only — enable_fb_login /
            // force_authentication are not honored by instagram.com/oauth/authorize.
            const scope = 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments';
            const url = `https://www.instagram.com/oauth/authorize?client_id=${cfg.META_IG_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}`;

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
            logger.info({ codeStart: code?.slice(0, 20), fullUrl: req.originalUrl?.slice(0, 80) }, 'Instagram callback received');
            if (!code) return res.status(400).send('Missing code parameter');

            const cfg = await getMetaConfig();
            const redirectUri = getRedirectUri();

            // Exchange code for short-lived token
            const igSecret = cfg.META_IG_APP_SECRET;
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

    // ─── Exchange code for token (called from frontend) ───
    async exchangeCode(req: Request, res: Response) {
        try {
            const rawCode = req.body.code;
            console.log('[IG] exchangeCode called, code length:', rawCode?.length);
            if (!rawCode) return res.status(400).json({ success: false, message: 'Missing code' });
            const code = rawCode.replace(/#.*$/, '').trim();

            const cfg = await getMetaConfig();
            const redirectUri = getRedirectUri();
            const igSecret = cfg.META_IG_APP_SECRET;

            require('fs').writeFileSync('/tmp/ig-debug.json', JSON.stringify({ redirectUri, clientId: cfg.META_IG_APP_ID, codeStart: code.slice(0, 30), secret: igSecret.slice(0, 5) + '...' }, null, 2));

            // 1. Exchange code for short-lived token (POST to api.instagram.com)
            const tokenRes = await axios.post('https://api.instagram.com/oauth/access_token',
                `client_id=${cfg.META_IG_APP_ID}&client_secret=${igSecret}&grant_type=authorization_code&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`,
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            const shortToken = tokenRes.data.access_token;
            const tokenUserId = String(tokenRes.data.user_id);

            // 2. Exchange for long-lived token (60 days) - GET per docs
            let longToken = shortToken;
            try {
                const longTokenRes = await axios.get('https://graph.instagram.com/access_token', {
                    params: { grant_type: 'ig_exchange_token', client_secret: igSecret, access_token: shortToken }
                });
                if (longTokenRes.data.access_token) longToken = longTokenRes.data.access_token;
            } catch (e: any) {
                require('fs').writeFileSync('/tmp/ig-longtoken-error.json', JSON.stringify({ data: e.response?.data, status: e.response?.status, msg: e.message }));
            }

            // 3. Get profile — retry to absorb transient Meta API errors
            let username = '';
            let igUserId = '';
            let lastError: any = null;
            // v21.0 is the version proven to work for Instagram Business Login
            // (graph.instagram.com); the unversioned path is a safety-net fallback.
            const profileEndpoints = [
                'https://graph.instagram.com/v21.0/me',
                'https://graph.instagram.com/me',
            ];
            // Try the long-lived token first, then the short-lived token —
            // whichever the API accepts.
            const tokensToTry = longToken === shortToken ? [shortToken] : [longToken, shortToken];
            for (let attempt = 0; attempt < 3 && !username; attempt++) {
                if (attempt > 0) await new Promise(r => setTimeout(r, 1000));
                for (const url of profileEndpoints) {
                    if (username) break;
                    for (const tok of tokensToTry) {
                    try {
                        const r = await axios.get(url, {
                            params: { fields: 'user_id,username,account_type', access_token: tok }
                        });
                        if (r.data.username || r.data.user_id) {
                            username = r.data.username || '';
                            igUserId = String(r.data.user_id || r.data.id || '');
                            require('fs').writeFileSync('/tmp/ig-profile-success.json', JSON.stringify({ endpoint: url, data: r.data }));
                            break;
                        }
                    } catch (e: any) {
                        lastError = e.response?.data?.error || { message: e.message };
                        require('fs').writeFileSync('/tmp/ig-profile-error.json', JSON.stringify({ endpoint: url, data: e.response?.data, status: e.response?.status }));
                    }
                    } // tokensToTry
                } // profileEndpoints
            } // attempt

            // Never save a bogus "unknown" account — surface a clear error instead
            if (!username || !igUserId) {
                const msg = (lastError?.message || '').includes('Unsupported request')
                    ? 'Could not read the Instagram profile. Make sure the account is an Instagram Professional account (Business or Creator), then try connecting again.'
                    : `Could not read the Instagram profile: ${lastError?.message || 'unknown error'}. Please try connecting again.`;
                return res.status(400).json({ success: false, message: msg });
            }

            return res.json({
                success: true,
                igUserId,
                username,
                accessToken: longToken,
            });
        } catch (error: any) {
            const detail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
            require('fs').writeFileSync('/tmp/ig-error.json', JSON.stringify({ detail, responseData: error.response?.data, status: error.response?.status }, null, 2));
            logger.error({ responseData: error.response?.data }, 'Instagram code exchange failed: ' + detail);
            return res.status(400).json({ success: false, message: detail });
        }
    }

    // ─── Save connected account (called from frontend after callback) ───
    async saveAccount(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const { igUserId, username, accessToken, agentId } = req.body;

            if (!igUserId || !accessToken) {
                return res.status(400).json({ success: false, message: 'Missing igUserId or accessToken' });
            }
            if (!username || username === 'unknown') {
                return res.status(400).json({ success: false, message: 'Instagram profile could not be resolved. Please reconnect the account.' });
            }

            // Enforce plan limit only for NEW connections (re-saving an existing account is fine)
            const exists = await prisma.instagramAccount.findUnique({ where: { igUserId } });
            if (!exists) await checkPlanLimit(userId, 'instagram');

            const account = await prisma.instagramAccount.upsert({
                where: { igUserId },
                update: { accessToken, igUsername: username, agentId: agentId || null, userId, workspaceId },
                create: { userId, workspaceId, igUserId, igUsername: username, accessToken, agentId: agentId || null }
            });

            // Subscribe to webhooks for this account (use me/ endpoint with Bearer auth)
            try {
                await axios.post('https://graph.instagram.com/v25.0/me/subscribed_apps',
                    'subscribed_fields=messages,comments',
                    { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
                );
                logger.info(`Subscribed to webhooks for IG user ${igUserId}`);
            } catch (subErr: any) {
                logger.warn({ err: subErr }, 'Failed to subscribe to IG webhooks');
            }

            return res.json({ success: true, account });
        } catch (error: any) {
            if (error instanceof PlanLimitError) return res.status(403).json({ success: false, message: error.message, code: error.code });
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── List connected accounts ───
    async getAccounts(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const accounts = await prisma.instagramAccount.findMany({
                where: { workspaceId },
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
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const { agentId, routerAgentId, isActive } = req.body;

            const account = await prisma.instagramAccount.findFirst({ where: { id, workspaceId } });
            if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

            const updated = await prisma.instagramAccount.update({
                where: { id },
                data: {
                    ...(agentId !== undefined ? { agentId: agentId || null } : {}),
                    ...(routerAgentId !== undefined ? { routerAgentId: routerAgentId || null } : {}),
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
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const account = await prisma.instagramAccount.findFirst({ where: { id, workspaceId } });
            if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

            await prisma.instagramAccount.delete({ where: { id } });
            return res.json({ success: true, message: 'Account disconnected' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── Account profile (live from Instagram) ───
    async getAccountProfile(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const account = await prisma.instagramAccount.findFirst({ where: { id, workspaceId } });
            if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

            let profile: any = { username: account.igUsername, igUserId: account.igUserId };
            try {
                const r = await axios.get('https://graph.instagram.com/v21.0/me', {
                    params: {
                        fields: 'user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count,biography,website',
                        access_token: account.accessToken
                    }
                });
                profile = { ...profile, ...r.data };
            } catch (e: any) {
                logger.warn({ err: e.response?.data?.error?.message || e.message }, '[IG] profile fetch failed');
            }
            return res.json({ success: true, account: { id: account.id, agentId: account.agentId, isActive: account.isActive }, profile });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── Recent media (posts) ───
    async getAccountMedia(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const account = await prisma.instagramAccount.findFirst({ where: { id, workspaceId } });
            if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

            try {
                const r = await axios.get('https://graph.instagram.com/v21.0/me/media', {
                    params: {
                        fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count',
                        access_token: account.accessToken,
                        limit: 30
                    }
                });
                return res.json({ success: true, media: r.data.data || [] });
            } catch (e: any) {
                return res.status(502).json({ success: false, message: e.response?.data?.error?.message || e.message });
            }
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── Comments on a media post ───
    async getMediaComments(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const mediaId = req.params.mediaId as string;
            const account = await prisma.instagramAccount.findFirst({ where: { id, workspaceId } });
            if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

            try {
                const r = await axios.get(`https://graph.instagram.com/v21.0/${mediaId}/comments`, {
                    params: {
                        fields: 'id,text,username,timestamp,like_count,replies{id,text,username,timestamp}',
                        access_token: account.accessToken
                    }
                });
                return res.json({ success: true, comments: r.data.data || [] });
            } catch (e: any) {
                return res.status(502).json({ success: false, message: e.response?.data?.error?.message || e.message });
            }
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    // ─── Reply to a comment ───
    async replyToMediaComment(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;
            const commentId = req.params.commentId as string;
            const text = String(req.body.text || '').trim();
            if (!text) return res.status(400).json({ success: false, message: 'Reply text required' });

            const account = await prisma.instagramAccount.findFirst({ where: { id, workspaceId } });
            if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

            try {
                await axios.post(`https://graph.instagram.com/v21.0/${commentId}/replies`,
                    `message=${encodeURIComponent(text)}`,
                    { headers: { 'Authorization': `Bearer ${account.accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
                );
                return res.json({ success: true });
            } catch (e: any) {
                const ig = e.response?.data?.error;
                return res.status(502).json({ success: false, message: ig?.error_user_msg || ig?.message || e.message });
            }
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
            // Debug: log every incoming webhook to see what Meta sends
            logger.info({ webhook: JSON.stringify(body).slice(0, 500) }, '[IG] webhook received');
            if (body.object !== 'instagram') return;

            for (const entry of body.entry || []) {
                const igUserId = entry.id;

                // Handle DMs
                for (const messaging of entry.messaging || []) {
                    // Skip echoes — the business account's own outgoing messages
                    if (messaging.message?.is_echo) continue;
                    if (messaging.message && messaging.sender?.id !== igUserId) {
                        const senderId = messaging.sender.id;
                        const text = messaging.message.text;
                        const mid = messaging.message.mid;
                        if (!text) continue;

                        // Dedupe by message ID
                        if (mid && isDuplicate(`dm:${mid}`)) {
                            logger.info(`[IG] Duplicate DM ignored: ${mid}`);
                            continue;
                        }

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

                        // Dedupe by comment ID
                        if (isDuplicate(`comment:${commentId}`)) {
                            logger.info(`[IG] Duplicate comment ignored: ${commentId}`);
                            continue;
                        }

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

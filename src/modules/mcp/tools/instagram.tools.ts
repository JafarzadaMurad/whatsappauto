import axios from 'axios';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { config } from '../../../config';
import { sendIgMessage, sendIgRichMessage } from '../../instagram/instagram.ai.service';
import { ok, fail, type RegisterToolFn } from '../mcp.server';

export function registerInstagramTools(reg: RegisterToolFn) {
    reg(
        'list_instagram_accounts',
        'Lists Instagram Business accounts connected by the calling user.',
        {},
        async (_args, ctx) => {
            const rows = await prisma.instagramAccount.findMany({
                where: { userId: ctx.userId },
                select: { id: true, igUserId: true, igUsername: true, isActive: true, agentId: true, createdAt: true },
                orderBy: { createdAt: 'desc' },
            });
            return ok(rows);
        },
    );

    reg(
        'get_instagram_account',
        'Returns details about a connected Instagram account.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const row = await prisma.instagramAccount.findFirst({
                where: { id, userId: ctx.userId },
                select: { id: true, igUserId: true, igUsername: true, isActive: true, agentId: true, createdAt: true },
            });
            if (!row) return fail(`Instagram account ${id} not found`);
            return ok(row);
        },
    );

    reg(
        'get_instagram_connect_url',
        'Returns the URL the user must open in a browser to authorize a new Instagram Business account. The user has to click "Authorize" on Meta\'s page — AI cannot complete this step automatically.',
        {},
        async () => {
            const cfgRows = await prisma.systemConfig.findMany({ where: { key: { in: ['META_IG_APP_ID'] } } });
            const appId = cfgRows.find(r => r.key === 'META_IG_APP_ID')?.value;
            if (!appId) return fail('Instagram is not configured on this platform (META_IG_APP_ID missing).');
            const base = (config.FRONTEND_URL || 'https://chatbot.tur.al').replace(/\/$/, '');
            const redirectUri = `${base}/dashboard/instagram/callback`;
            const scope = 'instagram_business_basic,instagram_business_manage_messages';
            const url = `https://www.instagram.com/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}`;
            return ok({ url, note: 'Open this URL in a browser while signed in to Instagram. The redirect lands back on the alChatBot dashboard.' });
        },
    );

    reg(
        'disconnect_instagram_account',
        'Disconnects an Instagram account. The user can reconnect later via OAuth.',
        { id: z.string() },
        async ({ id }, ctx) => {
            const row = await prisma.instagramAccount.findFirst({ where: { id, userId: ctx.userId } });
            if (!row) return fail(`Instagram account ${id} not found`);
            await prisma.instagramAccount.delete({ where: { id } });
            return ok({ deleted: true, id });
        },
    );

    reg(
        'list_instagram_media',
        'Lists recent posts on a connected Instagram account (up to 30). Returns id, caption, media_type, permalink, comment / like counts. Use the post id as `mediaId` for the trigger_ig_comment node.',
        { accountId: z.string() },
        async ({ accountId }, ctx) => {
            const acc = await prisma.instagramAccount.findFirst({ where: { id: accountId, userId: ctx.userId } });
            if (!acc) return fail(`Instagram account ${accountId} not found`);
            try {
                const r = await axios.get('https://graph.instagram.com/v21.0/me/media', {
                    params: {
                        fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count',
                        access_token: acc.accessToken,
                        limit: 30,
                    },
                });
                return ok({ media: r.data?.data || [] });
            } catch (e: any) {
                return fail(e.response?.data?.error?.message || e.message);
            }
        },
    );

    reg(
        'list_instagram_comments',
        'Lists comments on a specific Instagram post.',
        { accountId: z.string(), mediaId: z.string() },
        async ({ accountId, mediaId }, ctx) => {
            const acc = await prisma.instagramAccount.findFirst({ where: { id: accountId, userId: ctx.userId } });
            if (!acc) return fail(`Instagram account ${accountId} not found`);
            try {
                const r = await axios.get(`https://graph.instagram.com/v21.0/${mediaId}/comments`, {
                    params: {
                        fields: 'id,text,username,timestamp,like_count,replies{id,text,username,timestamp}',
                        access_token: acc.accessToken,
                    },
                });
                return ok({ comments: r.data?.data || [] });
            } catch (e: any) {
                return fail(e.response?.data?.error?.message || e.message);
            }
        },
    );

    reg(
        'send_instagram_dm',
        'Sends an Instagram DM from a connected business account to a recipient IGSID. Text-only or with an attachment (image / video / audio). The recipient must already be in the 24-hour messaging window unless this DM is in response to a tagged comment.',
        {
            accountId: z.string(),
            recipientId: z.string(),
            text: z.string().optional(),
            attachment: z.object({
                kind: z.enum(['image', 'video', 'audio']),
                url: z.string().url(),
            }).optional(),
        },
        async ({ accountId, recipientId, text, attachment }, ctx) => {
            const acc = await prisma.instagramAccount.findFirst({ where: { id: accountId, userId: ctx.userId } });
            if (!acc) return fail(`Instagram account ${accountId} not found`);
            if (!text && !attachment) return fail('Provide at least one of `text` or `attachment`.');
            try {
                if (attachment) {
                    await sendIgRichMessage(acc.igUserId, recipientId, { kind: 'attachment', attachmentType: attachment.kind, url: attachment.url }, acc.accessToken);
                }
                if (text) {
                    await sendIgMessage(acc.igUserId, recipientId, text, acc.accessToken);
                }
                return ok({ sent: true });
            } catch (e: any) {
                return fail(e.response?.data?.error?.message || e.message);
            }
        },
    );

    reg(
        'reply_instagram_comment',
        'Posts a public reply to an Instagram comment. Requires the instagram_business_manage_comments permission — pending re-approval from Meta on this app.',
        { accountId: z.string(), commentId: z.string(), text: z.string().min(1) },
        async ({ accountId, commentId, text }, ctx) => {
            const acc = await prisma.instagramAccount.findFirst({ where: { id: accountId, userId: ctx.userId } });
            if (!acc) return fail(`Instagram account ${accountId} not found`);
            try {
                await axios.post(`https://graph.instagram.com/v21.0/${commentId}/replies`,
                    `message=${encodeURIComponent(text)}`,
                    { headers: { Authorization: `Bearer ${acc.accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' } },
                );
                return ok({ replied: true });
            } catch (e: any) {
                const ig = e.response?.data?.error;
                return fail(ig?.error_user_msg || ig?.message || e.message);
            }
        },
    );
}

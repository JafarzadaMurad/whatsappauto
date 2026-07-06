import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, zodSchema, stepCountIs } from 'ai';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import axios from 'axios';
import { buildToolsForSkills, applyAnthropicCacheControl, extractCacheUsage, type HttpToolTemplate } from '../agent/ai.service';
import { AutomationEngine, type RichDmPayload, type MediaPayload } from '../automation/automation.engine';
import { upsertCrmContact } from '../client/client.service';
import { extractIgReferrer } from '../ads/ad-referrer';

// makeTool used only for IG-specific tools (polls fallback). The
// universal skill builder is imported from ai.service.ts so IG picks
// up every skill (CRM, tables, user_fields, self_pause, memory,
// http, live_operator) automatically — no duplication.
function makeTool(description: string, schema: z.ZodObject<any>, execute: (params: any) => Promise<any>) {
    const wrapped = zodSchema(schema);
    return { description, parameters: wrapped, inputSchema: wrapped, execute };
}

// Instagram DMs have no native poll type — closest analogue is
// text + quick_replies (tap-to-select buttons, IG caps at 13).
// Customer taps one, IG delivers their choice as an ordinary inbound
// DM which the regular handler then treats as their answer. Same
// tool signature as the WhatsApp poll so agent prompts don't need
// to know which channel they're on.
function buildIgPollsTool(igUserId: string, senderId: string, accessToken: string) {
    return {
        sendPoll: makeTool(
            'Send an interactive choice question with 2-13 tappable buttons. Use it when you want the customer to pick from a discrete set instead of typing free text.',
            z.object({
                name: z.string().min(1).max(950).describe('The question shown above the buttons.'),
                options: z.array(z.string().min(1).max(20)).min(2).max(13).describe('Button labels — max 20 chars each, 2-13 total.'),
                multi: z.boolean().optional().describe('Instagram only supports single-choice; multi is ignored.'),
            }),
            async (params: { name: string; options: string[]; multi?: boolean }) => {
                try {
                    await sendIgRichMessage(igUserId, senderId, {
                        kind: 'text',
                        text: params.name,
                        quickReplies: params.options.map(o => ({ title: o })),
                    } as any, accessToken);
                    return { ok: true, name: params.name, options: params.options };
                } catch (e: any) {
                    return { ok: false, error: e?.message };
                }
            },
        ),
    };
}

// Fetch and cache an Instagram contact's profile (username, name, picture).
// Refetches only if missing or older than 24h to conserve API quota.
export async function cacheIgContact(igUserId: string, senderId: string, accessToken: string) {
    try {
        const existing = await prisma.instagramContact.findUnique({
            where: { igUserId_senderId: { igUserId, senderId } }
        });
        const stale = !existing || (Date.now() - new Date(existing.updatedAt).getTime() > 24 * 60 * 60 * 1000);
        if (!stale) {
            await prisma.instagramContact.update({
                where: { igUserId_senderId: { igUserId, senderId } },
                data: { lastMessageAt: new Date() }
            });
            return;
        }
        let profile: any = {};
        try {
            const res = await axios.get(`https://graph.instagram.com/v21.0/${senderId}`, {
                params: { fields: 'name,username,profile_pic', access_token: accessToken }
            });
            profile = res.data || {};
        } catch (e: any) {
            logger.warn({ senderId, err: e.response?.data?.error?.message || e.message }, '[IG] profile fetch failed');
        }
        await prisma.instagramContact.upsert({
            where: { igUserId_senderId: { igUserId, senderId } },
            update: {
                ...(profile.username ? { username: profile.username } : {}),
                ...(profile.name ? { name: profile.name } : {}),
                ...(profile.profile_pic ? { profilePic: profile.profile_pic } : {}),
                lastMessageAt: new Date()
            },
            create: {
                igUserId, senderId,
                username: profile.username || null,
                name: profile.name || null,
                profilePic: profile.profile_pic || null,
                lastMessageAt: new Date()
            }
        });
    } catch (e: any) {
        logger.warn({ err: e.message }, '[IG] cacheIgContact failed');
    }
}

// Instagram DM hard limit is 1000 chars. Keep a small safety margin.
const IG_MAX_MESSAGE = 950;

function truncateForIg(text: string): string {
    if (!text || text.length <= IG_MAX_MESSAGE) return text;
    return text.slice(0, IG_MAX_MESSAGE - 1) + '…';
}

// ─── Send Instagram DM ───
export async function sendIgMessage(igUserId: string, recipientId: string, text: string, accessToken: string) {
    const safe = truncateForIg(text);
    try {
        await axios.post(`https://graph.instagram.com/v21.0/${igUserId}/messages`, {
            recipient: { id: recipientId },
            message: { text: safe }
        }, {
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
    } catch (err: any) {
        const ig = err.response?.data?.error;
        logger.error({
            status: err.response?.status,
            ig_message: ig?.message,
            ig_code: ig?.code,
            ig_subcode: ig?.error_subcode,
            ig_user_msg: ig?.error_user_msg,
            text_length: safe.length
        }, '[IG] sendIgMessage failed');
        throw err;
    }
}

// ─── Send rich Instagram DM (attachment / template / text+quick replies) ───
// Instagram Graph API DM message shapes:
//   text + quick replies:   { message: { text, quick_replies: [{ content_type:'text', title, payload }] } }
//   media attachment:       { message: { attachment: { type:'image|video|audio', payload:{ url, is_reusable:true } } } }
//   generic template:       { message: { attachment: { type:'template', payload:{ template_type:'generic', elements:[...] } } } }
export async function sendIgRichMessage(
    igUserId: string,
    recipientId: string,
    payload: RichDmPayload,
    accessToken: string
) {
    const quickReplies = (payload as any).quickReplies as { title: string; payload?: string }[] | undefined;
    let message: any;
    if (payload.kind === 'attachment') {
        message = { attachment: { type: payload.attachmentType, payload: { url: payload.url, is_reusable: true } } };
        if (quickReplies && quickReplies.length) {
            message.quick_replies = quickReplies.slice(0, 13).map(r => ({
                content_type: 'text', title: r.title.slice(0, 20), payload: r.payload || r.title
            }));
        }
    } else if (payload.kind === 'template') {
        message = { attachment: { type: 'template', payload: { template_type: 'generic', elements: payload.elements.slice(0, 10) } } };
    } else {
        const safe = truncateForIg(payload.text || '');
        if (!safe) return;
        message = { text: safe };
        if (quickReplies && quickReplies.length) {
            message.quick_replies = quickReplies.slice(0, 13).map(r => ({
                content_type: 'text', title: r.title.slice(0, 20), payload: r.payload || r.title
            }));
        }
    }
    try {
        await axios.post(`https://graph.instagram.com/v21.0/${igUserId}/messages`, {
            recipient: { id: recipientId },
            message,
        }, {
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
    } catch (err: any) {
        const ig = err.response?.data?.error;
        logger.error({
            status: err.response?.status,
            ig_message: ig?.message,
            ig_code: ig?.code,
            ig_subcode: ig?.error_subcode,
            ig_user_msg: ig?.error_user_msg,
            payload_kind: payload.kind,
        }, '[IG] sendIgRichMessage failed');
        throw err;
    }
}

// ─── Reply to Instagram Comment ───
async function replyToComment(commentId: string, text: string, accessToken: string) {
    const safe = truncateForIg(text);
    try {
        await axios.post(`https://graph.instagram.com/v21.0/${commentId}/replies`, {
            message: safe
        }, {
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
    } catch (err: any) {
        const ig = err.response?.data?.error;
        logger.error({
            status: err.response?.status,
            ig_message: ig?.message,
            ig_code: ig?.code,
            ig_subcode: ig?.error_subcode,
            ig_user_msg: ig?.error_user_msg,
            text_length: safe.length
        }, '[IG] replyToComment failed');
        throw err;
    }
}

export class InstagramAiService {
    // ─── Handle DM ───
    static async handleDm(igUserId: string, senderId: string, messageText: string, opts?: {
        imageUrl?: string | null;
        audioUrl?: string | null;
        referral?: any;
    }) {
        const account = await prisma.instagramAccount.findUnique({
            where: { igUserId },
            include: { agent: { include: { provider: true } } }
        });

        if (!account) return;

        // Realtime push for the inbox — mirror what WhatsApp emits on
        // inbound so the open chat repaints without a manual refresh.
        // Runs early so even messages that later match an automation
        // still surface in the UI.
        try {
            const { io: ioSrv } = await import('../../server');
            ioSrv.emit(`message.new-${account.id}`, {
                id: `ig-in-${Date.now()}`,
                isFromMe: false,
                content: messageText,
                remoteJid: `ig:${senderId}`,
                messageType: 'text',
                status: 'DELIVERED',
                timestamp: new Date().toISOString(),
            });
        } catch { /* best-effort */ }

        // Cache the sender's profile regardless of whether an agent replies
        await cacheIgContact(igUserId, senderId, account.accessToken);

        // Run automations first — if one matches, skip the default agent reply
        const priorCount = await prisma.aiConversationLog.count({ where: { remoteJid: `ig:${senderId}` } });
        const contact = await prisma.instagramContact.findUnique({
            where: { igUserId_senderId: { igUserId, senderId } }
        }).catch(() => null);

        // Auto-add the sender to CRM with channel info. IG accounts that
        // pre-date the workspace migration have workspaceId set by the
        // migration runner; if still missing, fall back to the owner's
        // personal workspace.
        const wsId = account.workspaceId || (await import('../../lib/workspace-migration')).getOrCreatePersonalWorkspace(account.userId);
        const accountWorkspaceId = typeof wsId === 'string' ? wsId : await wsId;
        // Ad attribution: when the DM came from a click-to-Instagram
        // ad, Meta ships referral metadata alongside message. Same
        // AdRoute matching engine as WhatsApp — the referral is
        // converted to the internal shape and passed to
        // upsertCrmContact so first-touch attribution lands + agent
        // routing rules fire on the very first message.
        const adRef = opts?.referral ? extractIgReferrer({ referral: opts.referral }) : null;
        await upsertCrmContact({
            userId: account.userId,
            workspaceId: accountWorkspaceId,
            phone: senderId,
            name: contact?.name || contact?.username || null,
            channel: 'instagram',
            sourceLabel: account.igUsername ? '@' + account.igUsername : null,
            adReferrer: adRef,
        });
        const { matched, overrideAgentId } = await AutomationEngine.handleMessage({
            userId: account.userId,
            workspaceId: accountWorkspaceId || undefined,
            channel: 'instagram',
            text: messageText,
            contactId: senderId,
            contactName: contact?.name || contact?.username || undefined,
            contactUsername: contact?.username || undefined,
            isNewContact: priorCount === 0,
            source: 'dm',
            accountId: account.id,
            igUserId,
            sendMessage: (t) => sendIgMessage(igUserId, senderId, t, account.accessToken),
            sendMedia: async (p: MediaPayload) => {
                if (p.kind === 'document') {
                    // Instagram doesn't support documents — fall back to a text link
                    if (p.url) await sendIgMessage(igUserId, senderId, p.caption ? `${p.caption}\n${p.url}` : p.url, account.accessToken);
                    return;
                }
                await sendIgRichMessage(igUserId, senderId, {
                    kind: 'attachment',
                    attachmentType: p.kind,
                    url: p.url,
                }, account.accessToken);
                if (p.caption) await sendIgMessage(igUserId, senderId, p.caption, account.accessToken);
            },
            sendDm: (p) => sendIgRichMessage(igUserId, senderId, p, account.accessToken),
            // runAgent is intentionally omitted — the engine intercepts
            // action_ai_reply into `overrideAgentId`, which the outer
            // flow reads below to swap in the picked agent for the
            // reply.
            addTag: async (tag) => {
                const existing = await prisma.client.findUnique({
                    where: { userId_phone: { userId: account.userId, phone: senderId } }
                }).catch(() => null);
                const tags = Array.from(new Set([...(existing?.tags || []), tag]));
                await prisma.client.upsert({
                    where: { userId_phone: { userId: account.userId, phone: senderId } },
                    update: { tags },
                    create: { userId: account.userId, phone: senderId, tags, status: 'NEW' }
                });
            },
            setUserField: async (key, value) => {
                const existing = await prisma.client.findUnique({
                    where: { userId_phone: { userId: account.userId, phone: senderId } }
                }).catch(() => null);
                const merged = { ...((existing?.customFields as Record<string, any>) || {}), [key]: value };
                await prisma.client.upsert({
                    where: { userId_phone: { userId: account.userId, phone: senderId } },
                    update: { customFields: merged },
                    create: { userId: account.userId, phone: senderId, status: 'NEW', tags: [], customFields: merged }
                });
            }
        });
        // Automation matched but requested a specific agent — swap in
        // and continue the reply flow with it. Otherwise, matched means
        // the automation handled the reply itself.
        if (matched && !overrideAgentId) {
            logger.info(`[IG] DM from ${senderId} handled by automation`);
            return;
        }

        // Resolve the agent for this reply. Override wins over the
        // account's default agent so action_ai_reply can pick any agent
        // regardless of what the IG account is bound to.
        let resolvedAgent: any = null;
        if (overrideAgentId) {
            resolvedAgent = await prisma.agent.findUnique({
                where: { id: overrideAgentId },
                include: { provider: true },
            });
            if (!resolvedAgent?.provider) {
                logger.warn({ agentId: overrideAgentId }, '[IG] override agent not found or missing provider');
                return;
            }
        } else {
            if (!account.agent?.provider || !account.isActive || !(account.agent as any).isActive) return;
            resolvedAgent = account.agent;
        }

        // Per-contact pause: agent stops replying to this contact until
        // un-paused. Incoming messages remain in the conversation log so
        // memory tools still see the full history when resumed.
        const pausedClient = await prisma.client.findFirst({
            where: { workspaceId: accountWorkspaceId, phone: senderId },
            select: { agentPaused: true },
        }).catch(() => null);
        if (pausedClient?.agentPaused) {
            logger.info(`[IG] Agent paused for ${senderId} — skipping reply`);
            return;
        }

        const agent = resolvedAgent;

        // Voice-to-text: when the DM was an audio note AND the agent
        // has audioEnabled, transcribe via Whisper and replace the
        // model input so the agent responds to what was actually said
        // instead of a generic '🎤 Audio' placeholder. Best-effort:
        // falls through to the original text on failure.
        let finalMessageText = messageText;
        if (opts?.audioUrl && (agent as any).audioEnabled) {
            try {
                const { transcribeAudioUrl } = await import('../agent/whisper.service');
                const r = await transcribeAudioUrl({
                    workspaceId: accountWorkspaceId,
                    mediaUrl: opts.audioUrl,
                    mimetype: 'audio/mp4',
                    language: (agent as any).whisperLanguage || null,
                    model: (agent as any).whisperModel || null,
                });
                if (r?.text) finalMessageText = r.text;
            } catch (e: any) {
                logger.warn({ err: e?.message }, '[IG whisper] transcription failed');
            }
        }

        const t0 = Date.now();
        const { text, usage } = await this.generateResponse(agent, account.userId, senderId, finalMessageText, 'dm', {
            igUserId, accessToken: account.accessToken, workspaceId: accountWorkspaceId, accountId: account.id,
            imageUrl: opts?.imageUrl || null,
        });
        const durationMs = Date.now() - t0;
        if (!text) return;

        await sendIgMessage(igUserId, senderId, text, account.accessToken);

        // Realtime push so the inbox chat repaints without a reload.
        // Matches the message.new-{id} shape the WhatsApp path emits;
        // the id here is the IG account row id.
        try {
            const { io: ioSrv } = await import('../../server');
            ioSrv.emit(`message.new-${account.id}`, {
                id: `ig-out-${Date.now()}`,
                isFromMe: true,
                content: text,
                remoteJid: `ig:${senderId}`,
                messageType: 'text',
                status: 'SENT',
                timestamp: new Date().toISOString(),
            });
        } catch { /* best-effort UI nudge */ }

        // Log conversation
        await prisma.aiConversationLog.create({
            data: {
                agentId: agent.id,
                instanceId: account.id, // reuse field for IG account
                remoteJid: `ig:${senderId}`,
                userMessage: messageText,
                agentReply: text,
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                totalTokens: usage.totalTokens,
                cachedTokens: usage.cachedTokens,
                cacheCreationTokens: usage.cacheCreationTokens,
                provider: agent.provider.provider,
                model: agent.model,
                toolCalls: [],
            }
        });

        // Activity tab log (3-day retention). IG flow doesn't currently
        // surface tool calls, but the user message / reply / duration are
        // still useful for inspection.
        prisma.agentActivityLog.create({
            data: {
                agentId: agent.id, workspaceId: accountWorkspaceId,
                instanceId: account.id, remoteJid: `ig:${senderId}`,
                contactPhone: senderId, contactName: null,
                channel: 'instagram',
                userMessage: messageText, agentReply: text,
                toolCalls: [], durationMs,
            }
        }).catch(err => logger.warn({ err: err.message }, `[IG] AgentActivityLog write failed`));

        logger.info(`[IG] Agent replied to DM from ${senderId}`);
    }

    // ─── Handle Comment ───
    static async handleComment(igUserId: string, commentId: string, commentText: string, from: any, mediaId: string) {
        const account = await prisma.instagramAccount.findUnique({
            where: { igUserId },
            include: { agent: { include: { provider: true } } }
        });

        if (!account) return;

        // Best-effort: fetch the post's permalink so {{post_url}} works in actions.
        let permalink: string | undefined;
        if (mediaId) {
            try {
                const r = await axios.get(`https://graph.instagram.com/v21.0/${mediaId}`, {
                    params: { fields: 'permalink', access_token: account.accessToken }
                });
                permalink = r.data?.permalink;
            } catch (e: any) {
                logger.warn({ err: e.response?.data?.error?.message || e.message }, '[IG] permalink fetch failed');
            }
        }

        // Comment-to-DM uses recipient.comment_id to bypass the 24-hour messaging window.
        // The commenter receives a DM tied to that comment.
        const sendDmFromComment = async (p: RichDmPayload) => {
            const quickReplies = (p as any).quickReplies as { title: string; payload?: string }[] | undefined;
            let message: any;
            if (p.kind === 'attachment') {
                message = { attachment: { type: p.attachmentType, payload: { url: p.url, is_reusable: true } } };
                if (quickReplies?.length) {
                    message.quick_replies = quickReplies.slice(0, 13).map(r => ({ content_type: 'text', title: r.title.slice(0, 20), payload: r.payload || r.title }));
                }
            } else if (p.kind === 'template') {
                message = { attachment: { type: 'template', payload: { template_type: 'generic', elements: p.elements.slice(0, 10) } } };
            } else {
                const safe = truncateForIg(p.text || '');
                if (!safe) return;
                message = { text: safe };
                if (quickReplies?.length) {
                    message.quick_replies = quickReplies.slice(0, 13).map(r => ({ content_type: 'text', title: r.title.slice(0, 20), payload: r.payload || r.title }));
                }
            }
            try {
                await axios.post(`https://graph.instagram.com/v21.0/${igUserId}/messages`, {
                    recipient: { comment_id: commentId },
                    message,
                }, { headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' } });
            } catch (err: any) {
                const ig = err.response?.data?.error;
                logger.error({
                    status: err.response?.status,
                    ig_message: ig?.message,
                    ig_code: ig?.code,
                    ig_subcode: ig?.error_subcode,
                    ig_user_msg: ig?.error_user_msg,
                    payload_kind: p.kind,
                }, '[IG] sendDmFromComment failed');
                // Fall back to regular IGSID DM in case the comment_id flow is unavailable for this account
                try {
                    await sendIgRichMessage(igUserId, from.id, p, account.accessToken);
                } catch { /* already logged */ }
            }
        };

        // Persist the raw comment before we touch anything else so
        // the Comments tab in the inbox has the row even if automation
        // errors out. `status` starts at PENDING and gets bumped by
        // whoever eventually replies (automation or a manual operator
        // action from the inbox).
        try {
            await prisma.instagramComment.upsert({
                where: { commentId },
                update: { text: commentText, mediaId: mediaId || null, mediaPermalink: permalink || null, fromUsername: from.username || null },
                create: {
                    igAccountId: account.id,
                    workspaceId: account.workspaceId,
                    commentId,
                    mediaId: mediaId || null,
                    mediaPermalink: permalink || null,
                    fromId: from.id,
                    fromUsername: from.username || null,
                    text: commentText,
                    status: 'PENDING',
                },
            });
        } catch (e: any) {
            logger.warn({ err: e.message, commentId }, '[IG] persisting comment failed');
        }

        // If the commenter has DMed us before, we already have their
        // display name cached. Otherwise Meta's webhook only gives the
        // @handle and {{name}} falls back to it via interpolate.
        const cachedContact = await prisma.instagramContact.findUnique({
            where: { igUserId_senderId: { igUserId, senderId: from.id } },
            select: { name: true },
        }).catch(() => null);

        // Run the Automation engine. If a rule matches we mark the
        // stored comment AUTOMATION_MATCHED so the inbox knows it's
        // been handled.
        const { matched, overrideAgentId } = await AutomationEngine.handleMessage({
            userId: account.userId,
            workspaceId: account.workspaceId || undefined,
            channel: 'instagram',
            text: commentText,
            contactId: from.id,
            contactName: cachedContact?.name || undefined,
            contactUsername: from.username || undefined,
            source: 'comment',
            accountId: account.id,
            igUserId,
            mediaId,
            permalink,
            commentId,
            sendMessage: (t) => replyToComment(commentId, t, account.accessToken),
            sendMedia: async (p: MediaPayload) => {
                if (p.kind === 'document') {
                    if (p.url) await sendDmFromComment({ kind: 'text', text: p.caption ? `${p.caption}\n${p.url}` : p.url });
                    return;
                }
                await sendDmFromComment({ kind: 'attachment', attachmentType: p.kind, url: p.url });
                if (p.caption) await sendDmFromComment({ kind: 'text', text: p.caption });
            },
            sendDm: sendDmFromComment,
            replyComment: (t) => replyToComment(commentId, t, account.accessToken),
            hideComment: async () => {
                try {
                    await axios.post(`https://graph.instagram.com/v21.0/${commentId}`,
                        'hide=true',
                        { headers: { 'Authorization': `Bearer ${account.accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' } });
                    await prisma.instagramComment.update({ where: { commentId }, data: { status: 'AUTOMATION_MATCHED', repliedAt: new Date() } }).catch(() => {});
                    logger.info({ commentId }, '[IG] comment hidden by automation');
                } catch (e: any) {
                    logger.warn({ err: e?.response?.data?.error?.message || e?.message, commentId }, '[IG] hideComment failed');
                }
            },
            deleteComment: async () => {
                try {
                    await axios.delete(`https://graph.instagram.com/v21.0/${commentId}`, {
                        headers: { 'Authorization': `Bearer ${account.accessToken}` },
                    });
                    await prisma.instagramComment.delete({ where: { commentId } }).catch(() => {});
                    logger.info({ commentId }, '[IG] comment deleted by automation');
                } catch (e: any) {
                    logger.warn({ err: e?.response?.data?.error?.message || e?.message, commentId }, '[IG] deleteComment failed');
                }
            },
        });
        if (matched) {
            // If the automation asked an agent to answer, run it here
            // and route the reply through the comment→DM channel so the
            // commenter gets a private message instead of a public reply.
            if (overrideAgentId) {
                try {
                    const ag = await prisma.agent.findUnique({
                        where: { id: overrideAgentId },
                        include: { provider: true },
                    });
                    if (ag?.provider) {
                        const r = await this.generateResponse(ag, account.userId, from.id, commentText, 'dm', {
                            igUserId, accessToken: account.accessToken, workspaceId: account.workspaceId, accountId: account.id,
                        });
                        if (r.text) await sendDmFromComment({ kind: 'text', text: r.text });
                    } else {
                        logger.warn({ agentId: overrideAgentId }, '[IG] comment override agent missing');
                    }
                } catch (e: any) {
                    logger.warn({ err: e?.message, commentId, agentId: overrideAgentId }, '[IG] comment agent reply failed');
                }
            }
            await prisma.instagramComment.update({
                where: { commentId },
                data: { status: 'AUTOMATION_MATCHED', repliedAt: new Date() },
            }).catch(() => {});
            logger.info(`[IG] Comment ${commentId} handled by automation`);
            return;
        }

        // No automation matched. The IG agent is now DM-only by
        // product design — comments stay PENDING and wait for either
        // the operator to reply from the inbox Comments tab or an
        // automation rule to be added. Comments-tab UI displays the
        // full backlog so nothing is silently lost.
        logger.info(`[IG] Comment ${commentId} from @${from.username} left pending — no automation matched, agent won't auto-reply on comments.`);
    }

    // ─── Shared AI generation ───
    private static async generateResponse(
        agent: any,
        userId: string,
        contactId: string,
        messageText: string,
        type: 'dm' | 'comment',
        opts?: { igUserId?: string; accessToken?: string; workspaceId?: string; accountId?: string; imageUrl?: string | null }
    ): Promise<{ text: string | null; usage: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number; cacheCreationTokens: number } }> {
        const providerInfo = agent.provider;
        let aiModel: any;
        if (providerInfo.provider === 'OPENAI') {
            aiModel = createOpenAI({ apiKey: providerInfo.apiKey } as any).chat(agent.model);
        } else if (providerInfo.provider === 'CLAUDE') {
            aiModel = createAnthropic({ apiKey: providerInfo.apiKey })(agent.model);
        } else if (providerInfo.provider === 'GEMINI') {
            aiModel = createGoogleGenerativeAI({ apiKey: providerInfo.apiKey })(agent.model);
        } else if (providerInfo.provider === 'GLM') {
            aiModel = createOpenAI({ apiKey: providerInfo.apiKey, baseURL: 'https://api.z.ai/api/paas/v4/' } as any).chat(agent.model);
        } else {
            return { text: null, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0, cacheCreationTokens: 0 } };
        }

        const skills: string[] = agent.skills || [];
        const remoteJid = `ig:${contactId}`;
        const httpTools = ((agent.httpTools as any) || []) as HttpToolTemplate[];
        const skillPrompts = (agent.skillPrompts || {}) as Record<string, string>;
        const workspaceId = opts?.workspaceId || agent.workspaceId || '';

        // Universal skill builder — same one WhatsApp uses. IG plugs
        // in its own poll implementation (quick_replies) via the
        // channelOverrides hook so agents don't need to know they're
        // on IG vs WA.
        const pollsOverride = (skills.includes('polls') && opts?.igUserId && opts?.accessToken)
            ? buildIgPollsTool(opts.igUserId, contactId, opts.accessToken)
            : undefined;

        const { tools: skillTools, skillPrompt } = buildToolsForSkills(
            skills, agent.allowedTableIds || [], userId, workspaceId, httpTools,
            agent.id, remoteJid, skillPrompts,
            opts?.accountId || '', null,
            pollsOverride ? { pollsTools: pollsOverride } : undefined,
        );
        const tools = skillTools || {};

        // Operator directives: pull the unconsumed "Talk to agent"
        // panel steering notes for this contact so IG replies apply
        // them too. Same shape as the WhatsApp handler.
        let directivesBlock = '';
        let activeDirectives: any[] = [];
        if (workspaceId) {
            const client = await prisma.client.findFirst({
                where: { workspaceId, phone: contactId },
                select: { id: true },
            }).catch(() => null);
            if (client?.id) {
                activeDirectives = await prisma.operatorDirective.findMany({
                    where: { clientId: client.id, agentId: agent.id, consumedAt: null },
                    orderBy: { createdAt: 'asc' },
                    take: 20,
                }).catch(() => []);
                if (activeDirectives.length > 0) {
                    directivesBlock = `\n\n📌 OPERATOR DIRECTIVES (live instructions from the human operator handling this conversation — these OVERRIDE any conflicting style or behavior in your base instructions):\n${activeDirectives.map(d => `- ${d.text}`).join('\n')}`;
                }
            }
        }

        const platformNote = type === 'dm'
            ? 'You are responding to an Instagram Direct Message. Your reply MUST be under 900 characters. If tool output is large, summarize the key items briefly instead of pasting raw JSON.'
            : 'You are responding to an Instagram comment on a post. Your reply MUST be under 900 characters and concise.';

        const systemPrompt = (agent.systemPrompt || 'You are a helpful assistant.') +
            `\n\n${platformNote}\nContact ID: ${contactId}` +
            skillPrompt +
            directivesBlock;

        const hasTools = Object.keys(tools).length > 0;

        // Build conversation history (short window — agent uses memory tools for older context)
        const historyDepth = skills.includes('memory') ? 3 : 10;
        const priorLogs = await prisma.aiConversationLog.findMany({
            where: { agentId: agent.id, remoteJid },
            orderBy: { createdAt: 'desc' },
            take: historyDepth,
            select: { userMessage: true, agentReply: true }
        });
        priorLogs.reverse();

        const messages: any[] = [];
        for (const log of priorLogs) {
            if (log.userMessage) messages.push({ role: 'user', content: log.userMessage });
            if (log.agentReply) messages.push({ role: 'assistant', content: log.agentReply });
        }
        // Vision: when the agent has visionEnabled and the DM arrived
        // with an image attachment, ship the image as a native content
        // part on the final user turn. Older turns stay as plain text
        // (Meta doesn't hand us stable historical media URLs anyway).
        const visionOn = !!(agent as any).visionEnabled;
        if (visionOn && opts?.imageUrl) {
            try {
                messages.push({
                    role: 'user',
                    content: [
                        { type: 'text', text: messageText },
                        { type: 'image', image: new URL(opts.imageUrl) },
                    ],
                });
            } catch {
                // Malformed URL — fall back to text-only so we still respond.
                messages.push({ role: 'user', content: messageText });
            }
        } else {
            messages.push({ role: 'user', content: messageText });
        }

        const result = await generateText({
            model: aiModel,
            system: systemPrompt,
            messages: applyAnthropicCacheControl(providerInfo.provider, messages),
            ...(hasTools ? { tools, stopWhen: stepCountIs(5) } : {}),
        } as any);

        // Directive bookkeeping — mirrors what WhatsApp's
        // handleIncomingMessage does. One-shot directives get their
        // consumedAt stamped; persistent ones drop only their
        // triggerNow flag so they keep steering future turns.
        if (activeDirectives.length > 0) {
            const consumeIds = activeDirectives.filter(d => !d.persistent).map(d => d.id);
            if (consumeIds.length > 0) {
                await prisma.operatorDirective.updateMany({
                    where: { id: { in: consumeIds } },
                    data: { consumedAt: new Date(), triggerNow: false },
                }).catch(() => {});
            }
            const clearTriggerOnly = activeDirectives
                .filter(d => d.persistent && d.triggerNow)
                .map(d => d.id);
            if (clearTriggerOnly.length > 0) {
                await prisma.operatorDirective.updateMany({
                    where: { id: { in: clearTriggerOnly } },
                    data: { triggerNow: false },
                }).catch(() => {});
            }
        }

        const cache = extractCacheUsage(providerInfo.provider, result);
        const usage = (result as any).usage || {};
        return {
            text: result.text || null,
            usage: {
                promptTokens: usage.inputTokens || 0,
                completionTokens: usage.outputTokens || 0,
                totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
                cachedTokens: cache.cachedTokens,
                cacheCreationTokens: cache.cacheCreationTokens
            }
        };
    }
}

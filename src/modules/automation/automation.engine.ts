import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

type Channel = 'whatsapp' | 'instagram';

export type IgAttachmentType = 'image' | 'video' | 'audio';
export type IgQuickReply = { title: string; payload?: string };
export type IgTemplateButton =
    | { type: 'web_url'; title: string; url: string }
    | { type: 'postback'; title: string; payload: string };
export type IgTemplateElement = {
    title: string;
    subtitle?: string;
    image_url?: string;
    default_action?: { type: 'web_url'; url: string };
    buttons?: IgTemplateButton[];
};

export type RichDmPayload =
    | { kind: 'text'; text: string; quickReplies?: IgQuickReply[] }
    | { kind: 'attachment'; attachmentType: IgAttachmentType; url: string; quickReplies?: IgQuickReply[] }
    | { kind: 'template'; elements: IgTemplateElement[] };

export type MediaKind = 'image' | 'video' | 'audio' | 'document';
export type MediaPayload = {
    kind: MediaKind;
    url: string;
    caption?: string;
    filename?: string;   // document only
    mimetype?: string;   // optional override
};

export type AutomationContext = {
    userId: string;
    channel: Channel;
    text: string;
    contactId: string;        // remoteJid (WhatsApp) or IGSID (Instagram)
    contactName?: string;
    isNewContact?: boolean;
    source?: 'dm' | 'comment';
    // Instagram-only context
    accountId?: string;       // alChatBot InstagramAccount.id (the connected biz account)
    igUserId?: string;        // raw IG user id of the business account
    mediaId?: string;         // the post id (only set for comment events)
    permalink?: string;       // post URL (only set for comment events)
    commentId?: string;       // the comment id (only set for comment events)
    // callbacks supplied by the channel handler
    sendMessage: (text: string) => Promise<void>;
    sendMedia?: (payload: MediaPayload) => Promise<void>;
    sendDm?: (payload: RichDmPayload) => Promise<void>;
    replyComment?: (text: string) => Promise<void>;
    runAgent?: (agentId: string) => Promise<void>;
    addTag?: (tag: string) => Promise<void>;
};

function norm(s: string, caseSensitive: boolean): string {
    return caseSensitive ? s : s.toLowerCase();
}

function keywordMatches(data: any, text: string): boolean {
    const keywords = String(data.keywords || '')
        .split(',').map((k: string) => k.trim()).filter(Boolean);
    if (keywords.length === 0) return false;
    const cs = !!data.caseSensitive;
    const msg = norm(text || '', cs);
    return keywords.some((kw: string) => {
        const k = norm(kw, cs);
        switch (data.matchMode) {
            case 'exact': return msg.trim() === k;
            case 'starts': return msg.trimStart().startsWith(k);
            case 'regex':
                try { return new RegExp(kw, cs ? '' : 'i').test(text || ''); } catch { return false; }
            default: return msg.includes(k); // contains
        }
    });
}

function channelOk(data: any, channel: Channel): boolean {
    const c = data?.channel || 'any';
    return c === 'any' || c === channel;
}

function triggerMatches(node: any, ctx: AutomationContext): boolean {
    const d = node.data || {};
    switch (node.type) {
        case 'trigger_keyword':
            return ctx.source !== 'comment' && channelOk(d, ctx.channel) && keywordMatches(d, ctx.text);
        case 'trigger_any_message':
            return ctx.source !== 'comment' && channelOk(d, ctx.channel);
        case 'trigger_new_contact':
            return ctx.source !== 'comment' && channelOk(d, ctx.channel) && !!ctx.isNewContact;
        case 'trigger_comment': {
            if (ctx.channel !== 'instagram' || ctx.source !== 'comment') return false;
            // Optional Instagram account filter
            if (d.accountId && d.accountId !== ctx.accountId) return false;
            // Optional post filter — empty / 'any' means "any post"
            const postId = String(d.mediaId || d.postId || '').trim();
            if (postId && postId !== 'any' && postId !== ctx.mediaId) return false;
            return String(d.keywords || '').trim() === '' || keywordMatches(d, ctx.text);
        }
        default:
            return false;
    }
}

function interpolate(text: string, ctx: AutomationContext): string {
    return (text || '')
        .replace(/\{\{\s*name\s*\}\}/gi, ctx.contactName || '')
        .replace(/\{\{\s*username\s*\}\}/gi, ctx.contactName || '')
        .replace(/\{\{\s*message\s*\}\}/gi, ctx.text || '')
        .replace(/\{\{\s*comment\s*\}\}/gi, ctx.text || '')
        .replace(/\{\{\s*post_url\s*\}\}/gi, ctx.permalink || '');
}

function interpolateRich(payload: any, ctx: AutomationContext): RichDmPayload {
    const kind = String(payload?.kind || 'text');
    const qr = Array.isArray(payload?.quickReplies)
        ? payload.quickReplies
            .map((r: any) => ({ title: interpolate(String(r?.title || ''), ctx), payload: r?.payload ? String(r.payload) : undefined }))
            .filter((r: any) => r.title)
        : undefined;
    if (kind === 'attachment') {
        return {
            kind: 'attachment',
            attachmentType: (payload.attachmentType || 'image') as IgAttachmentType,
            url: interpolate(String(payload.url || ''), ctx),
            quickReplies: qr,
        };
    }
    if (kind === 'template') {
        const elements: IgTemplateElement[] = Array.isArray(payload.elements) ? payload.elements.map((el: any) => ({
            title: interpolate(String(el?.title || ''), ctx),
            subtitle: el?.subtitle ? interpolate(String(el.subtitle), ctx) : undefined,
            image_url: el?.image_url ? interpolate(String(el.image_url), ctx) : undefined,
            default_action: el?.default_action?.url ? { type: 'web_url', url: interpolate(String(el.default_action.url), ctx) } : undefined,
            buttons: Array.isArray(el?.buttons) ? el.buttons.map((b: any) => {
                if (b?.type === 'postback') return { type: 'postback', title: interpolate(String(b.title || ''), ctx), payload: String(b.payload || '') };
                return { type: 'web_url', title: interpolate(String(b?.title || ''), ctx), url: interpolate(String(b?.url || ''), ctx) };
            }).filter((b: any) => b.title && (b.url || b.payload)) : undefined,
        })) : [];
        return { kind: 'template', elements };
    }
    return { kind: 'text', text: interpolate(String(payload?.text || ''), ctx), quickReplies: qr };
}

async function executeNode(node: any, ctx: AutomationContext): Promise<boolean> {
    const d = node.data || {};
    switch (node.type) {
        case 'action_send_message':
            if (d.text) await ctx.sendMessage(interpolate(String(d.text), ctx));
            return true;
        case 'action_send_media': {
            if (!ctx.sendMedia) return true;
            const url = interpolate(String(d.url || ''), ctx);
            if (!url) return true;
            await ctx.sendMedia({
                kind: (d.mediaKind || 'image') as MediaKind,
                url,
                caption: d.caption ? interpolate(String(d.caption), ctx) : undefined,
                filename: d.filename ? interpolate(String(d.filename), ctx) : undefined,
                mimetype: d.mimetype || undefined,
            });
            return true;
        }
        case 'action_send_dm': {
            // Rich Instagram DM (text + quick replies, attachment, or template).
            // Falls back to sendMessage if the channel didn't supply a rich handler.
            const payload = interpolateRich(d, ctx);
            if (ctx.sendDm) {
                await ctx.sendDm(payload);
            } else if (payload.kind === 'text' && payload.text) {
                await ctx.sendMessage(payload.text);
            }
            return true;
        }
        case 'action_reply_comment': {
            if (!ctx.replyComment || !d.text) return true;
            await ctx.replyComment(interpolate(String(d.text), ctx));
            return true;
        }
        case 'action_ai_reply':
            if (d.agentId && ctx.runAgent) await ctx.runAgent(String(d.agentId));
            return true;
        case 'action_add_tag':
            if (d.tag && ctx.addTag) await ctx.addTag(String(d.tag));
            return true;
        case 'action_wait': {
            const secs = Math.min(Math.max(Number(d.seconds) || 0, 0), 120);
            if (secs > 0) await new Promise(r => setTimeout(r, secs * 1000));
            return true;
        }
        case 'condition': {
            let subject = '';
            if (d.field === 'message') {
                subject = ctx.text || '';
            } else if (d.field === 'tag' || d.field === 'status') {
                const phone = ctx.contactId.replace(/[^0-9]/g, '') || ctx.contactId;
                const client = await prisma.client.findFirst({
                    where: { userId: ctx.userId, phone }
                }).catch(() => null);
                subject = d.field === 'status' ? (client?.status || '') : (client?.tags || []).join(',');
            }
            const a = subject.toLowerCase();
            const b = String(d.value || '').toLowerCase();
            if (d.operator === 'equals') return a === b;
            if (d.operator === 'not_equals') return a !== b;
            return a.includes(b); // contains
        }
        default:
            return true;
    }
}

async function runGraph(triggerId: string, nodes: any[], edges: any[], ctx: AutomationContext) {
    const byId: Record<string, any> = {};
    for (const n of nodes) byId[n.id] = n;
    const outgoing = (id: string, handle?: string) =>
        edges.filter(e => e.source === id && (handle === undefined || (e.sourceHandle || null) === handle));

    let queue: string[] = outgoing(triggerId).map(e => e.target);
    const visited = new Set<string>();
    let steps = 0;
    while (queue.length && steps < 100) {
        steps++;
        const nid = queue.shift()!;
        if (visited.has(nid)) continue;
        visited.add(nid);
        const node = byId[nid];
        if (!node) continue;
        const result = await executeNode(node, ctx);
        if (node.type === 'condition') {
            queue.push(...outgoing(nid, result ? 'true' : 'false').map(e => e.target));
        } else {
            queue.push(...outgoing(nid).map(e => e.target));
        }
    }
}

export class AutomationEngine {
    // Returns { matched } — if matched, the channel handler should skip its
    // default AI-agent reply to avoid double responses.
    static async handleMessage(ctx: AutomationContext): Promise<{ matched: boolean }> {
        try {
            const automations = await prisma.automation.findMany({
                where: { userId: ctx.userId, isActive: true }
            });
            let matched = false;
            for (const auto of automations) {
                const nodes = (auto.nodes as any[]) || [];
                const edges = (auto.edges as any[]) || [];
                for (const node of nodes) {
                    if (typeof node?.type !== 'string' || !node.type.startsWith('trigger_')) continue;
                    if (!triggerMatches(node, ctx)) continue;
                    matched = true;
                    logger.info({ automation: auto.name, trigger: node.type }, '[Automation] trigger matched');
                    await runGraph(node.id, nodes, edges, ctx);
                }
            }
            return { matched };
        } catch (e: any) {
            logger.error({ err: e.message }, '[Automation] engine error');
            return { matched: false };
        }
    }
}

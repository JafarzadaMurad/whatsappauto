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
    contactName?: string;     // display name — WhatsApp pushName / IG profile name
    contactUsername?: string; // @handle on Instagram; on WhatsApp usually undefined
    isNewContact?: boolean;
    // Per-run variable bag. action_http_request stashes its parsed
    // response here under the operator-picked key; downstream nodes
    // reference values via {{key}} or dotted paths like {{key.data.name}}.
    // Populated by the engine on entry; nodes may push into it.
    vars?: Record<string, any>;
    source?: 'dm' | 'comment';
    // Channel-specific context
    instanceId?: string;      // alChatBot WhatsAppInstance.id (which WA number received the msg)
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
    hideComment?: () => Promise<void>;
    deleteComment?: () => Promise<void>;
    runAgent?: (agentId: string) => Promise<void>;
    addTag?: (tag: string) => Promise<void>;
    setUserField?: (key: string, value: unknown) => Promise<void>;
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
        // ─── Legacy / generic (still recognized for backward compat) ───
        case 'trigger_keyword':
            return ctx.source !== 'comment' && channelOk(d, ctx.channel) && keywordMatches(d, ctx.text);
        case 'trigger_any_message':
            return ctx.source !== 'comment' && channelOk(d, ctx.channel);
        case 'trigger_new_contact':
            return ctx.source !== 'comment' && channelOk(d, ctx.channel) && !!ctx.isNewContact;

        // ─── WhatsApp-specific ───
        case 'trigger_wa_keyword':
            if (ctx.channel !== 'whatsapp' || ctx.source === 'comment') return false;
            if (d.instanceId && d.instanceId !== 'any' && d.instanceId !== ctx.instanceId) return false;
            return keywordMatches(d, ctx.text);
        case 'trigger_wa_any':
            if (ctx.channel !== 'whatsapp' || ctx.source === 'comment') return false;
            if (d.instanceId && d.instanceId !== 'any' && d.instanceId !== ctx.instanceId) return false;
            return true;
        case 'trigger_wa_new_contact':
            if (ctx.channel !== 'whatsapp' || ctx.source === 'comment' || !ctx.isNewContact) return false;
            if (d.instanceId && d.instanceId !== 'any' && d.instanceId !== ctx.instanceId) return false;
            return true;

        // ─── Instagram DM triggers ───
        // Unified trigger with a filterMode switch (any/keyword). Old
        // paired triggers still supported below for backward compat.
        case 'trigger_ig_dm': {
            if (ctx.channel !== 'instagram' || ctx.source !== 'dm') return false;
            if (d.accountId && d.accountId !== 'any' && d.accountId !== ctx.accountId) return false;
            const mode = String(d.filterMode || 'any');
            if (mode === 'keyword') return keywordMatches(d, ctx.text);
            return true;
        }
        case 'trigger_ig_keyword':
            if (ctx.channel !== 'instagram' || ctx.source !== 'dm') return false;
            if (d.accountId && d.accountId !== 'any' && d.accountId !== ctx.accountId) return false;
            return keywordMatches(d, ctx.text);
        case 'trigger_ig_any':
            if (ctx.channel !== 'instagram' || ctx.source !== 'dm') return false;
            if (d.accountId && d.accountId !== 'any' && d.accountId !== ctx.accountId) return false;
            return true;
        case 'trigger_ig_new_contact':
            if (ctx.channel !== 'instagram' || ctx.source !== 'dm' || !ctx.isNewContact) return false;
            if (d.accountId && d.accountId !== 'any' && d.accountId !== ctx.accountId) return false;
            return true;

        // ─── Instagram post trigger (comments today, room to grow) ───
        // Renamed from trigger_ig_comment. Old names still match.
        case 'trigger_ig_post':
        case 'trigger_comment':
        case 'trigger_ig_comment': {
            if (ctx.channel !== 'instagram' || ctx.source !== 'comment') return false;
            if (d.accountId && d.accountId !== 'any' && d.accountId !== ctx.accountId) return false;
            const postId = String(d.mediaId || d.postId || '').trim();
            if (postId && postId !== 'any' && postId !== ctx.mediaId) return false;
            return String(d.keywords || '').trim() === '' || keywordMatches(d, ctx.text);
        }
        default:
            return false;
    }
}

// Resolve a media field on a node (used by message nodes that have an
// optional embedded attachment). Returns null when no URL is set.
function resolveMedia(d: any, ctx: AutomationContext): MediaPayload | null {
    const media = d?.media;
    const url = interpolate(String(media?.url || ''), ctx);
    if (!url) return null;
    return {
        kind: (media.kind || 'image') as MediaKind,
        url,
        caption: media.caption ? interpolate(String(media.caption), ctx) : undefined,
        filename: media.filename ? interpolate(String(media.filename), ctx) : undefined,
        mimetype: media.mimetype || undefined,
    };
}

function interpolate(text: string, ctx: AutomationContext): string {
    // `name` prefers the display name, falls back to @handle. `username`
    // prefers the @handle, falls back to display name. This way an
    // operator who plugged {{username}} into a WhatsApp trigger still
    // gets *something* rendered, and vice-versa.
    const displayName = ctx.contactName || ctx.contactUsername || '';
    const handle = ctx.contactUsername || ctx.contactName || '';
    const builtIns: Record<string, string> = {
        name: displayName,
        username: handle,
        message: ctx.text || '',
        comment: ctx.text || '',
        post_url: ctx.permalink || '',
    };
    return (text || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
        const parts = path.split('.').filter(Boolean);
        if (parts.length === 0) return '';
        const root = parts[0].toLowerCase();
        // Built-in (single-segment) variables
        if (parts.length === 1 && root in builtIns) return builtIns[root];
        // Dynamic vars from upstream nodes (case-sensitive key match)
        const bag = ctx.vars || {};
        if (!(parts[0] in bag)) return '';
        let v: any = bag[parts[0]];
        for (let i = 1; i < parts.length; i++) {
            if (v == null) return '';
            v = v[parts[i]];
        }
        if (v == null) return '';
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
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
        case 'action_wa_send_message': {
            const media = resolveMedia(d, ctx);
            const text = d.text ? interpolate(String(d.text), ctx) : '';
            if (media && ctx.sendMedia) {
                // Embed text as caption when supported; fall back to two messages otherwise.
                if (text && (media.kind === 'image' || media.kind === 'video' || media.kind === 'document')) {
                    await ctx.sendMedia({ ...media, caption: text });
                } else {
                    await ctx.sendMedia(media);
                    if (text) await ctx.sendMessage(text);
                }
            } else if (text) {
                await ctx.sendMessage(text);
            }
            return true;
        }
        case 'action_ig_send_dm': {
            // Instagram DM with optional attachment + quick replies.
            const media = resolveMedia(d, ctx);
            const text = d.text ? interpolate(String(d.text), ctx) : '';
            const qr = Array.isArray(d.quickReplies)
                ? d.quickReplies
                    .map((r: any) => ({ title: interpolate(String(r?.title || ''), ctx), payload: r?.payload ? String(r.payload) : undefined }))
                    .filter((r: any) => r.title)
                : undefined;
            if (media && ctx.sendDm && (media.kind === 'image' || media.kind === 'video' || media.kind === 'audio')) {
                await ctx.sendDm({ kind: 'attachment', attachmentType: media.kind, url: media.url, quickReplies: qr });
                if (text) await ctx.sendDm({ kind: 'text', text });
            } else if (media && ctx.sendMedia) {
                // Document fallback — IG converts it to a link
                await ctx.sendMedia(media);
                if (text && ctx.sendDm) await ctx.sendDm({ kind: 'text', text, quickReplies: qr });
            } else if (text && ctx.sendDm) {
                await ctx.sendDm({ kind: 'text', text, quickReplies: qr });
            } else if (text) {
                await ctx.sendMessage(text);
            }
            return true;
        }
        case 'action_ig_reply_comment': {
            if (!ctx.replyComment || !d.text) return true;
            await ctx.replyComment(interpolate(String(d.text), ctx));
            return true;
        }
        case 'action_ig_hide_comment': {
            if (ctx.hideComment) await ctx.hideComment();
            return true;
        }
        case 'action_ig_delete_comment': {
            if (ctx.deleteComment) await ctx.deleteComment();
            return true;
        }
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
        case 'action_set_user_field': {
            const key = String(d.fieldKey || '').trim();
            if (!key || !ctx.setUserField) return true;
            // Value can reference {{message}}, {{name}}, etc.
            const raw = d.value;
            const value = typeof raw === 'string' ? interpolate(raw, ctx) : raw;
            await ctx.setUserField(key, value);
            return true;
        }
        case 'action_wait': {
            const secs = Math.min(Math.max(Number(d.seconds) || 0, 0), 120);
            if (secs > 0) await new Promise(r => setTimeout(r, secs * 1000));
            return true;
        }
        case 'action_http_request': {
            const method = String(d.method || 'GET').toUpperCase();
            let url = interpolate(String(d.url || ''), ctx).trim();
            if (!url) return true;

            // Query parameters — structured array only. The n8n-style
            // UI sends `[{ key, value, enabled }, …]`.
            if (d.sendQueryParams && Array.isArray(d.queryParams) && d.queryParams.length > 0) {
                const qs = new URLSearchParams();
                for (const p of d.queryParams) {
                    if (!p || p.enabled === false) continue;
                    const k = interpolate(String(p.key || ''), ctx).trim();
                    if (!k) continue;
                    qs.append(k, interpolate(String(p.value || ''), ctx));
                }
                const queryString = qs.toString();
                if (queryString) url += (url.includes('?') ? '&' : '?') + queryString;
            }

            // Headers — support both the new array shape and the legacy
            // newline string so older saved automations still work.
            const headers: Record<string, string> = {};
            if (d.sendHeaders !== false) {
                if (Array.isArray(d.headers)) {
                    for (const h of d.headers) {
                        if (!h || h.enabled === false) continue;
                        const k = interpolate(String(h.key || ''), ctx).trim();
                        if (!k) continue;
                        headers[k] = interpolate(String(h.value || ''), ctx);
                    }
                } else if (typeof d.headers === 'string') {
                    for (const line of d.headers.split('\n')) {
                        const idx = line.indexOf(':');
                        if (idx <= 0) continue;
                        const k = line.slice(0, idx).trim();
                        const v = interpolate(line.slice(idx + 1).trim(), ctx);
                        if (k) headers[k] = v;
                    }
                }
            }

            // Body — honour the toggle (sendBody). bodyType defaults to
            // json so older payloads without the flag still auto-set
            // Content-Type.
            let body: string | undefined;
            const bodyEnabled = d.sendBody !== false && (method !== 'GET' && method !== 'HEAD');
            if (bodyEnabled && d.body) {
                body = interpolate(String(d.body), ctx);
                const bodyType = String(d.bodyType || 'json');
                const hasContentType = !!(headers['Content-Type'] || headers['content-type']);
                if (!hasContentType) {
                    if (bodyType === 'json') {
                        // Trust the operator's declaration — no runtime parse
                        // check needed since the UI has one.
                        headers['Content-Type'] = 'application/json';
                    } else if (bodyType === 'form') {
                        headers['Content-Type'] = 'application/x-www-form-urlencoded';
                    }
                }
            }

            const varKey = String(d.outputVariable || '').trim();
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 15_000);
                const resp = await fetch(url, {
                    method,
                    headers,
                    body: (method === 'GET' || method === 'HEAD') ? undefined : body,
                    signal: controller.signal,
                });
                clearTimeout(timer);
                const ct = resp.headers.get('content-type') || '';
                const parsed: any = ct.includes('application/json')
                    ? await resp.json().catch(() => null)
                    : await resp.text().catch(() => '');
                if (varKey) {
                    if (!ctx.vars) ctx.vars = {};
                    ctx.vars[varKey] = parsed;
                    ctx.vars[`${varKey}_status`] = resp.status;
                }
                logger.info({ url, method, status: resp.status, varKey }, '[Automation] HTTP request completed');
            } catch (err: any) {
                logger.warn({ url, method, err: err?.message }, '[Automation] HTTP request failed');
                if (varKey) {
                    if (!ctx.vars) ctx.vars = {};
                    ctx.vars[varKey] = null;
                    ctx.vars[`${varKey}_error`] = err?.message || 'request failed';
                }
            }
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

async function runGraph(triggerId: string, nodes: any[], edges: any[], ctx: AutomationContext): Promise<number> {
    const byId: Record<string, any> = {};
    for (const n of nodes) byId[n.id] = n;
    const outgoing = (id: string, handle?: string) =>
        edges.filter(e => e.source === id && (handle === undefined || (e.sourceHandle || null) === handle));

    let queue: string[] = outgoing(triggerId).map(e => e.target);
    const visited = new Set<string>();
    let steps = 0;
    let executed = 0;
    while (queue.length && steps < 100) {
        steps++;
        const nid = queue.shift()!;
        if (visited.has(nid)) continue;
        visited.add(nid);
        const node = byId[nid];
        if (!node) continue;
        const result = await executeNode(node, ctx);
        executed++;
        if (node.type === 'condition') {
            queue.push(...outgoing(nid, result ? 'true' : 'false').map(e => e.target));
        } else {
            queue.push(...outgoing(nid).map(e => e.target));
        }
    }
    return executed;
}

export class AutomationEngine {
    // Returns { matched } — if matched, the channel handler should skip its
    // default AI-agent reply to avoid double responses.
    static async handleMessage(ctx: AutomationContext): Promise<{ matched: boolean; overrideAgentId?: string }> {
        try {
            const automations = await prisma.automation.findMany({
                where: { userId: ctx.userId, isActive: true }
            });
            let matched = false;
            // action_ai_reply calls ctx.runAgent(agentId). We stash the
            // ID here and let the channel handler swap in that agent
            // instead of the instance/account default when it emits its
            // reply. Uniform for WhatsApp DM, Instagram DM, and Instagram
            // comment→DM alike.
            let overrideAgentId: string | undefined;
            ctx.runAgent = async (agentId: string) => { overrideAgentId = agentId; };
            // Fresh variable bag per handleMessage call — action_http_request
            // and any future producers stash values here for downstream nodes.
            if (!ctx.vars) ctx.vars = {};
            for (const auto of automations) {
                const nodes = (auto.nodes as any[]) || [];
                const edges = (auto.edges as any[]) || [];
                for (const node of nodes) {
                    if (typeof node?.type !== 'string' || !node.type.startsWith('trigger_')) continue;
                    if (!triggerMatches(node, ctx)) continue;
                    matched = true;
                    logger.info({ automation: auto.name, trigger: node.type }, '[Automation] trigger matched');
                    const startedAt = new Date();
                    const t0 = Date.now();
                    let status: 'success' | 'failure' = 'success';
                    let errorMessage: string | null = null;
                    let executed = 0;
                    try {
                        executed = await runGraph(node.id, nodes, edges, ctx);
                    } catch (runErr: any) {
                        status = 'failure';
                        errorMessage = String(runErr?.message || runErr || 'Unknown error').slice(0, 2000);
                        logger.error({ err: runErr?.message, automation: auto.name }, '[Automation] run error');
                    }
                    // Fire-and-forget execution log — don't let DB hiccups break the user message flow.
                    prisma.automationExecution.create({
                        data: {
                            automationId: auto.id,
                            userId: ctx.userId,
                            status,
                            triggerType: node.type,
                            channel: ctx.channel,
                            contactId: ctx.contactId,
                            contactName: ctx.contactName || null,
                            inputText: (ctx.text || '').slice(0, 4000),
                            nodesExecuted: executed,
                            durationMs: Date.now() - t0,
                            errorMessage,
                            startedAt,
                        }
                    }).catch(e => logger.warn({ err: e.message }, '[Automation] execution log failed'));
                }
            }
            return { matched, overrideAgentId };
        } catch (e: any) {
            logger.error({ err: e.message }, '[Automation] engine error');
            return { matched: false };
        }
    }
}

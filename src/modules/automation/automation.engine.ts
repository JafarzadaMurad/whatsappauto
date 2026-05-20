import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

type Channel = 'whatsapp' | 'instagram';

export type AutomationContext = {
    userId: string;
    channel: Channel;
    text: string;
    contactId: string;        // remoteJid (WhatsApp) or IGSID (Instagram)
    contactName?: string;
    isNewContact?: boolean;
    source?: 'dm' | 'comment';
    // callbacks supplied by the channel handler
    sendMessage: (text: string) => Promise<void>;
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
        case 'trigger_comment':
            return ctx.channel === 'instagram' && ctx.source === 'comment' &&
                (String(d.keywords || '').trim() === '' || keywordMatches(d, ctx.text));
        default:
            return false;
    }
}

function interpolate(text: string, ctx: AutomationContext): string {
    return (text || '')
        .replace(/\{\{\s*name\s*\}\}/gi, ctx.contactName || '')
        .replace(/\{\{\s*message\s*\}\}/gi, ctx.text || '');
}

async function executeNode(node: any, ctx: AutomationContext): Promise<boolean> {
    const d = node.data || {};
    switch (node.type) {
        case 'action_send_message':
            if (d.text) await ctx.sendMessage(interpolate(String(d.text), ctx));
            return true;
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

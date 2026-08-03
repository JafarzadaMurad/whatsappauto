// Tools for voice assistants.
//
// A voice assistant already had `linkedAgentId` and `mcpToolNames` in
// its schema and its editor, but nothing read them — the phone bridge
// registered exactly one function (`end_call`) and nothing else. So an
// assistant could be pointed at an agent with a full CRM + tables +
// HTTP toolkit and still be unable to look anything up mid-call.
//
// This module closes that gap by reusing the chat agent's tool builder
// rather than growing a second one. Two things have to be reconciled:
//
//  1. Shape. Agent tools are AI-SDK tools — a zod schema plus an
//     execute(). The Realtime API wants JSON Schema function defs and
//     dispatches by name. The zod wrapper already carries `.jsonSchema`,
//     so the conversion is a projection, not a re-declaration.
//
//  2. Context. Half the agent toolkit is bound to a WhatsApp thread
//     (polls, media, live-operator hand-off). Those are gated on an
//     instanceId, so passing an empty one leaves them out on their own
//     — no separate deny-list to keep in sync. What DOES carry over is
//     anything keyed to the person: CRM, saved fields, conversation
//     memory. We hand those the caller's number in WhatsApp's own jid
//     form, so the assistant on the phone sees the same customer record
//     the agent sees in chat.

import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { buildToolsForSkills } from '../agent/ai.service';

export type VoiceTool = {
    name: string;
    description: string;
    jsonSchema: any;
    execute: (args: any) => Promise<any>;
};

export type VoiceToolContext = {
    assistantId: string;
    workspaceId: string;
    linkedAgentId: string | null;
    /** Empty = every tool the linked agent has. Otherwise a subset. */
    mcpToolNames: string[];
    /** The other party on the call, E.164 or raw digits. */
    contactPhone: string | null;
};

// Realtime rejects a function whose parameters aren't a plain object
// schema, and the AI-SDK wrapper emits a $schema key it has no use for.
function toRealtimeSchema(jsonSchema: any) {
    const { $schema, ...rest } = jsonSchema || {};
    if (!rest.type) return { type: 'object', properties: {}, required: [] };
    return rest;
}

/**
 * Build the tool set a voice assistant may call during a phone call.
 * Returns an empty list when the assistant isn't linked to an agent —
 * which is the default, so silence here is not a failure.
 */
export async function buildVoiceTools(ctx: VoiceToolContext): Promise<{ tools: VoiceTool[]; prompt: string }> {
    if (!ctx.linkedAgentId) return { tools: [], prompt: '' };

    const agent = await prisma.agent.findFirst({
        where: { id: ctx.linkedAgentId, workspaceId: ctx.workspaceId },
        select: {
            id: true, name: true, userId: true, workspaceId: true,
            skills: true, allowedTableIds: true, httpTools: true, skillPrompts: true,
        },
    });
    if (!agent) {
        logger.warn({ assistantId: ctx.assistantId, agentId: ctx.linkedAgentId },
            '[voice-tools] linked agent not found in this workspace — call runs without tools');
        return { tools: [], prompt: '' };
    }

    // The digits are what every contact-scoped tool keys on; the jid
    // form is what the chat agent stores against, so building it here
    // is what makes "same customer" true across the two channels.
    const digits = (ctx.contactPhone || '').replace(/[^0-9]/g, '');
    const remoteJid = digits ? `${digits}@s.whatsapp.net` : '';

    let built: { tools?: Record<string, any>; skillPrompt: string };
    try {
        built = buildToolsForSkills(
            agent.skills || [],
            agent.allowedTableIds || [],
            agent.userId,
            ctx.workspaceId,
            (agent.httpTools as any) || [],
            agent.id,
            remoteJid,
            (agent.skillPrompts as any) || {},
            // No instanceId on a phone call. Every WhatsApp-bound tool
            // (polls, media, operator hand-off) is gated on one, so
            // leaving it empty excludes them without a deny-list.
            '',
            null,
        );
    } catch (err: any) {
        logger.error({ err: err.message, agentId: agent.id }, '[voice-tools] failed to build agent tools');
        return { tools: [], prompt: '' };
    }

    const all = built.tools || {};
    const wanted = ctx.mcpToolNames?.length
        ? Object.keys(all).filter(n => ctx.mcpToolNames.includes(n))
        : Object.keys(all);

    const tools: VoiceTool[] = wanted.map(name => {
        const t = all[name];
        return {
            name,
            description: String(t.description || name),
            jsonSchema: toRealtimeSchema(t.parameters?.jsonSchema ?? t.inputSchema?.jsonSchema),
            execute: t.execute,
        };
    });

    // The skill guidance the chat agent gets is written for a keyboard.
    // On a call the same tools need one extra rule the text channel
    // never needs: say something before a lookup, because silence on a
    // phone line reads as a dropped call rather than as thinking.
    const prompt = tools.length
        ? `${built.skillPrompt}\n\nYou are on a live phone call. Before using a tool that looks something up, ` +
          `say a short natural line first ("let me check that for you") — otherwise the caller hears silence ` +
          `and assumes the line dropped. Never read out ids, JSON or field names; speak the answer plainly.`
        : '';

    return { tools, prompt };
}

/** Runs a tool with a ceiling, so a slow lookup can't strand the call. */
export async function runVoiceTool(tool: VoiceTool, args: any, timeoutMs = 8000): Promise<any> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            Promise.resolve(tool.execute(args)),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${tool.name} timed out after ${timeoutMs}ms`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// Parsing the model's arguments must never throw into the socket
// handler — a malformed blob is the model's mistake to recover from,
// and it can only do that if we hand it back an error it can read.
export function parseToolArgs(raw: string | undefined): { ok: true; args: any } | { ok: false; error: string } {
    if (!raw || !raw.trim()) return { ok: true, args: {} };
    try {
        return { ok: true, args: JSON.parse(raw) };
    } catch (err: any) {
        return { ok: false, error: `arguments were not valid JSON: ${err.message}` };
    }
}

// Kept exported for the assistant editor, which lists what a link would
// bring in before the operator commits to it.
export async function listAgentToolNames(agentId: string, workspaceId: string): Promise<string[]> {
    const { tools } = await buildVoiceTools({
        assistantId: '', workspaceId, linkedAgentId: agentId, mcpToolNames: [], contactPhone: null,
    });
    return tools.map(t => t.name);
}

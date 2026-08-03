// Tools for voice assistants.
//
// A voice assistant owns its tools. It does not borrow them from a text
// agent, because a workspace may never create one — plenty of customers
// will only ever run an assistant on the phone, and making the phone
// depend on a chat agent that doesn't exist would be a configuration
// riddle with no answer.
//
// What IS shared is the implementations. `buildToolsForSkills` already
// builds CRM, tables, saved-fields, HTTP and calendar tools; a voice
// assistant passes its own skills and its own table/HTTP config into
// the same builder. So a tool behaves identically whichever channel
// invokes it, and a fix lands in both at once.
//
// Not every skill survives the trip. Polls, media and operator hand-off
// are WhatsApp-thread features with no phone equivalent, and memory is
// scoped to a chat agent's own history. VOICE_SKILLS is the list that
// does work on a call, and it's what the editor offers.
//
// Two shapes have to be reconciled for the Realtime API: agent tools
// are AI-SDK tools (a zod schema plus execute), Realtime wants JSON
// Schema function defs dispatched by name. The zod wrapper already
// carries `.jsonSchema`, so this is a projection, not a re-declaration.

import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { buildToolsForSkills } from '../agent/ai.service';

/** The skills a phone call can actually support. */
export const VOICE_SKILLS: { id: string; name: string; desc: string }[] = [
    {
        id: 'crm',
        name: 'CRM',
        desc: 'Look the caller up, save their name and status, write a summary of the call.',
    },
    {
        id: 'user_fields',
        name: 'Saved fields',
        desc: 'Remember specific facts about a caller — order number, address, plan — and recall them next time.',
    },
    {
        id: 'tables',
        name: 'Data tables',
        desc: 'Read your own tables during the call: stock, prices, bookings, whatever you keep there.',
    },
    {
        id: 'http',
        name: 'Your API',
        desc: 'Call your own endpoints mid-conversation — check an order, trigger something on your side.',
    },
    {
        id: 'google_calendar',
        name: 'Google Calendar',
        desc: 'Check availability and book an appointment while the caller is still on the line.',
    },
];

export const VOICE_SKILL_IDS = VOICE_SKILLS.map(s => s.id);

export type VoiceTool = {
    name: string;
    description: string;
    jsonSchema: any;
    execute: (args: any) => Promise<any>;
};

export type VoiceToolConfig = {
    assistantId: string;
    workspaceId: string;
    skills: string[];
    allowedTableIds: string[];
    httpTools: any[];
    skillPrompts: Record<string, string>;
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
 * An assistant with no skills ticked gets none, which is the default —
 * silence here is a configuration choice, not a failure.
 */
export async function buildVoiceTools(cfg: VoiceToolConfig): Promise<{ tools: VoiceTool[]; prompt: string }> {
    const skills = (cfg.skills || []).filter(s => VOICE_SKILL_IDS.includes(s));
    if (skills.length === 0) return { tools: [], prompt: '' };

    // The CRM and table builders record who acted. An assistant isn't a
    // user, so the workspace owner stands in — the same account that
    // owns the data being written.
    const ws = await prisma.workspace.findUnique({
        where: { id: cfg.workspaceId },
        select: { ownerId: true },
    });
    if (!ws) {
        logger.warn({ assistantId: cfg.assistantId }, '[voice-tools] workspace not found — call runs without tools');
        return { tools: [], prompt: '' };
    }

    // Contact-scoped tools key on the digits; the jid form is what the
    // chat side stores against, so building it here is what makes "same
    // customer" true whether they typed or dialled.
    const digits = (cfg.contactPhone || '').replace(/[^0-9]/g, '');
    const remoteJid = digits ? `${digits}@s.whatsapp.net` : '';

    let built: { tools?: Record<string, any>; skillPrompt: string };
    try {
        built = buildToolsForSkills(
            skills,
            cfg.allowedTableIds || [],
            ws.ownerId,
            cfg.workspaceId,
            (cfg.httpTools as any) || [],
            // No agent id and no instance id: a phone call belongs to
            // neither. Every WhatsApp-bound tool is gated on those, so
            // leaving them empty excludes them without a deny-list that
            // could fall out of sync.
            '',
            remoteJid,
            cfg.skillPrompts || {},
            '',
            null,
        );
    } catch (err: any) {
        logger.error({ err: err.message, assistantId: cfg.assistantId }, '[voice-tools] failed to build tools');
        return { tools: [], prompt: '' };
    }

    const all = built.tools || {};
    const tools: VoiceTool[] = Object.keys(all).map(name => {
        const t = all[name];
        return {
            name,
            description: String(t.description || name),
            jsonSchema: toRealtimeSchema(t.parameters?.jsonSchema ?? t.inputSchema?.jsonSchema),
            execute: t.execute,
        };
    });

    // The built-in skill guidance is written for a keyboard. On a call
    // the same tools need one rule the text channel never needs: say
    // something before a lookup, because silence on a phone line reads
    // as a dropped call rather than as thinking.
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

/**
 * Names of the tools a given configuration would expose. Used by the
 * editor to show what ticking a skill actually turns on, rather than
 * leaving the operator to find out on a live call.
 */
export async function previewVoiceToolNames(cfg: Omit<VoiceToolConfig, 'contactPhone'>): Promise<string[]> {
    const { tools } = await buildVoiceTools({ ...cfg, contactPhone: null });
    return tools.map(t => t.name);
}

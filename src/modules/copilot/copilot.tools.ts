// Bridges the MCP tool registry into a Vercel AI SDK tool set that the
// in-app copilot can call directly (no HTTP round-trip). Every mutation
// tool ALSO fires a `copilot.action` socket event so the dashboard UI
// can toast the change and invalidate React Query caches in real time.
//
// The trick: the existing `register<X>Tools()` functions all consume a
// `RegisterToolFn`. We hand them our own implementation that instead of
// registering with the MCP SDK, appends into an AI-SDK tool bag.

import { z, type ZodRawShape } from 'zod';
import { tool as aiTool } from 'ai';
import { io } from '../../server';
import { logger } from '../../utils/logger';

import type { ToolCtx, ToolResult, RegisterToolFn } from '../mcp/mcp.server';
import { registerAutomationTools } from '../mcp/tools/automations.tools';
import { registerAgentTools } from '../mcp/tools/agents.tools';
import { registerWhatsappTools } from '../mcp/tools/whatsapp.tools';
import { registerInstagramTools } from '../mcp/tools/instagram.tools';
import { registerInboxTools } from '../mcp/tools/inbox.tools';
import { registerClientTools } from '../mcp/tools/clients.tools';
import { registerCampaignTools } from '../mcp/tools/campaigns.tools';
import { registerTableTools } from '../mcp/tools/tables.tools';
import { registerWebhookTools } from '../mcp/tools/webhooks.tools';
import { registerApiKeyTools } from '../mcp/tools/api-keys.tools';
import { registerAiProviderTools } from '../mcp/tools/ai-providers.tools';
import { registerBillingTools } from '../mcp/tools/billing.tools';
import { registerUserFieldTools } from '../mcp/tools/user-fields.tools';

// Which tools qualify as mutations — used for the socket broadcast.
// Maps tool name → { entity, verb } consumed by the frontend to
// pick a React Query key to invalidate and a toast copy.
const MUTATION_MAP: Record<string, { entity: string; verb: string }> = {
    create_agent:                { entity: 'agents',       verb: 'created' },
    update_agent:                { entity: 'agents',       verb: 'updated' },
    delete_agent:                { entity: 'agents',       verb: 'deleted' },
    upsert_ai_provider:          { entity: 'ai-providers', verb: 'saved' },
    create_whatsapp_instance:    { entity: 'instances',    verb: 'created' },
    delete_whatsapp_instance:    { entity: 'instances',    verb: 'deleted' },
    restart_whatsapp_instance:   { entity: 'instances',    verb: 'restarted' },
    send_whatsapp_text:          { entity: 'messages',     verb: 'sent' },
    send_whatsapp_media:         { entity: 'messages',     verb: 'sent' },
    reply_in_inbox:              { entity: 'messages',     verb: 'sent' },
    reply_instagram_comment:     { entity: 'messages',     verb: 'sent' },
    send_instagram_dm:           { entity: 'messages',     verb: 'sent' },
    create_campaign:             { entity: 'campaigns',    verb: 'created' },
    pause_campaign:              { entity: 'campaigns',    verb: 'paused' },
    resume_campaign:             { entity: 'campaigns',    verb: 'resumed' },
    delete_campaign:             { entity: 'campaigns',    verb: 'deleted' },
    create_automation:           { entity: 'automations',  verb: 'created' },
    update_automation:           { entity: 'automations',  verb: 'updated' },
    toggle_automation_active:    { entity: 'automations',  verb: 'toggled' },
    delete_automation:           { entity: 'automations',  verb: 'deleted' },
    create_table:                { entity: 'tables',       verb: 'created' },
    add_table_row:               { entity: 'tables',       verb: 'row-added' },
    update_table_row:            { entity: 'tables',       verb: 'row-updated' },
    delete_table_row:            { entity: 'tables',       verb: 'row-deleted' },
    create_user_field:           { entity: 'user-fields',  verb: 'created' },
    update_user_field:           { entity: 'user-fields',  verb: 'updated' },
    delete_user_field:           { entity: 'user-fields',  verb: 'deleted' },
    update_client:               { entity: 'clients',      verb: 'updated' },
    delete_client:               { entity: 'clients',      verb: 'deleted' },
    add_client_tag:              { entity: 'clients',      verb: 'tagged' },
    remove_client_tag:           { entity: 'clients',      verb: 'untagged' },
    set_contact_field:           { entity: 'clients',      verb: 'updated' },
    create_webhook:              { entity: 'webhooks',     verb: 'created' },
    delete_webhook:              { entity: 'webhooks',     verb: 'deleted' },
    create_api_key:              { entity: 'api-keys',     verb: 'created' },
    delete_api_key:              { entity: 'api-keys',     verb: 'deleted' },
    disconnect_instagram_account:{ entity: 'instagram',    verb: 'disconnected' },
};

// Read-only tools that don't need a socket broadcast (list_*, get_*,
// describe_*). Kept as a runtime allow-list so we never accidentally
// spam UI toasts for cheap reads.
function isMutation(name: string): boolean {
    return name in MUTATION_MAP;
}

function pickTitle(args: any, resultText: string): string {
    // Prefer the caller's own name field, falling back to the tool
    // result if it echoed one. Kept short — the toast is one line.
    const candidate = args?.name || args?.title || args?.text || args?.message;
    if (candidate && typeof candidate === 'string') return candidate.slice(0, 80);
    try {
        const parsed = JSON.parse(resultText);
        return String(parsed?.name || parsed?.title || parsed?.id || '').slice(0, 80);
    } catch { return ''; }
}

function pickId(args: any, resultText: string): string | null {
    if (typeof args?.id === 'string') return args.id;
    try {
        const parsed = JSON.parse(resultText);
        return typeof parsed?.id === 'string' ? parsed.id : null;
    } catch { return null; }
}

export type CopilotToolBag = Record<string, ReturnType<typeof aiTool>>;

// A single registered tool, in the shape the OpenAI Realtime API expects
// via `session.update.tools`. The Realtime API uses `parameters` for the
// JSON Schema (not Anthropic's `input_schema` or MCP's `inputSchema`).
export type RealtimeToolSchema = {
    type: 'function';
    name: string;
    description: string;
    parameters: any;
};

// Executor callback that closes over ctx + args + returns whatever the
// underlying MCP tool returned (already parsed to JSON when possible).
type ToolExecutor = (args: any) => Promise<any>;

/**
 * Same register-based construction as buildCopilotTools(), but produces
 * two artifacts the voice path needs:
 *   1. Tool schemas the browser can drop into `session.update.tools`
 *      (Realtime API function-calling contract).
 *   2. An executor map the /copilot/tool-call endpoint uses when the
 *      Realtime model wants to invoke one of those tools — the browser
 *      forwards {name, args}, we look up the executor and run it under
 *      the caller's own workspace context.
 * The socket broadcast wiring from buildCopilotTools is preserved.
 */
export function buildCopilotVoiceTools(ctx: ToolCtx): {
    schemas: RealtimeToolSchema[];
    executors: Map<string, ToolExecutor>;
} {
    const schemas: RealtimeToolSchema[] = [];
    const executors = new Map<string, ToolExecutor>();

    const register: RegisterToolFn = <Shape extends ZodRawShape>(
        name: string,
        description: string,
        inputShape: Shape,
        handler: (args: any, ctx: ToolCtx) => Promise<ToolResult>,
    ) => {
        const schema = z.object(inputShape);
        // Zod v4 ships z.toJSONSchema. Wrap in try/catch so an unusual
        // schema doesn't take the whole voice session down.
        let jsonSchema: any = { type: 'object', properties: {} };
        try {
            jsonSchema = (z as any).toJSONSchema(schema);
        } catch { /* fallback to empty schema */ }
        // Strip fields the Realtime API rejects — $schema, definitions, etc.
        // Realtime wants a plain JSON Schema object with type/properties/required.
        if (jsonSchema && typeof jsonSchema === 'object') {
            delete jsonSchema.$schema;
            delete jsonSchema.$ref;
            delete jsonSchema.definitions;
        }
        schemas.push({ type: 'function', name, description, parameters: jsonSchema });

        executors.set(name, async (args: any) => {
            const result = await handler(args || {}, ctx);
            const text = (result.content || []).map(c => c.text).join('\n');
            const isError = !!result.isError;
            // Same broadcast the text path uses so the dashboard toasts
            // the change and the panel can render an action card.
            if (!isError && isMutation(name)) {
                try {
                    const m = MUTATION_MAP[name]!;
                    io.to(`workspace:${ctx.workspaceId}`).emit('copilot.action', {
                        tool: name, entity: m.entity, verb: m.verb,
                        title: pickTitle(args, text),
                        id: pickId(args, text),
                        at: new Date().toISOString(),
                    });
                } catch { /* best-effort */ }
            }
            if (isError) return { error: text };
            try { return JSON.parse(text); }
            catch { return { text }; }
        });
    };

    registerAutomationTools(register);
    registerAgentTools(register);
    registerWhatsappTools(register);
    registerInstagramTools(register);
    registerInboxTools(register);
    registerClientTools(register);
    registerCampaignTools(register);
    registerTableTools(register);
    registerWebhookTools(register);
    registerApiKeyTools(register);
    registerAiProviderTools(register);
    registerUserFieldTools(register);
    registerBillingTools(register);
    registerCopilotUiTools(register);

    return { schemas, executors };
}

/**
 * Build the entire copilot tool bag for a given workspace/user.
 * Reuses the MCP tool files so we don't duplicate CRUD logic.
 */
export function buildCopilotTools(ctx: ToolCtx): CopilotToolBag {
    const bag: CopilotToolBag = {};

    const register: RegisterToolFn = <Shape extends ZodRawShape>(
        name: string,
        description: string,
        inputShape: Shape,
        handler: (args: any, ctx: ToolCtx) => Promise<ToolResult>,
    ) => {
        const schema = z.object(inputShape);
        bag[name] = aiTool({
            description,
            // Vercel AI SDK: two aliases so older + newer SDK versions both pick it up.
            parameters: schema as any,
            inputSchema: schema as any,
            execute: async (args: any) => {
                const result = await handler(args, ctx);
                const text = (result.content || []).map(c => c.text).join('\n');
                const isError = !!result.isError;

                // Broadcast for mutations only. Non-blocking — a socket
                // hiccup must never break the tool call.
                if (!isError && isMutation(name)) {
                    try {
                        const m = MUTATION_MAP[name]!;
                        io.to(`workspace:${ctx.workspaceId}`).emit('copilot.action', {
                            tool: name,
                            entity: m.entity,
                            verb: m.verb,
                            title: pickTitle(args, text),
                            id: pickId(args, text),
                            at: new Date().toISOString(),
                        });
                    } catch { /* best-effort */ }
                }

                // Vercel AI SDK expects the tool's return value in whatever
                // shape the model needs. Keep it as parsed JSON when
                // possible so the model can chain it into the next call
                // without re-parsing strings.
                if (isError) return { error: text };
                try { return JSON.parse(text); }
                catch { return { text }; }
            },
        } as any);
    };

    // Same order as the MCP server. Skipping MetaTools because it hits
    // Facebook's Graph API on every call — the copilot shouldn't run
    // arbitrary ads mutations by voice yet. Enable later behind a flag.
    registerAutomationTools(register);
    registerAgentTools(register);
    registerWhatsappTools(register);
    registerInstagramTools(register);
    registerInboxTools(register);
    registerClientTools(register);
    registerCampaignTools(register);
    registerTableTools(register);
    registerWebhookTools(register);
    registerApiKeyTools(register);
    registerAiProviderTools(register);
    registerUserFieldTools(register);
    registerBillingTools(register);
    registerCopilotUiTools(register);

    return bag;
}

// Copilot-specific tools that act on the browser instead of the DB —
// e.g. navigating the user to a different dashboard page. The tool
// runs on the backend (returns immediately) and emits a socket event
// the frontend listens for and turns into a router.push. Server tools
// can't touch the user's browser directly, so this is the only
// mechanism that works for both text and voice modes uniformly.
function registerCopilotUiTools(reg: RegisterToolFn) {
    reg(
        'navigate_to',
        'Navigate the user to a page inside the alChatBot dashboard. Use this whenever the user asks you to open, show, or take them to something (e.g. "open my agents", "show me the inbox"). `path` must start with /dashboard/. Common paths: /dashboard, /dashboard/inbox, /dashboard/whatsapp, /dashboard/instagram, /dashboard/ai/agents, /dashboard/ai/providers, /dashboard/campaigns, /dashboard/contacts, /dashboard/crm/deals, /dashboard/automations, /dashboard/webhooks, /dashboard/api-keys, /dashboard/usage, /dashboard/copilot, /dashboard/settings/copilot, /dashboard/admin/plans (admin only).',
        {
            path: z.string().min(1).max(200),
            reason: z.string().max(200).optional(),
        },
        async ({ path, reason }, ctx) => {
            const cleaned = String(path || '').trim();
            if (!cleaned.startsWith('/dashboard')) {
                return { content: [{ type: 'text' as const, text: `Rejected: path must start with /dashboard/, got "${cleaned}"` }], isError: true };
            }
            try {
                // Aimed at the person who asked, not the workspace. A
                // page change belongs to one browser; broadcasting it to
                // the room would drag every teammate along. It also
                // sidesteps the case where the socket joined a different
                // workspace room than the request was scoped to.
                io.to(`user:${ctx.userId}`).emit('copilot.navigate', {
                    path: cleaned,
                    reason: reason || null,
                    at: new Date().toISOString(),
                });
                logger.info(`[copilot] navigate_to → ${cleaned} · user=${ctx.userId}`);
            } catch { /* best-effort */ }
            return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, path: cleaned }) }] };
        },
    );
}

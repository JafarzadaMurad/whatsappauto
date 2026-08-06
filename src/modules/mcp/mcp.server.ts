import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodRawShape } from 'zod';
import type { McpAuthInfo } from './mcp.auth';
import { isToolAllowed } from './mcp.permissions';
import { writeAudit } from './mcp.audit';
import { registerAutomationTools } from './tools/automations.tools';
import { registerAgentTools } from './tools/agents.tools';
import { registerWhatsappTools } from './tools/whatsapp.tools';
import { registerInstagramTools } from './tools/instagram.tools';
import { registerInboxTools } from './tools/inbox.tools';
import { registerClientTools } from './tools/clients.tools';
import { registerCampaignTools } from './tools/campaigns.tools';
import { registerTableTools } from './tools/tables.tools';
import { registerWebhookTools } from './tools/webhooks.tools';
import { registerApiKeyTools } from './tools/api-keys.tools';
import { registerAiProviderTools } from './tools/ai-providers.tools';
import { registerMetaTools } from './tools/meta.tools';
import { registerUserFieldTools } from './tools/user-fields.tools';
import { registerWorkspaceTools } from './tools/workspaces.tools';
import { registerBillingTools } from './tools/billing.tools';

export type ToolCtx = {
    auth: McpAuthInfo;
    userId: string;
    workspaceId: string;
};

export type ToolResult =
    | { content: { type: 'text'; text: string }[]; isError?: boolean };

export function ok(data: unknown): ToolResult {
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    return { content: [{ type: 'text', text }] };
}

export function fail(message: string): ToolResult {
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

// Registration helper used by every tool file. Wraps the handler with
// permission checks + audit logging.
type InferShape<Shape extends ZodRawShape> = {
    [K in keyof Shape]: z.infer<Shape[K]>;
};

export type RegisterToolFn = <Shape extends ZodRawShape>(
    name: string,
    description: string,
    inputShape: Shape,
    handler: (args: InferShape<Shape>, ctx: ToolCtx) => Promise<ToolResult>,
) => void;

export function buildMcpServer(ctx: ToolCtx): McpServer {
    const server = new McpServer(
        { name: 'alchatbot-mcp', version: '1.0.0' },
        { capabilities: { tools: {} } },
    );

    const register: RegisterToolFn = (name, description, inputShape, handler) => {
        const cb = async (args: any) => {
            const t0 = Date.now();
            try {
                const allowed = await isToolAllowed(ctx.workspaceId, name);
                if (!allowed) {
                    const r = fail(`Permission denied for tool "${name}". Enable it under Settings → MCP → Permissions.`);
                    await writeAudit({ auth: ctx.auth, tool: name, args, resultOk: false, errorMsg: 'permission_denied', durationMs: Date.now() - t0 });
                    return r;
                }
                const result = await handler(args, ctx);
                await writeAudit({ auth: ctx.auth, tool: name, args, resultOk: !result.isError, errorMsg: result.isError ? extractError(result) : undefined, durationMs: Date.now() - t0 });
                return result;
            } catch (e: any) {
                const msg = String(e?.message || e || 'Unknown error');
                await writeAudit({ auth: ctx.auth, tool: name, args, resultOk: false, errorMsg: msg, durationMs: Date.now() - t0 });
                return fail(msg);
            }
        };
        (server.registerTool as any)(
            name,
            { description, inputSchema: inputShape },
            cb,
        );
    };

    registerMetaTools(register);
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
    registerWorkspaceTools(register);
    registerBillingTools(register);

    return server;
}

function extractError(r: ToolResult): string | undefined {
    const first = r.content?.[0];
    if (first?.type === 'text') return first.text.slice(0, 500);
    return undefined;
}

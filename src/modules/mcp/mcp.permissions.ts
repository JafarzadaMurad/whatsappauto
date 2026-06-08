import { prisma } from '../../lib/prisma';

// Mapping from MCP tool name → resource.verb key stored in McpPermission.toolFlags
// Verbs: read | create | update | delete
//
// If a tool isn't in this map, it's treated as a "read" of "meta".
const TOOL_PERMISSION: Record<string, string> = {
    // Meta
    describe_automation_node_types: 'meta.read',
    describe_agent_skills: 'meta.read',
    describe_ai_providers: 'meta.read',
    describe_channels: 'meta.read',
    get_platform_capabilities: 'meta.read',

    // Automations
    list_automations: 'automation.read',
    get_automation: 'automation.read',
    list_executions: 'automation.read',
    create_automation: 'automation.create',
    update_automation: 'automation.update',
    toggle_automation_active: 'automation.update',
    delete_automation: 'automation.delete',

    // Agents
    list_agents: 'agent.read',
    get_agent: 'agent.read',
    list_agent_conversations: 'agent.read',
    list_agent_messages: 'agent.read',
    create_agent: 'agent.create',
    update_agent: 'agent.update',
    delete_agent: 'agent.delete',

    // WhatsApp
    list_whatsapp_instances: 'whatsapp.read',
    get_whatsapp_instance: 'whatsapp.read',
    create_whatsapp_instance: 'whatsapp.create',
    restart_whatsapp_instance: 'whatsapp.update',
    delete_whatsapp_instance: 'whatsapp.delete',
    send_whatsapp_text: 'whatsapp.create',
    send_whatsapp_media: 'whatsapp.create',

    // Instagram
    list_instagram_accounts: 'instagram.read',
    get_instagram_account: 'instagram.read',
    get_instagram_connect_url: 'instagram.read',
    list_instagram_media: 'instagram.read',
    list_instagram_comments: 'instagram.read',
    disconnect_instagram_account: 'instagram.delete',
    send_instagram_dm: 'instagram.create',
    reply_instagram_comment: 'instagram.create',

    // Inbox
    list_inbox_conversations: 'inbox.read',
    list_inbox_messages: 'inbox.read',
    reply_in_inbox: 'inbox.create',

    // Clients
    list_clients: 'client.read',
    get_client: 'client.read',
    update_client: 'client.update',
    add_client_tag: 'client.update',
    remove_client_tag: 'client.update',
    delete_client: 'client.delete',

    // Campaigns
    list_campaigns: 'campaign.read',
    get_campaign: 'campaign.read',
    create_campaign: 'campaign.create',
    pause_campaign: 'campaign.update',
    resume_campaign: 'campaign.update',
    delete_campaign: 'campaign.delete',

    // Tables
    list_tables: 'table.read',
    get_table: 'table.read',
    list_table_rows: 'table.read',
    create_table: 'table.create',
    add_table_row: 'table.create',
    update_table_row: 'table.update',
    delete_table_row: 'table.delete',

    // Webhooks
    list_webhooks: 'webhook.read',
    create_webhook: 'webhook.create',
    delete_webhook: 'webhook.delete',

    // API keys
    list_api_keys: 'apikey.read',
    create_api_key: 'apikey.create',
    delete_api_key: 'apikey.delete',

    // AI providers
    list_ai_providers: 'aiprovider.read',
    upsert_ai_provider: 'aiprovider.update',

    // User fields
    list_user_fields: 'user_field.read',
    create_user_field: 'user_field.create',
    update_user_field: 'user_field.update',
    delete_user_field: 'user_field.delete',
    get_contact_field: 'client.read',
    set_contact_field: 'client.update',
};

export const PERMISSION_CATEGORIES = [
    'meta',
    'automation',
    'agent',
    'whatsapp',
    'instagram',
    'inbox',
    'client',
    'campaign',
    'table',
    'webhook',
    'apikey',
    'aiprovider',
    'user_field',
] as const;

export const PERMISSION_VERBS = ['read', 'create', 'update', 'delete'] as const;

export function getToolPermissionKey(tool: string): string {
    return TOOL_PERMISSION[tool] || 'meta.read';
}

export async function isToolAllowed(userId: string, tool: string): Promise<boolean> {
    const key = getToolPermissionKey(tool);
    const row = await prisma.mcpPermission.findUnique({ where: { userId } });
    if (!row) return true; // default = allow everything
    const flags = (row.toolFlags as Record<string, boolean>) || {};
    // Explicit false denies. Missing key = allow.
    return flags[key] !== false;
}

export async function listPermissions(userId: string): Promise<Record<string, boolean>> {
    const row = await prisma.mcpPermission.findUnique({ where: { userId } });
    return (row?.toolFlags as Record<string, boolean>) || {};
}

export async function setPermissions(userId: string, toolFlags: Record<string, boolean>) {
    await prisma.mcpPermission.upsert({
        where: { userId },
        create: { userId, toolFlags },
        update: { toolFlags },
    });
}

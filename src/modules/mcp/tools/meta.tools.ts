import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { AUTOMATION_NODES, ACTIVE_NODE_TYPES } from '../../automation/node-registry';
import { DEFAULT_SKILL_PROMPTS } from '../../agent/ai.service';
import { ok, type RegisterToolFn } from '../mcp.server';

export function registerMetaTools(reg: RegisterToolFn) {
    reg(
        'describe_automation_node_types',
        'Returns the catalog of all automation node types the platform knows. Includes each node\'s id, category (trigger/action/logic), channel (whatsapp/instagram/generic), human label, behavioural description, and the shape of its `data` field (each field\'s name + type + whether required). Call this BEFORE create_automation so the nodes you produce use valid type ids and correct field shapes.',
        {},
        async () => ok({ activeTypes: ACTIVE_NODE_TYPES, nodes: AUTOMATION_NODES }),
    );

    reg(
        'describe_agent_skills',
        'Returns the AI-agent skill catalog: skill ids (crm, tables, memory, http) and the default system-prompt fragment each skill injects. Use when building or editing agents.',
        {},
        async () => ok({
            skills: ['crm', 'tables', 'memory', 'http'],
            defaultPrompts: DEFAULT_SKILL_PROMPTS,
        }),
    );

    reg(
        'describe_ai_providers',
        'Returns the AI providers configured for the calling user, including provider type (OPENAI / CLAUDE / GEMINI), id, and the list of models that providerId can be used with via agents.',
        {},
        async (_args, ctx) => {
            const providers = await prisma.aiProvider.findMany({
                where: { workspaceId: ctx.workspaceId },
                select: { id: true, provider: true, createdAt: true },
            });
            return ok({ providers });
        },
    );

    reg(
        'describe_channels',
        'Returns the connected channels for the calling user — WhatsApp instances and Instagram accounts with their ids and connection state. Use to discover what instanceId / accountId values are valid for triggers and message sends.',
        {},
        async (_args, ctx) => {
            const [whatsapp, instagram] = await Promise.all([
                prisma.instance.findMany({
                    where: { workspaceId: ctx.workspaceId },
                    select: { id: true, name: true, status: true, agentId: true },
                }),
                prisma.instagramAccount.findMany({
                    where: { workspaceId: ctx.workspaceId },
                    select: { id: true, igUsername: true, igUserId: true, isActive: true, agentId: true },
                }),
            ]);
            return ok({ whatsapp, instagram });
        },
    );

    reg(
        'get_platform_capabilities',
        'Returns the high-level capability map of this alChatBot instance: server version, available tool modules, and notable feature flags. Useful as a first call to learn what kinds of resources can be operated on.',
        {},
        async () => ok({
            name: 'alChatBot MCP',
            version: '1.0.0',
            modules: [
                'automations', 'agents', 'whatsapp', 'instagram',
                'inbox', 'clients', 'campaigns', 'tables',
                'webhooks', 'api_keys', 'ai_providers',
            ],
            notes: [
                'Tools are scoped by the calling user (API key or OAuth bearer).',
                'Per-tool permissions can be toggled by the user in Settings → MCP.',
                'All tool calls are recorded in the user\'s MCP audit log.',
            ],
        }),
    );
}

// Silence unused-import lint
void z;

// ─── Automation Node Registry ──────────────────────────────────────
//
// Single source of truth for every automation node type the platform
// understands. Both the engine and the MCP server read from it.
//
// To add a new node type:
//   1. Add an entry below describing its inputs and what it does.
//   2. Add the runtime behavior in `automation.engine.ts` (a case in
//      `triggerMatches` or `executeNode`).
//
// The AI surface (MCP `describe_automation_node_types`) returns this
// catalog verbatim, so the `description` field is what the AI sees
// when deciding which node to use. Keep it specific and behavioural.

export type NodeFieldType =
    | 'string'
    | 'number'
    | 'boolean'
    | 'select'
    | 'media'      // { kind, url, caption?, filename?, mimetype? }
    | 'json'
    | 'array';

export type NodeFieldSpec = {
    name: string;
    type: NodeFieldType;
    required?: boolean;
    options?: string[];           // for type: 'select'
    description?: string;
    defaultValue?: unknown;
};

export type AutomationNodeSpec = {
    id: string;
    category: 'trigger' | 'action' | 'logic';
    channel: 'whatsapp' | 'instagram' | 'generic';
    label: string;
    description: string;
    fields: NodeFieldSpec[];
    legacy?: boolean;             // hidden from picker, still matches in engine
};

const KEYWORD_FIELDS: NodeFieldSpec[] = [
    { name: 'keywords', type: 'string', required: true, description: 'Comma-separated keywords, e.g. "price, qiymet, info"' },
    { name: 'matchMode', type: 'select', options: ['contains', 'exact', 'starts', 'regex'], defaultValue: 'contains' },
    { name: 'caseSensitive', type: 'boolean', defaultValue: false },
];

export const AUTOMATION_NODES: Record<string, AutomationNodeSpec> = {
    // ─── WhatsApp triggers ───
    trigger_wa_keyword: {
        id: 'trigger_wa_keyword',
        category: 'trigger', channel: 'whatsapp',
        label: 'WhatsApp · Keyword',
        description: 'Fires when an incoming WhatsApp DM matches one of the keywords.',
        fields: [
            { name: 'instanceId', type: 'select', description: 'WhatsApp instance id, or "any"', defaultValue: 'any' },
            ...KEYWORD_FIELDS,
        ],
    },
    trigger_wa_any: {
        id: 'trigger_wa_any',
        category: 'trigger', channel: 'whatsapp',
        label: 'WhatsApp · Any Message',
        description: 'Fires on every incoming WhatsApp DM.',
        fields: [
            { name: 'instanceId', type: 'select', description: 'WhatsApp instance id, or "any"', defaultValue: 'any' },
        ],
    },
    trigger_wa_new_contact: {
        id: 'trigger_wa_new_contact',
        category: 'trigger', channel: 'whatsapp',
        label: 'WhatsApp · New Contact',
        description: 'Fires the first time a WhatsApp contact messages this account.',
        fields: [
            { name: 'instanceId', type: 'select', description: 'WhatsApp instance id, or "any"', defaultValue: 'any' },
        ],
    },

    // ─── Instagram triggers ───
    // Single DM trigger with an internal filter switch: 'any' fires on
    // every DM, 'keyword' requires a keyword match. Replaces the old
    // pair trigger_ig_any + trigger_ig_keyword (both kept as legacy
    // aliases so saved automations still work).
    trigger_ig_dm: {
        id: 'trigger_ig_dm',
        category: 'trigger', channel: 'instagram',
        label: 'Instagram · DM',
        description: 'Fires on incoming Instagram DMs. Set filterMode to "keyword" to only match specific keywords, or "any" to match every DM.',
        fields: [
            { name: 'accountId', type: 'select', description: 'Instagram account id, or "any"', defaultValue: 'any' },
            { name: 'filterMode', type: 'select', options: ['any', 'keyword'], defaultValue: 'any', description: '"any" fires on every DM; "keyword" only fires when the message text matches one of the listed keywords.' },
            { name: 'keywords', type: 'string', description: 'Only used when filterMode = "keyword". Comma-separated, e.g. "price, qiymet".' },
            { name: 'matchMode', type: 'select', options: ['contains', 'exact', 'starts', 'regex'], defaultValue: 'contains' },
            { name: 'caseSensitive', type: 'boolean', defaultValue: false },
        ],
    },
    trigger_ig_new_contact: {
        id: 'trigger_ig_new_contact',
        category: 'trigger', channel: 'instagram',
        label: 'Instagram · New Contact',
        description: 'Fires the first time an Instagram contact DMs this account.',
        fields: [
            { name: 'accountId', type: 'select', description: 'Instagram account id, or "any"', defaultValue: 'any' },
        ],
    },
    // Post trigger — activated by any post event we support (currently
    // comments; reactions / mentions can plug in here later without a
    // renaming break). Renamed from trigger_ig_comment.
    trigger_ig_post: {
        id: 'trigger_ig_post',
        category: 'trigger', channel: 'instagram',
        label: 'Instagram · Post',
        description: 'Fires when someone interacts with a post. Filter by a specific post or any post, and optionally require a keyword in the comment text. Wire it to any of the Instagram comment/DM actions.',
        fields: [
            { name: 'accountId', type: 'select', description: 'Instagram account id, or "any"', defaultValue: 'any' },
            { name: 'mediaId', type: 'string', description: 'Specific Instagram media (post) id, or "any" for every post', defaultValue: 'any' },
            ...KEYWORD_FIELDS.map(f => f.name === 'keywords' ? { ...f, required: false } : f),
        ],
    },

    // ─── WhatsApp actions ───
    action_wa_send_message: {
        id: 'action_wa_send_message',
        category: 'action', channel: 'whatsapp',
        label: 'WhatsApp · Send Message',
        description: 'Sends a WhatsApp DM. Can include text, a media attachment (image / video / audio / document), or both. When both are present, the text becomes the caption for image / video / document.',
        fields: [
            { name: 'text', type: 'string', description: 'Reply text. Supports variables {{name}}, {{message}}.' },
            { name: 'media', type: 'media', description: 'Optional attachment: { kind: image|video|audio|document, url, caption?, filename? }' },
        ],
    },

    // ─── Instagram actions ───
    action_ig_send_dm: {
        id: 'action_ig_send_dm',
        category: 'action', channel: 'instagram',
        label: 'Instagram · Send DM',
        description: 'Sends an Instagram DM. Can include text, a media attachment (image / video / audio), and quick reply buttons. Documents fall back to a plain text link because IG does not accept them.',
        fields: [
            { name: 'text', type: 'string', description: 'DM text. Supports {{username}}, {{comment}}, {{post_url}}.' },
            { name: 'media', type: 'media', description: 'Optional attachment: { kind: image|video|audio, url }' },
            { name: 'quickReplies', type: 'array', description: 'Array of { title, payload? }, max 13 buttons.' },
        ],
    },
    action_ig_reply_comment: {
        id: 'action_ig_reply_comment',
        category: 'action', channel: 'instagram',
        label: 'Instagram · Reply Comment',
        description: 'Posts a public reply on the comment that triggered the automation. Requires the instagram_business_manage_comments permission to actually publish.',
        fields: [
            { name: 'text', type: 'string', required: true, description: 'Reply text. Supports {{username}}, {{comment}}.' },
        ],
    },
    action_ig_hide_comment: {
        id: 'action_ig_hide_comment',
        category: 'action', channel: 'instagram',
        label: 'Instagram · Hide Comment',
        description: 'Hides the comment that triggered the automation from public view. The commenter can still see their own comment but nobody else can. Useful for handling spam / abuse without an audit-trail hit. Reversible via Meta UI.',
        fields: [],
    },
    action_ig_delete_comment: {
        id: 'action_ig_delete_comment',
        category: 'action', channel: 'instagram',
        label: 'Instagram · Delete Comment',
        description: 'Permanently deletes the comment that triggered the automation. Irreversible; prefer Hide Comment when in doubt.',
        fields: [],
    },

    // ─── Generic actions ───
    action_ai_reply: {
        id: 'action_ai_reply',
        category: 'action', channel: 'generic',
        label: 'AI Agent Reply',
        description: 'Hands the conversation to a configured AI agent. The agent generates a reply using its skills (CRM, tables, memory, HTTP).',
        fields: [
            { name: 'agentId', type: 'string', required: true, description: 'Id of the agent to invoke.' },
        ],
    },
    action_add_tag: {
        id: 'action_add_tag',
        category: 'action', channel: 'generic',
        label: 'Add Tag',
        description: 'Adds a tag to the contact in CRM. Creates the contact if missing.',
        fields: [
            { name: 'tag', type: 'string', required: true },
        ],
    },
    action_set_user_field: {
        id: 'action_set_user_field',
        category: 'action', channel: 'generic',
        label: 'Set User Field',
        description: 'Writes a value into a user-defined custom field on the contact. Use the field key (slug), not the label. Values support variables like {{message}} or {{name}}.',
        fields: [
            { name: 'fieldKey', type: 'select', required: true, description: 'Slug of one of the custom fields defined under Contacts → Manage Fields.' },
            { name: 'value', type: 'string', required: true, description: 'The value to store. Variables: {{message}}, {{name}}, {{username}}, {{comment}}, {{post_url}}.' },
        ],
    },
    action_wait: {
        id: 'action_wait',
        category: 'action', channel: 'generic',
        label: 'Wait / Delay',
        description: 'Pauses the automation for N seconds before running the next node. Capped at 120 seconds.',
        fields: [
            { name: 'seconds', type: 'number', required: true, defaultValue: 60 },
        ],
    },

    // ─── Logic ───
    condition: {
        id: 'condition',
        category: 'logic', channel: 'generic',
        label: 'Condition',
        description: 'Branches on a field (message text / contact tag / CRM status). Has true and false outputs.',
        fields: [
            { name: 'field', type: 'select', options: ['message', 'tag', 'status'], required: true },
            { name: 'operator', type: 'select', options: ['contains', 'equals', 'not_equals'], required: true },
            { name: 'value', type: 'string', required: true },
        ],
    },

    // ─── Legacy (kept for backward compat with saved automations) ───
    trigger_keyword: {
        id: 'trigger_keyword', category: 'trigger', channel: 'generic', legacy: true,
        label: 'Keyword Trigger (legacy)',
        description: 'Older generic keyword trigger with a channel selector. Prefer trigger_wa_keyword / trigger_ig_keyword.',
        fields: [
            { name: 'channel', type: 'select', options: ['any', 'whatsapp', 'instagram'], defaultValue: 'any' },
            ...KEYWORD_FIELDS,
        ],
    },
    trigger_any_message: {
        id: 'trigger_any_message', category: 'trigger', channel: 'generic', legacy: true,
        label: 'Any Message (legacy)',
        description: 'Older generic "any message" trigger with a channel selector.',
        fields: [
            { name: 'channel', type: 'select', options: ['any', 'whatsapp', 'instagram'], defaultValue: 'any' },
        ],
    },
    trigger_new_contact: {
        id: 'trigger_new_contact', category: 'trigger', channel: 'generic', legacy: true,
        label: 'New Contact (legacy)',
        description: 'Older generic "new contact" trigger.',
        fields: [
            { name: 'channel', type: 'select', options: ['any', 'whatsapp', 'instagram'], defaultValue: 'any' },
        ],
    },
    trigger_comment: {
        id: 'trigger_comment', category: 'trigger', channel: 'instagram', legacy: true,
        label: 'IG Comment (legacy)',
        description: 'Older Instagram comment trigger; aliased to trigger_ig_post.',
        fields: [
            { name: 'accountId', type: 'select', defaultValue: 'any' },
            { name: 'mediaId', type: 'string', defaultValue: 'any' },
            ...KEYWORD_FIELDS.map(f => f.name === 'keywords' ? { ...f, required: false } : f),
        ],
    },
    trigger_ig_any: {
        id: 'trigger_ig_any', category: 'trigger', channel: 'instagram', legacy: true,
        label: 'IG Any DM (legacy)',
        description: 'Older Instagram DM trigger. Prefer trigger_ig_dm with filterMode=any.',
        fields: [
            { name: 'accountId', type: 'select', defaultValue: 'any' },
        ],
    },
    trigger_ig_keyword: {
        id: 'trigger_ig_keyword', category: 'trigger', channel: 'instagram', legacy: true,
        label: 'IG DM Keyword (legacy)',
        description: 'Older Instagram DM keyword trigger. Prefer trigger_ig_dm with filterMode=keyword.',
        fields: [
            { name: 'accountId', type: 'select', defaultValue: 'any' },
            ...KEYWORD_FIELDS,
        ],
    },
    trigger_ig_comment: {
        id: 'trigger_ig_comment', category: 'trigger', channel: 'instagram', legacy: true,
        label: 'IG Comment (legacy)',
        description: 'Older Instagram comment trigger. Prefer trigger_ig_post.',
        fields: [
            { name: 'accountId', type: 'select', defaultValue: 'any' },
            { name: 'mediaId', type: 'string', defaultValue: 'any' },
            ...KEYWORD_FIELDS.map(f => f.name === 'keywords' ? { ...f, required: false } : f),
        ],
    },
    action_send_message: {
        id: 'action_send_message', category: 'action', channel: 'generic', legacy: true,
        label: 'Send Message (legacy)',
        description: 'Older text-only send. Prefer action_wa_send_message.',
        fields: [{ name: 'text', type: 'string', required: true }],
    },
    action_send_media: {
        id: 'action_send_media', category: 'action', channel: 'generic', legacy: true,
        label: 'Send Media (legacy)',
        description: 'Older standalone media send. Media is now part of action_wa_send_message / action_ig_send_dm.',
        fields: [
            { name: 'mediaKind', type: 'select', options: ['image', 'video', 'audio', 'document'], required: true },
            { name: 'url', type: 'string', required: true },
            { name: 'caption', type: 'string' },
            { name: 'filename', type: 'string' },
        ],
    },
    action_send_dm: {
        id: 'action_send_dm', category: 'action', channel: 'instagram', legacy: true,
        label: 'Send IG DM (legacy)',
        description: 'Older Instagram DM with text / attachment / template variants. Prefer action_ig_send_dm.',
        fields: [
            { name: 'kind', type: 'select', options: ['text', 'attachment', 'template'], required: true },
            { name: 'text', type: 'string' },
            { name: 'attachmentType', type: 'select', options: ['image', 'video', 'audio'] },
            { name: 'url', type: 'string' },
            { name: 'elements', type: 'array', description: 'Template cards' },
            { name: 'quickReplies', type: 'array' },
        ],
    },
    action_reply_comment: {
        id: 'action_reply_comment', category: 'action', channel: 'instagram', legacy: true,
        label: 'Reply Comment (legacy)',
        description: 'Older alias for action_ig_reply_comment.',
        fields: [{ name: 'text', type: 'string', required: true }],
    },
};

export const ACTIVE_NODE_TYPES = Object.values(AUTOMATION_NODES)
    .filter(n => !n.legacy)
    .map(n => n.id);

export function getNodeSpec(typeId: string): AutomationNodeSpec | undefined {
    return AUTOMATION_NODES[typeId];
}

export function isValidNodeType(typeId: string): boolean {
    return typeId in AUTOMATION_NODES;
}

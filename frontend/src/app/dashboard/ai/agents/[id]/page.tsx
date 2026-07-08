"use client";

import { useEffect, useRef, useState, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bot, Loader2, MessageSquare, BarChart3, Settings, Database, Wrench, Wifi, WifiOff, Power, Plus, Trash2, ChevronDown, ChevronRight, Sparkles, Play, Send, User, Activity, CheckCircle2, XCircle, ChevronsRight, FlaskConical, RefreshCw, Copy, Pause, Bell, Maximize2, Minimize2, X as XIcon, Save, Check, Plug } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";
import { motion } from "framer-motion";

type Tab = "conversations" | "usage" | "activity" | "test" | "settings";

type TestTurn =
    | { id: string; role: 'user'; content: string }
    | { id: string; role: 'assistant'; content: string; toolCalls: ActivityToolCall[]; tokens?: { prompt: number; completion: number; total: number } };

type ActivityToolCall = {
    toolName: string;
    args: any;
    result: any;
    ok: boolean;
    error?: string;
};

type ActivityItem = {
    id: string;
    createdAt: string;
    contactPhone: string | null;
    contactName: string | null;
    channel: 'whatsapp' | 'instagram';
    userMessage: string;
    agentReply: string;
    toolCalls: ActivityToolCall[];
    durationMs: number;
};

// Inline Google Calendar brand logo. Uses Google's four brand colors
// so the connector card is instantly recognisable — the "Google
// Calendar" label alone reads generic, the mark makes it obvious.
function GoogleCalendarLogo({ className = "" }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={`w-5 h-5 flex-shrink-0 ${className}`} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <rect x="2.5" y="2.5" width="19" height="19" rx="2.5" fill="#ffffff" stroke="#dadce0" strokeWidth="0.5" />
            {/* Colored corner ribbon */}
            <path d="M2.5 5a2.5 2.5 0 0 1 2.5-2.5h14a2.5 2.5 0 0 1 2.5 2.5v1.75H2.5V5z" fill="#4285F4" />
            {/* 31 numeral, Google-blue */}
            <text x="12" y="17.6" fontFamily="'Google Sans','Roboto',Arial,sans-serif" fontSize="9" fontWeight="700" fill="#4285F4" textAnchor="middle">31</text>
        </svg>
    );
}

// Mirror of backend DEFAULT_SKILL_PROMPTS in src/modules/agent/ai.service.ts.
// Each entry is the BARE tool-usage rule — any prompt the owner writes
// in the skill panel is APPENDED to this, not replacing it.
const DEFAULT_SKILL_PROMPTS: Record<string, string> = {
    tables: 'Tables: call listTables first, then searchTable or getTableRows.',
    crm: 'CRM: upsertClient saves/updates, getClient looks up, searchClients finds existing.',
    user_fields: 'User fields: listUserFields first to see schema, setUserField to save, getUserField to recall, searchContactsByField to filter across contacts.',
    http: 'HTTP: call the dedicated tools listed below.',
    memory: 'Memory: conversationStats (overview), searchMessages, getMessages (range), getMessagesAround (context). Only call when older context is actually needed.',
    self_pause: 'Self-pause: pauseAgent({reason}) stops auto-replies for this contact until a human resumes from the inbox.',
    live_operator: 'Live operator: listOperators, then askOperator({operatorId, question}). System delivers the reply — write a short holding line after asking.',
    reminder: 'Reminder: when the latest user turn carries [REMINDER_TURN: customer silent for Xh], write ONE short warm follow-up based on history. No restart, no verbatim repeat, no apology for writing again.',
    polls: 'Polls: sendPoll({name, options, multi?}) sends an interactive choice question — the poll itself IS the question, so write NO chat text in the same turn (no greeting before or after, the customer sees both at once otherwise). After the customer taps, their pick arrives as the next user turn with the option name as content; treat that as their answer and move on. NEVER re-send the same poll just because you saw a previous one; if the answer is in history, use it.',
    google_calendar: 'Google Calendar: listCalendarEvents to check availability before proposing a slot, createCalendarEvent to book once the customer confirms date+time+attendee email. Time values must be full ISO strings with timezone (e.g. 2026-07-10T14:00:00+04:00). Always echo the confirmed slot back to the customer in their own words after createCalendarEvent succeeds. cancelCalendarEvent removes a booking by id.',
};

type ValueSpec =
    | { mode: "fixed"; value: string }
    | { mode: "ai"; description: string };

type NameValue = { name: string; value: ValueSpec };

type HttpAuth =
    | { type: "none" }
    | { type: "bearer"; token: string }
    | { type: "basic"; username: string; password: string };

type HttpToolTemplate = {
    id: string;
    name: string;
    description: string;
    inputMode?: "form" | "raw";
    rawRequest?: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: ValueSpec;
    auth?: HttpAuth;
    queryParams?: NameValue[];
    headers?: NameValue[];
    bodyType?: "none" | "json" | "raw";
    bodyParams?: NameValue[];
    rawBody?: ValueSpec;
};

const RAW_REQUEST_PLACEHOLDER = `POST https://api.example.com/orders
Content-Type: application/json
Authorization: Bearer {{API key from session}}

{
  "customer": "{{customer name from conversation}}",
  "quantity": {{quantity number}}
}`;

type Operator = {
    id: string;
    name: string;
    phone: string;
    systemPrompt: string | null;
    order: number;
    timeoutMin: number;
    isActive: boolean;
    // local-only flag for unsaved newly-added rows
    _new?: boolean;
};

const newTool = (): HttpToolTemplate => ({
    id: Math.random().toString(36).slice(2),
    name: "newTool",
    description: "",
    inputMode: "form",
    rawRequest: "",
    method: "GET",
    url: { mode: "fixed", value: "" },
    auth: { type: "none" },
    queryParams: [],
    headers: [],
    bodyType: "none",
    bodyParams: [],
    rawBody: { mode: "fixed", value: "" }
});

// Value input: switchable between Fixed value and AI-described
function ValueInput({ spec, onChange, placeholder, multiline = false, inputRef }: {
    spec: ValueSpec;
    onChange: (v: ValueSpec) => void;
    placeholder?: string;
    multiline?: boolean;
    inputRef?: React.Ref<HTMLTextAreaElement | HTMLInputElement>;
}) {
    const value = spec.mode === "fixed" ? spec.value : spec.description;
    const handleChange = (v: string) => onChange(spec.mode === "fixed" ? { mode: "fixed", value: v } : { mode: "ai", description: v });
    const ph = spec.mode === "ai" ? "Describe what AI should put here" : (placeholder || "");

    return (
        <div className={`flex gap-1.5 ${multiline ? 'items-stretch' : ''}`}>
            <button
                type="button"
                onClick={() => onChange(spec.mode === "fixed" ? { mode: "ai", description: "" } : { mode: "fixed", value: "" })}
                title={spec.mode === "fixed" ? "Switch to AI-filled" : "Switch to fixed value"}
                className={`flex-shrink-0 flex items-center gap-1 px-2 ${multiline ? 'py-1.5 self-start' : ''} rounded-lg border text-xs font-medium transition-colors ${spec.mode === "ai" ? "bg-amber-500/10 text-amber-400 border-amber-500/30" : "bg-secondary/50 text-muted-foreground border-border hover:text-foreground"}`}
            >
                {spec.mode === "ai" ? <><Sparkles className="w-3 h-3" /> AI</> : "Fixed"}
            </button>
            {multiline ? (
                <textarea
                    ref={inputRef as React.Ref<HTMLTextAreaElement>}
                    value={value}
                    onChange={e => handleChange(e.target.value)}
                    placeholder={ph}
                    rows={4}
                    className="flex-1 min-h-[80px] bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono resize-y"
                />
            ) : (
                <input
                    ref={inputRef as React.Ref<HTMLInputElement>}
                    type="text"
                    value={value}
                    onChange={e => handleChange(e.target.value)}
                    placeholder={ph}
                    className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                />
            )}
        </div>
    );
}

// Drop-down panel listing all the {{contact:*}} and {{field:*}}
// placeholders the executor knows how to resolve, with a copy button
// per entry. Used inside HTTP tool editors so users can paste a token
// into the URL / header / body without remembering the syntax.
function PlaceholdersPanel({ userFields, httpTools, currentToolName, onCopy }: {
    userFields: { key: string; label: string }[];
    httpTools: HttpToolTemplate[];
    currentToolName?: string;
    onCopy: (token: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const contactTokens = [
        { token: "{{contact:name}}", label: "Contact name (Client.name)" },
        { token: "{{contact:phone}}", label: "Phone digits" },
        { token: "{{contact:status}}", label: "CRM status (NEW, LEAD, ...)" },
        { token: "{{contact:summary}}", label: "AI summary of the conversation" },
        { token: "{{contact:tags}}", label: "Comma-separated tags" },
    ];
    // Other HTTP tools in this agent — their results are addressable
    // via {{prev:<name>.<json.path>}} within the same agent turn.
    const otherTools = (httpTools || []).filter(t => t.name && t.name !== currentToolName);
    const copy = async (t: string) => {
        try { await navigator.clipboard.writeText(t); onCopy(t); } catch { /* fallthrough */ }
    };
    const totalCount = contactTokens.length + userFields.length + otherTools.length * 2;
    return (
        <div className="border border-border rounded-xl bg-secondary/20">
            <button type="button" onClick={() => setOpen(o => !o)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-secondary/30 transition-colors">
                {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Show available placeholders ({totalCount})
            </button>
            {open && (
                <div className="border-t border-border p-3 space-y-3">
                    <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Contact</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                            {contactTokens.map(t => (
                                <PlaceholderRow key={t.token} token={t.token} label={t.label} onCopy={copy} />
                            ))}
                        </div>
                    </div>
                    <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">User fields ({userFields.length})</div>
                        {userFields.length === 0 ? (
                            <div className="text-xs text-muted-foreground italic">No user fields defined yet. Add them in Settings → User Fields.</div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                                {userFields.map(f => (
                                    <PlaceholderRow key={f.key} token={`{{field:${f.key}}}`} label={f.label} onCopy={copy} />
                                ))}
                            </div>
                        )}
                    </div>
                    <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                            Previous tool results · {'{{prev:<tool>.<json.path>}}'}
                        </div>
                        {otherTools.length === 0 ? (
                            <div className="text-xs text-muted-foreground italic">Add at least one other HTTP tool to reference its result here.</div>
                        ) : (
                            <div className="space-y-2">
                                {otherTools.map(t => (
                                    <div key={t.id}>
                                        <div className="text-[11px] text-foreground font-medium mb-1">
                                            {t.name} <span className="text-muted-foreground font-normal">{t.method} {(t.url?.mode === 'fixed' ? t.url.value : '')?.split('?')[0]}</span>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                                            <PlaceholderRow
                                                token={`{{prev:${t.name}.data.result}}`}
                                                label={`${t.name} response body → data.result (typical Bitrix id)`}
                                                onCopy={copy} />
                                            <PlaceholderRow
                                                token={`{{prev:${t.name}.status}}`}
                                                label={`${t.name} HTTP status code`}
                                                onCopy={copy} />
                                        </div>
                                    </div>
                                ))}
                                <div className="text-[11px] text-muted-foreground italic">
                                    Tip: any JSON path works — e.g. <code>{'{{prev:my_tool.data.items.0.id}}'}</code>.
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Distribution helpers — server-side random + round-robin */}
                    <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                            Distribution · pick a value at call time
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                            <PlaceholderRow
                                token={'{{random:7,9}}'}
                                label="Pick a value uniformly at random (good for Bitrix ASSIGNED_BY_ID rotation)"
                                onCopy={copy} />
                            <PlaceholderRow
                                token={'{{rotate:7,9}}'}
                                label="Round-robin between values, sticky across calls (per-workspace counter)"
                                onCopy={copy} />
                        </div>
                        <div className="text-[11px] text-muted-foreground italic mt-1.5">
                            Both accept any comma-separated list (numbers or strings). The LLM never sees these — the server picks at call time.
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function PlaceholderRow({ token, label, onCopy }: { token: string; label: string; onCopy: (t: string) => void }) {
    const [copied, setCopied] = useState(false);
    return (
        <button type="button"
            onClick={() => { onCopy(token); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
            className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-background/40 hover:bg-background/70 transition-colors text-left">
            <div className="min-w-0">
                <code className="text-[11px] text-foreground truncate block">{token}</code>
                <div className="text-[10px] text-muted-foreground truncate">{label}</div>
            </div>
            {copied
                ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                : <Copy className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
        </button>
    );
}

function NameValueRows({ items, onChange, namePlaceholder }: { items: NameValue[]; onChange: (next: NameValue[]) => void; namePlaceholder: string }) {
    return (
        <div className="space-y-2">
            {items.map((it, i) => (
                <div key={i} className="flex gap-1.5 items-start">
                    <input
                        type="text"
                        value={it.name}
                        onChange={e => { const n = [...items]; n[i] = { ...it, name: e.target.value }; onChange(n); }}
                        placeholder={namePlaceholder}
                        className="w-40 flex-shrink-0 bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                    />
                    <div className="flex-1">
                        <ValueInput spec={it.value} onChange={v => { const n = [...items]; n[i] = { ...it, value: v }; onChange(n); }} placeholder="value" />
                    </div>
                    <button
                        type="button"
                        onClick={() => onChange(items.filter((_, j) => j !== i))}
                        className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Remove"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            ))}
            <button
                type="button"
                onClick={() => onChange([...items, { name: "", value: { mode: "fixed", value: "" } }])}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 border border-dashed border-border transition-colors"
            >
                <Plus className="w-3 h-3" /> Add
            </button>
        </div>
    );
}

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const navigate = useRouter();
    const [agent, setAgent] = useState<any>(null);
    const [providers, setProviders] = useState<any[]>([]);
    const [tables, setTables] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<Tab>("usage");

    // Conversations state
    const [conversations, setConversations] = useState<any[]>([]);
    const [selectedJid, setSelectedJid] = useState<string | null>(null);
    const [chatMessages, setChatMessages] = useState<any[]>([]);
    const [loadingChat, setLoadingChat] = useState(false);
    const [replyText, setReplyText] = useState("");
    const [sendingReply, setSendingReply] = useState(false);
    const [replyError, setReplyError] = useState<string | null>(null);

    // Stats state
    const [stats, setStats] = useState<any>(null);

    // Activity tab
    const [activity, setActivity] = useState<ActivityItem[]>([]);
    const [activityLoading, setActivityLoading] = useState(false);
    const [activityHasMore, setActivityHasMore] = useState(false);
    const [activityOnlyErrors, setActivityOnlyErrors] = useState(false);
    const [expandedActivityIds, setExpandedActivityIds] = useState<Set<string>>(new Set());

    // Test tab — entirely ephemeral, lives in component state so refresh wipes it.
    const [testContacts, setTestContacts] = useState<any[]>([]);
    const [testContactSearch, setTestContactSearch] = useState("");
    const [testSelectedContact, setTestSelectedContact] = useState<any | null>(null);
    const [testContactHistory, setTestContactHistory] = useState<any[]>([]);
    const [testLoadingContacts, setTestLoadingContacts] = useState(false);
    const [testTurns, setTestTurns] = useState<TestTurn[]>([]);
    const [testInput, setTestInput] = useState("");
    const [testSending, setTestSending] = useState(false);
    const [testError, setTestError] = useState<string | null>(null);
    const [expandedTestToolIds, setExpandedTestToolIds] = useState<Set<string>>(new Set());

    // Settings form
    const [name, setName] = useState("");
    const [providerId, setProviderId] = useState("");
    const [model, setModel] = useState("");
    const [systemPrompt, setSystemPrompt] = useState("");
    const [allowedTableIds, setAllowedTableIds] = useState<string[]>([]);
    const [skills, setSkills] = useState<string[]>([]);
    const [httpTools, setHttpTools] = useState<HttpToolTemplate[]>([]);
    const [audioEnabled, setAudioEnabled] = useState(true);
    const [visionEnabled, setVisionEnabled] = useState(true);
    const [historyDepth, setHistoryDepth] = useState(10);
    const [reminderHours, setReminderHours] = useState(24);
    const [promptModalOpen, setPromptModalOpen] = useState(false);
    const [promptInlineRows, setPromptInlineRows] = useState(6);
    const [whisperLanguage, setWhisperLanguage] = useState<string>("");
    const [whisperModel, setWhisperModel] = useState<string>("whisper-1");
    const [isRouter, setIsRouter] = useState(false);
    const [routerDescription, setRouterDescription] = useState("");
    const [routableAgentIds, setRoutableAgentIds] = useState<string[]>([]);
    const [siblingAgents, setSiblingAgents] = useState<{ id: string; name: string }[]>([]);
    const [operators, setOperators] = useState<Operator[]>([]);
    const [userFields, setUserFields] = useState<{ key: string; label: string }[]>([]);
    const [aiModels, setAiModels] = useState<Record<string, string[]>>({});
    const [expandedTool, setExpandedTool] = useState<string | null>(null);
    const [testStates, setTestStates] = useState<Record<string, { values: Record<string, string>; response: any; loading: boolean }>>({});
    const [skillPrompts, setSkillPrompts] = useState<Record<string, string>>({});
    // Google Calendar connection status — refreshed on mount so the
    // google_calendar skill card can show either a Connect CTA or the
    // linked account. Kept out of the agent PUT payload; the workspace
    // owns the connection, not individual agents.
    const [googleCalendarStatus, setGoogleCalendarStatus] = useState<{ connected: boolean; email: string | null; calendarId: string | null } | null>(null);
    // Which enabled skill cards have their config panel visible. A
    // skill toggling ON auto-expands; toggling OFF removes it. Manually
    // collapsing keeps the skill enabled but hides the long panel so
    // the Skills section stays scannable.
    const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                const [agentRes, provRes, tablesRes, fieldsRes, modelsRes] = await Promise.all([
                    api.get(`/agents/${id}`),
                    api.get('/ai-providers'),
                    api.get('/tables'),
                    api.get('/user-fields').catch(() => ({ data: { success: false } })),
                    api.get('/ai-providers/models').catch(() => ({ data: { success: false } })),
                ]);
                if (fieldsRes.data?.success) {
                    setUserFields((fieldsRes.data.fields || []).map((f: any) => ({ key: f.key, label: f.label || f.key })));
                }
                if (modelsRes.data?.success) {
                    setAiModels(modelsRes.data.models || {});
                }
                if (agentRes.data.success) {
                    const a = agentRes.data.agent;
                    // Router agents have their own dedicated editor — bounce
                    // the user there so the sidebar highlights "Router
                    // Agents" and the layout shows the focused router UI.
                    if (a.isRouter) {
                        navigate.replace(`/dashboard/ai/routers/${id}`);
                        return;
                    }
                    setAgent(a);
                    setName(a.name);
                    setProviderId(a.providerId);
                    setModel(a.model);
                    setSystemPrompt(a.systemPrompt || "");
                    setAllowedTableIds(a.allowedTableIds || []);
                    setSkills(a.skills || []);
                    setHttpTools(((a.httpTools as HttpToolTemplate[]) || []).map((t: any) => ({
                        ...t,
                        id: t.id || Math.random().toString(36).slice(2)
                    })));
                    setSkillPrompts((a.skillPrompts as Record<string, string>) || {});
                    setAudioEnabled(a.audioEnabled !== false);
                    setVisionEnabled(a.visionEnabled !== false);
                    setHistoryDepth(Number(a.historyDepth) || 10);
                    setReminderHours(Number(a.reminderHours) || 24);
                    setWhisperLanguage(a.whisperLanguage || "");
                    setWhisperModel(a.whisperModel || "whisper-1");
                    setIsRouter(!!a.isRouter);
                    setRouterDescription(a.routerDescription || "");
                    setRoutableAgentIds((a.routableAgentIds || []) as string[]);
                    // Load the rest of the workspace's AI agents so we can
                    // render a "Targets" picker if this agent is a router.
                    try {
                        const sibs = await api.get('/agents', { params: { type: 'ai' } });
                        if (sibs.data?.success) {
                            setSiblingAgents((sibs.data.agents || []).map((x: any) => ({ id: x.id, name: x.name })));
                        }
                    } catch { /* not critical */ }
                }
                if (provRes.data.success) setProviders(provRes.data.providers);
                if (tablesRes.data.success) setTables(tablesRes.data.tables);
                // Operators live in their own table — load alongside the
                // agent so the Live Operators panel populates instantly.
                try {
                    const opsRes = await api.get(`/operators/agent/${id}`);
                    if (opsRes.data?.success) setOperators(opsRes.data.operators || []);
                } catch { /* not critical */ }
                // Google Calendar connection status — for the skill CTA.
                try {
                    const gcRes = await api.get('/google/oauth/status');
                    if (gcRes.data?.success) setGoogleCalendarStatus({
                        connected: !!gcRes.data.connected,
                        email: gcRes.data.email,
                        calendarId: gcRes.data.calendarId,
                    });
                } catch { /* not critical */ }
            } catch (err) { console.error(err); }
            finally { setLoading(false); }
        };
        load();
    }, [id]);

    useEffect(() => {
        if (tab === "conversations") loadConversations();
        if (tab === "usage") loadStats();
        if (tab === "activity") loadActivity(false);
        if (tab === "test" && testContacts.length === 0) loadTestContacts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, activityOnlyErrors]);

    const loadTestContacts = async () => {
        setTestLoadingContacts(true);
        try {
            const r = await api.get('/clients?limit=200');
            if (r.data?.success) setTestContacts(r.data.clients || []);
        } catch (e) { console.error(e); }
        finally { setTestLoadingContacts(false); }
    };

    const selectTestContact = async (c: any) => {
        setTestSelectedContact(c);
        setTestTurns([]);
        setTestInput('');
        setTestError(null);
        setExpandedTestToolIds(new Set());
        setTestContactHistory([]);
        // Best-effort: pull the last messages this contact had with ANY
        // instance in the workspace for visual context.
        try {
            const inst = await api.get('/instances');
            const instances = inst.data?.instances || [];
            if (instances.length > 0 && c?.phone) {
                const guess = instances[0].id;
                const r = await api.get(`/inbox/messages?accountId=${guess}&remoteJid=${encodeURIComponent(c.phone + '@s.whatsapp.net')}&limit=20`);
                if (r.data?.success) setTestContactHistory(r.data.messages || []);
            }
        } catch { /* not critical */ }
    };

    const sendTestMessage = async () => {
        if (!testSelectedContact || !testInput.trim() || testSending) return;
        const userText = testInput.trim();
        const userTurn: TestTurn = { id: `u-${Date.now()}`, role: 'user', content: userText };
        setTestTurns(prev => [...prev, userTurn]);
        setTestInput('');
        setTestSending(true);
        setTestError(null);
        try {
            const sessionMessages = testTurns.map(t => ({ role: t.role, content: t.content }));
            const r = await api.post(`/agents/${id}/test-as-contact`, {
                contactPhone: testSelectedContact.phone,
                userMessage: userText,
                sessionMessages,
            });
            if (r.data?.success) {
                const asst: TestTurn = {
                    id: `a-${Date.now()}`,
                    role: 'assistant',
                    content: r.data.reply || '',
                    toolCalls: r.data.toolCalls || [],
                    tokens: r.data.tokens,
                };
                setTestTurns(prev => [...prev, asst]);
            } else {
                setTestError(r.data?.message || 'Unknown error');
            }
        } catch (e: any) {
            setTestError(e.response?.data?.message || e.message);
        } finally {
            setTestSending(false);
        }
    };

    const clearTestSession = () => {
        setTestTurns([]);
        setTestInput('');
        setTestError(null);
        setExpandedTestToolIds(new Set());
    };

    const toggleTestToolExpand = (turnId: string) => {
        setExpandedTestToolIds(prev => {
            const next = new Set(prev);
            if (next.has(turnId)) next.delete(turnId); else next.add(turnId);
            return next;
        });
    };

    const loadActivity = async (loadMore: boolean) => {
        setActivityLoading(true);
        try {
            const params = new URLSearchParams({ limit: '50' });
            if (activityOnlyErrors) params.set('onlyErrors', 'true');
            if (loadMore && activity.length > 0) {
                params.set('before', activity[activity.length - 1].createdAt);
            }
            const res = await api.get(`/agents/${id}/activity?${params.toString()}`);
            if (res.data.success) {
                setActivity(loadMore ? [...activity, ...res.data.items] : res.data.items);
                setActivityHasMore(!!res.data.hasMore);
            }
        } catch (err) { console.error(err); }
        finally { setActivityLoading(false); }
    };

    const toggleActivityExpand = (rowId: string) => {
        setExpandedActivityIds(prev => {
            const next = new Set(prev);
            if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
            return next;
        });
    };

    const loadConversations = async () => {
        try {
            const res = await api.get(`/agents/${id}/conversations`);
            if (res.data.success) setConversations(res.data.conversations);
        } catch (err) { console.error(err); }
    };

    const loadStats = async () => {
        try {
            const res = await api.get(`/agents/${id}/stats`);
            if (res.data.success) setStats(res.data);
        } catch (err) { console.error(err); }
    };

    const loadChat = async (jid: string) => {
        setSelectedJid(jid);
        setLoadingChat(true);
        setReplyText("");
        setReplyError(null);
        try {
            const res = await api.get(`/agents/${id}/messages?remoteJid=${encodeURIComponent(jid)}`);
            if (res.data.success) setChatMessages(res.data.messages);
        } catch (err) { console.error(err); }
        finally { setLoadingChat(false); }
    };

    const sendReply = async () => {
        if (!selectedJid || !replyText.trim()) return;
        setSendingReply(true);
        setReplyError(null);
        try {
            const res = await api.post(`/agents/${id}/reply`, { remoteJid: selectedJid, text: replyText.trim() });
            if (res.data.success) {
                setChatMessages(prev => [...prev, res.data.message]);
                setReplyText("");
            } else {
                setReplyError(res.data.message || 'Failed to send');
            }
        } catch (err: any) {
            setReplyError(err.response?.data?.message || err.message || 'Failed to send');
        } finally {
            setSendingReply(false);
        }
    };

    // Collect AI-mode fields a test panel needs (URL, each AI query/header/body param, raw body)
    const aiFieldsOf = (tool: HttpToolTemplate): { key: string; label: string }[] => {
        const out: { key: string; label: string }[] = [];

        if (tool.inputMode === 'raw') {
            // Extract {{description}} placeholders from rawRequest
            const text = tool.rawRequest || '';
            const seen = new Set<string>();
            const re = /\{\{([^}]+)\}\}/g;
            let m: RegExpExecArray | null;
            let idx = 0;
            while ((m = re.exec(text)) !== null) {
                const desc = m[1].trim();
                if (seen.has(desc)) continue;
                seen.add(desc);
                out.push({ key: `ai_${idx}`, label: desc });
                idx++;
            }
            return out;
        }

        if (tool.url.mode === 'ai') out.push({ key: 'url', label: 'URL — ' + tool.url.description });
        (tool.queryParams || []).forEach(p => {
            if (p.value.mode === 'ai') out.push({ key: `query.${p.name}`, label: `?${p.name} — ${p.value.description}` });
        });
        (tool.headers || []).forEach(h => {
            if (h.value.mode === 'ai') out.push({ key: `header.${h.name}`, label: `${h.name}: — ${h.value.description}` });
        });
        if (tool.bodyType === 'json') {
            (tool.bodyParams || []).forEach(b => {
                if (b.value.mode === 'ai') out.push({ key: `body.${b.name}`, label: `body.${b.name} — ${b.value.description}` });
            });
        } else if (tool.bodyType === 'raw' && tool.rawBody?.mode === 'ai') {
            out.push({ key: 'body', label: 'Raw body — ' + tool.rawBody.description });
        }
        return out;
    };

    const runTest = async (tool: HttpToolTemplate) => {
        const current = testStates[tool.id] || { values: {}, response: null, loading: false };
        setTestStates(prev => ({ ...prev, [tool.id]: { ...current, loading: true } }));
        try {
            const res = await api.post(`/agents/test-http-tool`, { template: tool, aiValues: current.values });
            setTestStates(prev => ({ ...prev, [tool.id]: { ...current, loading: false, response: res.data.result ?? res.data } }));
        } catch (err: any) {
            setTestStates(prev => ({ ...prev, [tool.id]: { ...current, loading: false, response: { error: err.response?.data?.message || err.message } } }));
        }
    };

    const setTestValue = (toolId: string, key: string, value: string) => {
        setTestStates(prev => {
            const cur = prev[toolId] || { values: {}, response: null, loading: false };
            return { ...prev, [toolId]: { ...cur, values: { ...cur.values, [key]: value } } };
        });
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.put(`/agents/${id}`, {
                name, providerId, model, systemPrompt, allowedTableIds, skills,
                httpTools, skillPrompts, audioEnabled, visionEnabled, historyDepth, reminderHours, whisperLanguage: whisperLanguage || null, whisperModel, isRouter, routerDescription: routerDescription || null, routableAgentIds,
            });
            const res = await api.get(`/agents/${id}`);
            if (res.data.success) setAgent(res.data.agent);
        } catch (err) { console.error(err); }
        finally { setSaving(false); }
    };

    // Ctrl/Cmd+S → save (only on the Settings tab, and only when a
    // save isn't already in-flight). Using a ref so the listener always
    // sees the latest closure without re-binding on every keystroke.
    const saveRef = useRef(handleSave);
    saveRef.current = handleSave;
    const savingRef = useRef(saving);
    savingRef.current = saving;
    useEffect(() => {
        if (tab !== 'settings') return;
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                if (!savingRef.current) saveRef.current();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [tab]);

    // Model catalogue is admin-managed and loaded from /ai-providers/models
    // (see `aiModels` state below). Users only get to pick from this list —
    // adding new model ids is a platform-admin action.
    const getAvailableModels = (): string[] => {
        const p = providers.find(p => p.id === providerId)?.provider;
        if (!p) return [];
        return aiModels[p] || [];
    };

    const toggleActive = async () => {
        try {
            await api.put(`/agents/${id}`, { name, providerId, model, systemPrompt, allowedTableIds, skills, httpTools, skillPrompts, audioEnabled, visionEnabled, historyDepth, reminderHours, whisperLanguage: whisperLanguage || null, whisperModel, isRouter, routerDescription: routerDescription || null, routableAgentIds, isActive: !agent.isActive });
            setAgent({ ...agent, isActive: !agent.isActive });
        } catch (err) { console.error(err); }
    };

    const formatJid = (jid: string) => {
        if (jid.includes('@lid')) return jid.split('@')[0].slice(-6) + '...';
        return jid.replace('@s.whatsapp.net', '');
    };

    const formatTokens = (n: number) => {
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
        if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
        return n.toString();
    };

    // Skill toggle handlers — switching a skill on auto-expands its panel,
    // switching off removes it from the expanded set. The chevron in the
    // card header collapses/expands without touching the enable flag.
    const toggleSkill = (id: string) => {
        setSkills(prev => {
            const enabled = prev.includes(id);
            if (enabled) {
                setExpandedSkills(s => { const n = new Set(s); n.delete(id); return n; });
                return prev.filter(s => s !== id);
            }
            setExpandedSkills(s => new Set(s).add(id));
            return [...prev, id];
        });
    };
    const toggleSkillExpand = (id: string) => {
        setExpandedSkills(s => {
            const n = new Set(s);
            if (n.has(id)) n.delete(id); else n.add(id);
            return n;
        });
    };

    // ─── Live Operators handlers ───
    // Operators have their own backend table — we don't pack them into
    // the agent payload like httpTools. Each CRUD action hits its own
    // endpoint and updates local state on success.
    const addOperator = () => {
        setOperators(prev => [...prev, {
            id: `tmp-${Math.random().toString(36).slice(2, 8)}`,
            name: '', phone: '', systemPrompt: '',
            order: prev.length, timeoutMin: 30, isActive: true,
            _new: true,
        }]);
    };
    const updateOperator = (id: string, patch: Partial<Operator>) => {
        setOperators(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o));
    };
    const saveOperator = async (op: Operator) => {
        try {
            const body = {
                name: op.name.trim(),
                phone: op.phone.replace(/[^0-9]/g, ''),
                systemPrompt: (op.systemPrompt || '').trim() || null,
                order: op.order,
                timeoutMin: op.timeoutMin,
                isActive: op.isActive,
            };
            if (!body.name || !body.phone) {
                alert('Name and phone are required.');
                return;
            }
            if (op._new) {
                const r = await api.post(`/operators/agent/${id}`, body);
                if (r.data?.success) {
                    setOperators(prev => prev.map(o => o.id === op.id ? r.data.operator : o));
                }
            } else {
                const r = await api.put(`/operators/${op.id}`, body);
                if (r.data?.success) {
                    setOperators(prev => prev.map(o => o.id === op.id ? r.data.operator : o));
                }
            }
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        }
    };
    const removeOperator = async (op: Operator) => {
        if (op._new) {
            setOperators(prev => prev.filter(o => o.id !== op.id));
            return;
        }
        if (!confirm(`Delete operator "${op.name}"?`)) return;
        try {
            await api.delete(`/operators/${op.id}`);
            setOperators(prev => prev.filter(o => o.id !== op.id));
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-screen">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
    );
    if (!agent) return <div>Agent not found</div>;

    const tabs: { key: Tab; label: string; icon: any }[] = [
        { key: "usage", label: "Usage", icon: BarChart3 },
        { key: "activity", label: "Activity", icon: Activity },
        { key: "test", label: "Test", icon: FlaskConical },
        { key: "settings", label: "Settings", icon: Settings },
    ];

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            {/* Header */}
            <div>
                <Link href="/dashboard/ai/agents" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back to Agents
                </Link>
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-primary/10 text-primary rounded-xl">
                        <Bot className="w-7 h-7" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">{agent.name}</h1>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                            {agent.provider?.provider} &bull; {agent.model}
                        </span>
                    </div>
                    <button
                        onClick={toggleActive}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border ${agent.isActive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20' : 'bg-secondary/50 text-muted-foreground border-border hover:bg-emerald-500/10 hover:text-emerald-400 hover:border-emerald-500/20'}`}
                    >
                        <Power className="w-4 h-4" />
                        {agent.isActive ? 'Active' : 'Inactive'}
                    </button>
                    {agent.instances?.length > 0 && (
                        <div className="flex gap-2 ml-4">
                            {agent.instances.map((inst: any) => (
                                <div key={inst.id} className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border ${inst.status === 'CONNECTED' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-secondary/50 text-muted-foreground border-border'}`}>
                                    {inst.status === 'CONNECTED' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                                    {inst.name}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-secondary/30 p-1 rounded-xl w-fit">
                {tabs.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.key ? 'bg-card text-foreground shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                        <t.icon className="w-4 h-4" /> {t.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            {tab === "conversations" && (() => {
                const convName = (conv: any) => conv?.username || conv?.name || formatJid(conv?.remoteJid || '');
                const selectedConv = conversations.find(c => c.remoteJid === selectedJid);
                const Avatar = ({ conv, size }: { conv: any; size: number }) => (
                    conv?.profilePic ? (
                        <img src={conv.profilePic} alt="" className="rounded-full object-cover flex-shrink-0"
                            style={{ width: size, height: size }}
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                        <div className="rounded-full bg-secondary flex items-center justify-center flex-shrink-0"
                            style={{ width: size, height: size }}>
                            <User className="text-muted-foreground" style={{ width: size * 0.55, height: size * 0.55 }} />
                        </div>
                    )
                );
                return (
                <div className="flex gap-4 h-[600px]">
                    {/* Conversation List */}
                    <div className="w-72 flex-shrink-0 bg-card border border-border rounded-2xl overflow-y-auto">
                        <div className="p-3 border-b border-border">
                            <h3 className="font-semibold text-sm">Conversations</h3>
                        </div>
                        {conversations.length === 0 ? (
                            <div className="p-4 text-center text-sm text-muted-foreground">No conversations yet</div>
                        ) : conversations.map(conv => (
                            <button
                                key={conv.remoteJid}
                                onClick={() => loadChat(conv.remoteJid)}
                                className={`w-full text-left p-3 border-b border-border/50 hover:bg-secondary/30 transition-colors flex items-center gap-3 ${selectedJid === conv.remoteJid ? 'bg-secondary/50' : ''}`}
                            >
                                <Avatar conv={conv} size={40} />
                                <div className="min-w-0 flex-1">
                                    <div className="font-medium text-sm truncate">
                                        {conv.username ? '@' + conv.username : convName(conv)}
                                    </div>
                                    {conv.name && conv.username && (
                                        <div className="text-xs text-muted-foreground truncate">{conv.name}</div>
                                    )}
                                    <div className="flex items-center justify-between mt-1">
                                        <span className="text-xs text-muted-foreground">{conv.messageCount} msg</span>
                                        <span className="text-xs text-muted-foreground">{formatTokens(conv.totalTokens)} tok</span>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>

                    {/* Chat Messages */}
                    <div className="flex-1 bg-card border border-border rounded-2xl flex flex-col overflow-hidden">
                        {!selectedJid ? (
                            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                                Select a conversation
                            </div>
                        ) : (
                            <>
                                {/* Chat header */}
                                <div className="flex items-center gap-3 p-3 border-b border-border flex-shrink-0">
                                    <Avatar conv={selectedConv} size={36} />
                                    <div className="min-w-0">
                                        <div className="font-medium text-sm truncate">
                                            {selectedConv?.username ? '@' + selectedConv.username : convName(selectedConv)}
                                        </div>
                                        {selectedConv?.name && (
                                            <div className="text-xs text-muted-foreground truncate">{selectedConv.name}</div>
                                        )}
                                    </div>
                                </div>

                                {/* Messages */}
                                <div className="flex-1 overflow-y-auto">
                                    {loadingChat ? (
                                        <div className="flex items-center justify-center h-full">
                                            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                                        </div>
                                    ) : chatMessages.length === 0 ? (
                                        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                                            No logged messages yet. Logs are recorded from now on.
                                        </div>
                                    ) : (
                                        <div className="p-4 space-y-4">
                                            {chatMessages.map((msg: any) => (
                                                <div key={msg.id} className="space-y-2">
                                                    {/* User message — skipped for manual replies (empty userMessage) */}
                                                    {msg.userMessage && (
                                                        <div className="flex justify-start">
                                                            <div className="bg-secondary/50 rounded-xl px-4 py-2 max-w-[70%] text-sm">
                                                                {msg.userMessage}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {/* Tool calls */}
                                                    {msg.toolCalls && (msg.toolCalls as any[]).length > 0 && (
                                                        <div className="flex flex-wrap gap-1.5 pl-2">
                                                            {(msg.toolCalls as any[]).map((tc: any, i: number) => (
                                                                <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                                                    <Wrench className="w-3 h-3" />
                                                                    {tc.toolName}
                                                                    {tc.args?.column && <span className="opacity-70">({tc.args.column}: {tc.args.query})</span>}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {/* Agent / manual reply */}
                                                    <div className="flex justify-end">
                                                        <div className="bg-primary/10 border border-primary/20 rounded-xl px-4 py-2 max-w-[70%] text-sm">
                                                            {msg.agentReply}
                                                            <div className="text-[10px] text-muted-foreground mt-1 text-right">
                                                                {msg.provider === 'MANUAL'
                                                                    ? 'Manual reply'
                                                                    : `${msg.promptTokens + msg.completionTokens} tokens`}
                                                                {' '}&bull;{' '}
                                                                {new Date(msg.createdAt).toLocaleTimeString()}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Reply box */}
                                <div className="border-t border-border p-3 flex-shrink-0">
                                    {replyError && (
                                        <div className="text-xs text-red-400 mb-2">{replyError}</div>
                                    )}
                                    {selectedJid.startsWith('ig:') ? (
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={replyText}
                                                onChange={e => setReplyText(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                                                placeholder="Type a reply…"
                                                maxLength={950}
                                                disabled={sendingReply}
                                                className="flex-1 bg-secondary/50 border border-border rounded-xl px-4 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60"
                                            />
                                            <button
                                                onClick={sendReply}
                                                disabled={sendingReply || !replyText.trim()}
                                                className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-4 flex items-center gap-2 text-sm font-medium transition-all disabled:opacity-50"
                                            >
                                                {sendingReply ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="text-xs text-muted-foreground text-center">
                                            Manual reply is available for Instagram conversations only.
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
                );
            })()}

            {tab === "usage" && (
                <div className="space-y-6">
                    {!stats ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
                    ) : (
                        <>
                            {/* Summary Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="bg-card border border-border rounded-2xl p-5">
                                    <div className="text-sm text-muted-foreground">Total Requests</div>
                                    <div className="text-3xl font-bold mt-1">{stats.totals.requestCount}</div>
                                </div>
                                <div className="bg-card border border-border rounded-2xl p-5">
                                    <div className="text-sm text-muted-foreground">Total Tokens</div>
                                    <div className="text-3xl font-bold mt-1">{formatTokens(stats.totals.totalTokens)}</div>
                                </div>
                                <div className="bg-card border border-border rounded-2xl p-5">
                                    <div className="text-sm text-muted-foreground">Prompt / Completion</div>
                                    <div className="text-xl font-bold mt-1">
                                        {formatTokens(stats.totals.promptTokens)} / {formatTokens(stats.totals.completionTokens)}
                                    </div>
                                </div>
                            </div>

                            {/* Provider Breakdown */}
                            <div className="bg-card border border-border rounded-2xl overflow-hidden">
                                <div className="p-4 border-b border-border">
                                    <h3 className="font-semibold">Usage by Provider</h3>
                                </div>
                                {stats.stats.length === 0 ? (
                                    <div className="p-6 text-center text-sm text-muted-foreground">No usage data yet</div>
                                ) : (
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-border text-muted-foreground">
                                                <th className="text-left p-3 font-medium">Provider</th>
                                                <th className="text-left p-3 font-medium">Model</th>
                                                <th className="text-right p-3 font-medium">Requests</th>
                                                <th className="text-right p-3 font-medium">Prompt</th>
                                                <th className="text-right p-3 font-medium">Completion</th>
                                                <th className="text-right p-3 font-medium">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {stats.stats.map((s: any, i: number) => (
                                                <tr key={i} className="border-b border-border/50 hover:bg-secondary/20">
                                                    <td className="p-3">
                                                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.provider === 'OPENAI' ? 'bg-green-500/10 text-green-400' : s.provider === 'CLAUDE' ? 'bg-orange-500/10 text-orange-400' : s.provider === 'GLM' ? 'bg-violet-500/10 text-violet-400' : 'bg-blue-500/10 text-blue-400'}`}>
                                                            {s.provider}
                                                        </span>
                                                    </td>
                                                    <td className="p-3 font-mono text-xs">{s.model}</td>
                                                    <td className="p-3 text-right">{s.requestCount}</td>
                                                    <td className="p-3 text-right">{formatTokens(s.promptTokens)}</td>
                                                    <td className="p-3 text-right">{formatTokens(s.completionTokens)}</td>
                                                    <td className="p-3 text-right font-semibold">{formatTokens(s.totalTokens)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}

            {tab === "activity" && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-card border border-border rounded-2xl p-4 sm:p-6"
                >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                        <div>
                            <h3 className="font-semibold flex items-center gap-2">
                                <Activity className="w-4 h-4 text-primary" /> Recent agent activity
                            </h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Last 3 days. Older entries are auto-deleted.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-xs inline-flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" className="accent-primary"
                                    checked={activityOnlyErrors}
                                    onChange={e => setActivityOnlyErrors(e.target.checked)} />
                                <span>Only with tool errors</span>
                            </label>
                            <button onClick={() => loadActivity(false)}
                                className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/40 transition-colors">
                                Refresh
                            </button>
                        </div>
                    </div>

                    {activityLoading && activity.length === 0 ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                    ) : activity.length === 0 ? (
                        <div className="text-center text-sm text-muted-foreground py-12">
                            No activity yet.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {activity.map(item => {
                                const expanded = expandedActivityIds.has(item.id);
                                const failed = item.toolCalls.filter(t => !t.ok).length;
                                const ok = item.toolCalls.length - failed;
                                return (
                                    <div key={item.id} className="border border-border rounded-xl overflow-hidden bg-secondary/10">
                                        <button onClick={() => toggleActivityExpand(item.id)}
                                            className="w-full text-left p-3 flex items-start gap-3 hover:bg-secondary/30 transition-colors">
                                            {expanded
                                                ? <ChevronDown className="w-4 h-4 mt-1 flex-shrink-0 text-muted-foreground" />
                                                : <ChevronRight className="w-4 h-4 mt-1 flex-shrink-0 text-muted-foreground" />}
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                                                    <span className="font-medium text-foreground">
                                                        {item.contactName || (item.contactPhone ? '+' + item.contactPhone : 'Unknown')}
                                                    </span>
                                                    <span>·</span>
                                                    <span className={item.channel === 'instagram' ? 'text-pink-400' : 'text-emerald-400'}>
                                                        {item.channel}
                                                    </span>
                                                    <span>·</span>
                                                    <span>{new Date(item.createdAt).toLocaleString()}</span>
                                                    <span>·</span>
                                                    <span>{item.durationMs} ms</span>
                                                </div>
                                                <div className="text-sm truncate">
                                                    <span className="text-muted-foreground">💬 </span>
                                                    {item.userMessage || <span className="italic text-muted-foreground">(empty)</span>}
                                                </div>
                                                <div className="text-sm truncate mt-0.5">
                                                    <span className="text-muted-foreground">🤖 </span>
                                                    {item.agentReply || <span className="italic text-muted-foreground">(empty)</span>}
                                                </div>
                                                {item.toolCalls.length > 0 && (
                                                    <div className="flex items-center gap-2 mt-2 text-[11px]">
                                                        <Wrench className="w-3 h-3 text-muted-foreground" />
                                                        {ok > 0 && (
                                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                                <CheckCircle2 className="w-3 h-3" /> {ok} ok
                                                            </span>
                                                        )}
                                                        {failed > 0 && (
                                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-500/10 text-red-400 border border-red-500/20">
                                                                <XCircle className="w-3 h-3" /> {failed} failed
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </button>

                                        {expanded && (
                                            <div className="border-t border-border bg-background/40 p-4 space-y-4">
                                                <div>
                                                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">User message</div>
                                                    <pre className="text-xs whitespace-pre-wrap bg-secondary/30 rounded-lg p-3 max-h-48 overflow-auto">{item.userMessage}</pre>
                                                </div>
                                                <div>
                                                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Agent reply</div>
                                                    <pre className="text-xs whitespace-pre-wrap bg-secondary/30 rounded-lg p-3 max-h-48 overflow-auto">{item.agentReply}</pre>
                                                </div>
                                                {item.toolCalls.length > 0 && (
                                                    <div>
                                                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Tool calls ({item.toolCalls.length})</div>
                                                        <div className="space-y-2">
                                                            {item.toolCalls.map((tc, idx) => (
                                                                <div key={idx} className={`rounded-lg border p-3 ${tc.ok ? 'border-border bg-secondary/20' : 'border-red-500/30 bg-red-500/5'}`}>
                                                                    <div className="flex items-center gap-2 text-xs font-medium mb-2">
                                                                        {tc.ok
                                                                            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                                                            : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                                                                        <code>{tc.toolName}</code>
                                                                        {tc.error && (
                                                                            <span className="text-red-400 italic truncate">— {tc.error}</span>
                                                                        )}
                                                                    </div>
                                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                                                                        <div>
                                                                            <div className="text-muted-foreground mb-1 flex items-center gap-1">
                                                                                <ChevronsRight className="w-3 h-3" /> args
                                                                            </div>
                                                                            <pre className="bg-background/60 rounded-md p-2 max-h-40 overflow-auto whitespace-pre-wrap break-all">
{JSON.stringify(tc.args ?? null, null, 2)}
                                                                            </pre>
                                                                        </div>
                                                                        <div>
                                                                            <div className="text-muted-foreground mb-1 flex items-center gap-1">
                                                                                <ChevronsRight className="w-3 h-3" /> result
                                                                            </div>
                                                                            <pre className="bg-background/60 rounded-md p-2 max-h-40 overflow-auto whitespace-pre-wrap break-all">
{JSON.stringify(tc.result ?? null, null, 2)}
                                                                            </pre>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {activityHasMore && (
                                <div className="flex justify-center pt-2">
                                    <button onClick={() => loadActivity(true)} disabled={activityLoading}
                                        className="text-xs px-4 py-2 rounded-lg border border-border hover:bg-secondary/40 transition-colors disabled:opacity-50">
                                        {activityLoading ? 'Loading…' : 'Load older'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </motion.div>
            )}

            {tab === "test" && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-card border border-border rounded-2xl overflow-hidden"
                >
                    <div className="grid grid-cols-1 md:grid-cols-3 min-h-[500px]">
                        {/* Left: contact picker */}
                        <div className="border-r border-border p-4 md:max-h-[600px] md:overflow-y-auto">
                            <div className="flex items-center gap-2 mb-3">
                                <FlaskConical className="w-4 h-4 text-primary" />
                                <h3 className="font-semibold text-sm">Test as contact</h3>
                            </div>
                            <p className="text-[11px] text-muted-foreground mb-3">
                                Pick a contact and chat with the agent <em>as</em> them. Nothing is saved — refresh clears everything. CRM writes are skipped; HTTP calls fire for real.
                            </p>
                            <input value={testContactSearch} onChange={e => setTestContactSearch(e.target.value)}
                                placeholder="Search contacts…"
                                className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 mb-2" />
                            {testLoadingContacts ? (
                                <div className="flex justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                            ) : testContacts.length === 0 ? (
                                <div className="text-xs text-muted-foreground py-6 text-center">No contacts yet.</div>
                            ) : (
                                <div className="space-y-1">
                                    {testContacts
                                        .filter(c => {
                                            const q = testContactSearch.trim().toLowerCase();
                                            if (!q) return true;
                                            return (c.name?.toLowerCase().includes(q)) || (c.phone?.includes(q));
                                        })
                                        .slice(0, 100)
                                        .map(c => (
                                            <button key={c.id} onClick={() => selectTestContact(c)}
                                                className={`w-full text-left p-2 rounded-lg border transition-colors ${testSelectedContact?.id === c.id
                                                    ? 'bg-primary/10 border-primary/30'
                                                    : 'bg-secondary/20 border-border hover:bg-secondary/40'}`}>
                                                <div className="text-sm font-medium truncate">{c.name || `+${c.phone}`}</div>
                                                <div className="text-[11px] text-muted-foreground truncate">+{c.phone}{c.status ? ` · ${c.status}` : ''}</div>
                                            </button>
                                        ))}
                                </div>
                            )}
                        </div>

                        {/* Right: chat */}
                        <div className="md:col-span-2 flex flex-col">
                            {!testSelectedContact ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2 p-8">
                                    <FlaskConical className="w-10 h-10 opacity-30" />
                                    <p className="text-sm">Pick a contact on the left to start a test session.</p>
                                </div>
                            ) : (
                                <>
                                    {/* Header */}
                                    <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-secondary/20">
                                        <div className="w-9 h-9 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center text-sm">
                                            {(testSelectedContact.name || testSelectedContact.phone || '?').charAt(0).toUpperCase()}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="font-medium text-sm truncate">{testSelectedContact.name || `+${testSelectedContact.phone}`}</div>
                                            <div className="text-[11px] text-muted-foreground">+{testSelectedContact.phone} · test session</div>
                                        </div>
                                        <button onClick={clearTestSession}
                                            className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-secondary/40 transition-colors inline-flex items-center gap-1.5">
                                            <RefreshCw className="w-3.5 h-3.5" /> Reset
                                        </button>
                                    </div>

                                    {/* History + turns */}
                                    <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[500px]">
                                        {testContactHistory.length > 0 && (
                                            <div className="space-y-2 pb-3 mb-2 border-b border-border/50">
                                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground text-center">
                                                    Real history (read-only)
                                                </div>
                                                {testContactHistory.slice(-6).map((h: any) => (
                                                    <div key={h.id} className={`flex ${h.userMessage ? 'justify-start' : 'justify-end'}`}>
                                                        <div className={`max-w-[75%] px-3 py-1.5 rounded-xl text-xs opacity-60 ${h.userMessage ? 'bg-secondary/40' : 'bg-primary/10 border border-primary/20'}`}>
                                                            {h.userMessage || h.agentReply}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {testTurns.length === 0 ? (
                                            <div className="text-center text-xs text-muted-foreground py-6">
                                                Type a message below as {testSelectedContact.name || `+${testSelectedContact.phone}`}.
                                            </div>
                                        ) : testTurns.map(t => {
                                            if (t.role === 'user') {
                                                return (
                                                    <div key={t.id} className="flex justify-start">
                                                        <div className="bg-amber-500/10 border border-amber-500/30 px-3.5 py-2 rounded-2xl rounded-bl-md max-w-[75%] text-sm">
                                                            <div className="text-[10px] uppercase tracking-wide text-amber-400 mb-0.5">As {testSelectedContact.name || testSelectedContact.phone}</div>
                                                            <div className="whitespace-pre-wrap break-words">{t.content}</div>
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            const expanded = expandedTestToolIds.has(t.id);
                                            const failed = t.toolCalls.filter(tc => !tc.ok).length;
                                            return (
                                                <div key={t.id} className="flex justify-end">
                                                    <div className="bg-primary/15 border border-primary/30 px-3.5 py-2 rounded-2xl rounded-br-md max-w-[80%] text-sm">
                                                        <div className="text-[10px] uppercase tracking-wide text-primary mb-0.5">Agent reply</div>
                                                        <div className="whitespace-pre-wrap break-words">{t.content || <span className="italic opacity-60">(empty)</span>}</div>
                                                        {t.toolCalls.length > 0 && (
                                                            <button onClick={() => toggleTestToolExpand(t.id)}
                                                                className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                                                                <Wrench className="w-3 h-3" />
                                                                {expanded ? 'Hide' : 'Show'} {t.toolCalls.length} tool call{t.toolCalls.length === 1 ? '' : 's'}
                                                                {failed > 0 && <span className="text-red-400">· {failed} failed</span>}
                                                            </button>
                                                        )}
                                                        {expanded && (
                                                            <div className="mt-2 space-y-2">
                                                                {t.toolCalls.map((tc, i) => (
                                                                    <div key={i} className={`rounded-lg border p-2 text-[11px] ${tc.ok ? 'border-border bg-background/40' : 'border-red-500/30 bg-red-500/5'}`}>
                                                                        <div className="flex items-center gap-1.5 font-medium mb-1.5">
                                                                            {tc.ok
                                                                                ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                                                                : <XCircle className="w-3 h-3 text-red-400" />}
                                                                            <code>{tc.toolName}</code>
                                                                            {tc.error && <span className="text-red-400 italic truncate">— {tc.error}</span>}
                                                                        </div>
                                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                                                            <pre className="bg-background/60 rounded-md p-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(tc.args ?? null, null, 2)}</pre>
                                                                            <pre className="bg-background/60 rounded-md p-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(tc.result ?? null, null, 2)}</pre>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {t.tokens && (
                                                            <div className="text-[10px] text-muted-foreground mt-1.5">
                                                                {t.tokens.total} tok · {t.tokens.prompt} in / {t.tokens.completion} out
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {testSending && (
                                            <div className="flex justify-end">
                                                <div className="bg-primary/10 border border-primary/20 px-3 py-2 rounded-2xl rounded-br-md text-xs flex items-center gap-2">
                                                    <Loader2 className="w-3 h-3 animate-spin" /> thinking…
                                                </div>
                                            </div>
                                        )}

                                        {testError && (
                                            <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-3 py-2 rounded-lg text-xs">
                                                {testError}
                                            </div>
                                        )}
                                    </div>

                                    {/* Input */}
                                    <div className="border-t border-border bg-card p-3 flex gap-2">
                                        <input value={testInput} onChange={e => setTestInput(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTestMessage(); } }}
                                            placeholder={`Type as ${testSelectedContact.name || testSelectedContact.phone}…`}
                                            disabled={testSending}
                                            className="flex-1 bg-secondary/50 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                        <button onClick={sendTestMessage} disabled={testSending || !testInput.trim()}
                                            className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-4 flex items-center gap-2 text-sm font-medium disabled:opacity-50">
                                            {testSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </motion.div>
            )}

            {tab === "settings" && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-card border border-border rounded-2xl p-6"
                >
                    <div className="space-y-5 max-w-2xl">
                        <div>
                            <label className="text-sm font-medium text-muted-foreground">Agent Name</label>
                            <input type="text" value={name} onChange={e => setName(e.target.value)}
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium text-muted-foreground">AI Provider</label>
                                <select value={providerId} onChange={e => { setProviderId(e.target.value); setModel(''); }}
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                                    <option value="" disabled>Select Provider</option>
                                    {providers.map(p => <option key={p.id} value={p.id}>{p.provider}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-muted-foreground">Model</label>
                                <select value={model} onChange={e => setModel(e.target.value)} disabled={!providerId}
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50">
                                    <option value="" disabled>Select Model</option>
                                    {getAvailableModels().map(m => <option key={m} value={m}>{m}</option>)}
                                    {/* If the agent already uses a model that's no longer on the
                                        admin-managed list (e.g. it was retired), keep it as an
                                        option so the dropdown still shows the current value. */}
                                    {model && !getAvailableModels().includes(model) && (
                                        <option value={model}>{model} (legacy)</option>
                                    )}
                                </select>
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between gap-2">
                                <label className="text-sm font-medium text-muted-foreground">System Prompt</label>
                                <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-muted-foreground tabular-nums">{systemPrompt.length.toLocaleString()} chars</span>
                                    <button type="button" onClick={() => setPromptInlineRows(r => Math.max(4, r - 4))}
                                        title="Shrink inline editor"
                                        className="p-1 text-muted-foreground hover:text-foreground rounded">
                                        <Minimize2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button type="button" onClick={() => setPromptInlineRows(r => Math.min(40, r + 4))}
                                        title="Grow inline editor"
                                        className="p-1 text-muted-foreground hover:text-foreground rounded">
                                        <ChevronDown className="w-3.5 h-3.5" />
                                    </button>
                                    <button type="button" onClick={() => setPromptModalOpen(true)}
                                        title="Open in full-screen modal"
                                        className="p-1 text-muted-foreground hover:text-foreground rounded">
                                        <Maximize2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                            <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={promptInlineRows}
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm resize-y" />
                        </div>

                        {/* Full-screen prompt editor — same value, much bigger
                            editing surface. Keeps two-way binding with the
                            inline textarea so closing the modal doesn't lose
                            edits. */}
                        {promptModalOpen && (
                            <div className="fixed inset-0 bg-black/70 z-50 flex flex-col p-4 sm:p-8">
                                <div className="bg-card border border-border rounded-2xl flex flex-col flex-1 min-h-0">
                                    <div className="flex items-center justify-between gap-3 p-4 border-b border-border flex-shrink-0">
                                        <div>
                                            <h2 className="font-semibold">System Prompt — {name || 'Agent'}</h2>
                                            <p className="text-xs text-muted-foreground">Changes save when you close and hit Save Changes on the main page.</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-muted-foreground tabular-nums">{systemPrompt.length.toLocaleString()} chars</span>
                                            <button onClick={() => setPromptModalOpen(false)}
                                                className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5">
                                                Done
                                            </button>
                                            <button onClick={() => setPromptModalOpen(false)}
                                                className="text-muted-foreground hover:text-foreground p-1.5">
                                                <XIcon className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>
                                    <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
                                        autoFocus spellCheck={false}
                                        className="flex-1 w-full bg-card text-foreground p-5 text-sm font-mono leading-relaxed focus:outline-none resize-none rounded-b-2xl" />
                                </div>
                            </div>
                        )}

                        {/* Multi-modal — voice transcription + image vision. */}
                        <div className="rounded-xl border border-border bg-card">
                            <div className="p-3 border-b border-border">
                                <div className="text-sm font-medium">Multi-modal input</div>
                                <div className="text-xs text-muted-foreground">What the agent can perceive from incoming WhatsApp messages.</div>
                            </div>
                            <div className="p-3 space-y-2">
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input type="checkbox" checked={audioEnabled} onChange={e => setAudioEnabled(e.target.checked)}
                                        className="w-4 h-4 mt-0.5 accent-primary rounded cursor-pointer" />
                                    <div className="flex-1">
                                        <div className="text-sm font-medium">Listen to voice messages</div>
                                        <div className="text-xs text-muted-foreground">
                                            Voice notes are transcribed via Whisper before the agent reads them. Requires an OpenAI provider configured in this workspace.
                                            {!providers.some(p => p.provider === 'OPENAI') && (
                                                <span className="ml-1 text-amber-400">No OpenAI key found — add one under AI Providers.</span>
                                            )}
                                        </div>
                                    </div>
                                </label>
                                {audioEnabled && (
                                    <div className="pl-7 space-y-3">
                                        <div>
                                            <label className="text-[11px] font-medium text-muted-foreground">Transcription model</label>
                                            <div className="mt-1 flex items-center gap-3">
                                                <select value={whisperModel} onChange={e => setWhisperModel(e.target.value)}
                                                    className="bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                                                    <option value="whisper-1">whisper-1 — cheapest, broadest input format</option>
                                                    <option value="gpt-4o-mini-transcribe">gpt-4o-mini-transcribe — cheap, newer</option>
                                                    <option value="gpt-4o-transcribe">gpt-4o-transcribe — highest accuracy</option>
                                                </select>
                                            </div>
                                            <p className="text-[11px] text-muted-foreground mt-1">
                                                gpt-4o-transcribe is more accurate on rare languages but costs more per minute.
                                            </p>
                                        </div>
                                        <div>
                                            <label className="text-[11px] font-medium text-muted-foreground">Expected language</label>
                                            <div className="mt-1 flex items-center gap-3">
                                                <select value={whisperLanguage} onChange={e => setWhisperLanguage(e.target.value)}
                                                    className="bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
                                                    <option value="">Auto-detect</option>
                                                    <option value="az">Azerbaijani</option>
                                                    <option value="ru">Russian</option>
                                                    <option value="tr">Turkish</option>
                                                    <option value="en">English</option>
                                                    <option value="uk">Ukrainian</option>
                                                    <option value="ar">Arabic</option>
                                                    <option value="fa">Persian</option>
                                                    <option value="es">Spanish</option>
                                                    <option value="fr">French</option>
                                                    <option value="de">German</option>
                                                </select>
                                            </div>
                                            <p className="text-[11px] text-muted-foreground mt-1">
                                                Auto-detect works well for long clips but frequently mis-identifies short Azerbaijani / Turkic voices as English. Pin the language when the customer base speaks a known one.
                                            </p>
                                        </div>
                                    </div>
                                )}
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input type="checkbox" checked={visionEnabled} onChange={e => setVisionEnabled(e.target.checked)}
                                        className="w-4 h-4 mt-0.5 accent-primary rounded cursor-pointer" />
                                    <div className="flex-1">
                                        <div className="text-sm font-medium">See images</div>
                                        <div className="text-xs text-muted-foreground">
                                            Photos are forwarded to the model as a native image part. Best-supported on GPT-4o, Claude 3+, and Gemini 1.5+.
                                        </div>
                                    </div>
                                </label>
                            </div>
                        </div>

                        {/* Router description — shown to any router agent
                            so it knows when to dispatch contacts to this
                            agent. Optional; leave empty if this agent isn't
                            meant to receive handoffs. Router agents
                            themselves are edited under Router Agents. */}
                        <div className="rounded-xl border border-border bg-card">
                            <div className="p-3 border-b border-border">
                                <div className="text-sm font-medium">Router description</div>
                                <div className="text-xs text-muted-foreground">A short label routers see when deciding whether to hand a contact off to this agent.</div>
                            </div>
                            <div className="p-3">
                                <textarea value={routerDescription} onChange={e => setRouterDescription(e.target.value)} rows={2}
                                    placeholder="e.g. 'Handles laser cutting orders, quotes and turnaround questions.'"
                                    className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none text-sm" />
                            </div>
                        </div>

                        {/* Memory — promoted out of Skills, lives right under System Prompt */}
                        <div className={`rounded-xl border ${skills.includes('memory') ? 'bg-primary/5 border-primary/30' : 'bg-card border-border'}`}>
                            <div className="flex items-center gap-3 p-3">
                                <input
                                    type="checkbox"
                                    checked={skills.includes('memory')}
                                    onChange={() => toggleSkill('memory')}
                                    className="w-4 h-4 accent-primary rounded cursor-pointer"
                                />
                                <button type="button"
                                    onClick={() => skills.includes('memory') && toggleSkillExpand('memory')}
                                    className={`flex-1 text-left ${skills.includes('memory') ? 'cursor-pointer' : 'cursor-default'}`}
                                    disabled={!skills.includes('memory')}>
                                    <div className="font-medium text-sm flex items-center gap-2">
                                        <MessageSquare className="w-4 h-4 text-muted-foreground" /> Memory
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        Agent looks back through prior messages on demand (search, range, stats). Default history shrinks to 3 turns; older context fetched only when needed.
                                    </div>
                                </button>
                                {skills.includes('memory') && (
                                    <button type="button" onClick={() => toggleSkillExpand('memory')}
                                        className="text-muted-foreground hover:text-foreground p-1 rounded">
                                        {expandedSkills.has('memory') ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                    </button>
                                )}
                            </div>
                            {skills.includes('memory') && expandedSkills.has('memory') && (
                                <div className="border-t border-border p-4 space-y-4">
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">History depth</label>
                                        <div className="mt-1 flex items-center gap-3">
                                            <input type="number" min={1} max={50}
                                                value={historyDepth}
                                                onChange={e => setHistoryDepth(Math.max(1, Math.min(50, Number(e.target.value) || 10)))}
                                                className="w-24 bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                            <p className="text-[11px] text-muted-foreground">
                                                Number of recent messages the agent automatically sees each turn. Older context still reachable via memory tools. Range 1–50.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="text-xs font-medium text-muted-foreground">Memory Prompt</label>
                                        {(skillPrompts['memory'] || '').trim().length > 0 && (
                                            <button type="button"
                                                onClick={() => setSkillPrompts(prev => { const n = { ...prev }; delete n['memory']; return n; })}
                                                className="text-xs text-muted-foreground hover:text-red-400 transition-colors">
                                                Reset to default
                                            </button>
                                        )}
                                    </div>
                                    <textarea
                                        value={skillPrompts['memory'] ?? ''}
                                        onChange={e => setSkillPrompts(prev => ({ ...prev, memory: e.target.value }))}
                                        rows={5}
                                        placeholder={DEFAULT_SKILL_PROMPTS.memory}
                                        className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none text-sm" />
                                    {!(skillPrompts['memory'] || '').trim() && (
                                        <p className="text-[10px] text-muted-foreground mt-1 italic">Using default</p>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Self-pause — sits directly under Memory per request */}
                        <div className={`rounded-xl border ${skills.includes('self_pause') ? 'bg-primary/5 border-primary/30' : 'bg-card border-border'}`}>
                            <div className="flex items-center gap-3 p-3">
                                <input
                                    type="checkbox"
                                    checked={skills.includes('self_pause')}
                                    onChange={() => toggleSkill('self_pause')}
                                    className="w-4 h-4 accent-primary rounded cursor-pointer"
                                />
                                <button type="button"
                                    onClick={() => skills.includes('self_pause') && toggleSkillExpand('self_pause')}
                                    className={`flex-1 text-left ${skills.includes('self_pause') ? 'cursor-pointer' : 'cursor-default'}`}
                                    disabled={!skills.includes('self_pause')}>
                                    <div className="font-medium text-sm flex items-center gap-2">
                                        <Pause className="w-4 h-4 text-muted-foreground" /> Self-pause
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        Lets the agent stop auto-replying to the current contact (handoff to manager, customer asked for a person, etc). Only a human operator can resume from the inbox.
                                    </div>
                                </button>
                                {skills.includes('self_pause') && (
                                    <button type="button" onClick={() => toggleSkillExpand('self_pause')}
                                        className="text-muted-foreground hover:text-foreground p-1 rounded">
                                        {expandedSkills.has('self_pause') ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                    </button>
                                )}
                            </div>
                            {skills.includes('self_pause') && expandedSkills.has('self_pause') && (
                                <div className="border-t border-border p-4">
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="text-xs font-medium text-muted-foreground">Self-pause Prompt</label>
                                        {(skillPrompts['self_pause'] || '').trim().length > 0 && (
                                            <button type="button"
                                                onClick={() => setSkillPrompts(prev => { const n = { ...prev }; delete n['self_pause']; return n; })}
                                                className="text-xs text-muted-foreground hover:text-red-400 transition-colors">
                                                Reset to default
                                            </button>
                                        )}
                                    </div>
                                    <textarea
                                        value={skillPrompts['self_pause'] ?? ''}
                                        onChange={e => setSkillPrompts(prev => ({ ...prev, self_pause: e.target.value }))}
                                        rows={5}
                                        placeholder={DEFAULT_SKILL_PROMPTS.self_pause}
                                        className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none text-sm" />
                                    {!(skillPrompts['self_pause'] || '').trim() && (
                                        <p className="text-[10px] text-muted-foreground mt-1 italic">Using default</p>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Reminder — proactive follow-up after N hours of silence */}
                        <div className={`rounded-xl border ${skills.includes('reminder') ? 'bg-primary/5 border-primary/30' : 'bg-card border-border'}`}>
                            <div className="flex items-center gap-3 p-3">
                                <input
                                    type="checkbox"
                                    checked={skills.includes('reminder')}
                                    onChange={() => toggleSkill('reminder')}
                                    className="w-4 h-4 accent-primary rounded cursor-pointer"
                                />
                                <button type="button"
                                    onClick={() => skills.includes('reminder') && toggleSkillExpand('reminder')}
                                    className={`flex-1 text-left ${skills.includes('reminder') ? 'cursor-pointer' : 'cursor-default'}`}
                                    disabled={!skills.includes('reminder')}>
                                    <div className="font-medium text-sm flex items-center gap-2">
                                        <Bell className="w-4 h-4 text-muted-foreground" /> Reminder
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        Background scheduler picks contacts who've been silent for N hours and asks the agent to write a short re-engagement message based on the chat history.
                                    </div>
                                </button>
                                {skills.includes('reminder') && (
                                    <button type="button" onClick={() => toggleSkillExpand('reminder')}
                                        className="text-muted-foreground hover:text-foreground p-1 rounded">
                                        {expandedSkills.has('reminder') ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                    </button>
                                )}
                            </div>
                            {skills.includes('reminder') && expandedSkills.has('reminder') && (
                                <div className="border-t border-border p-4 space-y-4">
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground">Idle hours before reminder</label>
                                        <div className="mt-1 flex items-center gap-3">
                                            <input type="number" min={1} max={720}
                                                value={reminderHours}
                                                onChange={e => setReminderHours(Math.max(1, Math.min(720, Number(e.target.value) || 24)))}
                                                className="w-24 bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                            <p className="text-[11px] text-muted-foreground">
                                                When the customer's last message is older than this and no reply has gone out, the agent will send a follow-up. Capped at 3 reminders per idle state. Range 1–720h.
                                            </p>
                                        </div>
                                    </div>
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <label className="text-xs font-medium text-muted-foreground">Reminder prompt</label>
                                            {(skillPrompts['reminder'] || '').trim().length > 0 && (
                                                <button type="button"
                                                    onClick={() => setSkillPrompts(prev => { const n = { ...prev }; delete n['reminder']; return n; })}
                                                    className="text-xs text-muted-foreground hover:text-red-400 transition-colors">
                                                    Reset to default
                                                </button>
                                            )}
                                        </div>
                                        <textarea
                                            value={skillPrompts['reminder'] ?? ''}
                                            onChange={e => setSkillPrompts(prev => ({ ...prev, reminder: e.target.value }))}
                                            rows={5}
                                            placeholder={DEFAULT_SKILL_PROMPTS.reminder || 'Write the customer ONE short warm follow-up that picks up where the chat left off…'}
                                            className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none text-sm" />
                                        {!(skillPrompts['reminder'] || '').trim() && (
                                            <p className="text-[10px] text-muted-foreground mt-1 italic">Using default</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Skills — each card hosts its checkbox AND (when checked) its own panel */}
                        <div>
                            <h3 className="font-semibold flex items-center gap-2 mb-2">
                                <Wrench className="w-4 h-4 text-muted-foreground" /> Skills
                            </h3>
                            <p className="text-sm text-muted-foreground mb-3">Enable capabilities for this agent. Each enabled skill opens its own configuration panel below.</p>
                            <div className="space-y-3">
                                {([
                                    { id: 'crm', name: 'CRM Management', desc: 'Create/update clients, track statuses and tags' },
                                    { id: 'user_fields', name: 'User Fields', desc: 'Read and write custom fields you defined on the Contacts page (age, city, purpose, …)' },
                                    { id: 'tables', name: 'Data Tables', desc: 'Query and search custom data tables' },
                                    { id: 'http', name: 'HTTP API Requests', desc: 'Call external APIs (GET/POST/etc) with custom headers and body' },
                                    { id: 'live_operator', name: 'Live Operators', desc: 'Agent can ask human teammates over WhatsApp for things only they know (pricing, approvals). Replies route back to the customer automatically.' },
                                    { id: 'polls', name: 'Polls', desc: 'Send interactive WhatsApp polls (2–12 options) so the customer can tap a choice instead of typing.' },
                                    { id: 'google_calendar', name: 'Google Calendar', desc: 'Agent can list events, check availability, and book meetings on the workspace\'s connected Google Calendar.', brand: 'google-calendar', isConnector: true },
                                ] as { id: string; name: string; desc: string; brand?: string; isConnector?: boolean }[]).map(skill => {
                                    const enabled = skills.includes(skill.id);
                                    const expanded = expandedSkills.has(skill.id);
                                    const promptVal = skillPrompts[skill.id] ?? '';
                                    const isOverridden = promptVal.trim().length > 0;
                                    // Per-skill collapsed-state summary chips.
                                    const summaryChip =
                                        skill.id === 'tables' ? `${allowedTableIds.length} table${allowedTableIds.length === 1 ? '' : 's'}` :
                                        skill.id === 'http'   ? `${httpTools.length} tool${httpTools.length === 1 ? '' : 's'}` :
                                        skill.id === 'live_operator' ? `${operators.length} operator${operators.length === 1 ? '' : 's'}` :
                                        isOverridden ? 'custom prompt' : null;
                                    return (
                                        <div key={skill.id} className={`rounded-xl border overflow-hidden ${enabled ? 'bg-primary/5 border-primary/30' : 'bg-card border-border'}`}>
                                            <div className="flex items-center gap-3 p-3">
                                                <input type="checkbox" checked={enabled}
                                                    onChange={() => toggleSkill(skill.id)}
                                                    className="w-4 h-4 accent-primary rounded cursor-pointer" />
                                                {skill.brand === 'google-calendar' && <GoogleCalendarLogo />}
                                                <button type="button"
                                                    onClick={() => enabled && toggleSkillExpand(skill.id)}
                                                    className={`flex-1 text-left ${enabled ? 'cursor-pointer' : 'cursor-default'}`}
                                                    disabled={!enabled}>
                                                    <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                                                        {skill.name}
                                                        {skill.isConnector && (
                                                            <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-blue-500/10 text-blue-300 border border-blue-500/30 rounded-md px-1.5 py-0.5 uppercase tracking-wider">
                                                                <Plug className="w-2.5 h-2.5" /> Connector
                                                            </span>
                                                        )}
                                                        {enabled && summaryChip && (
                                                            <span className="text-[10px] font-normal bg-secondary/60 text-muted-foreground border border-border rounded-md px-1.5 py-0.5">
                                                                {summaryChip}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">{skill.desc}</div>
                                                </button>
                                                {enabled && (
                                                    <button type="button" onClick={() => toggleSkillExpand(skill.id)}
                                                        className="text-muted-foreground hover:text-foreground p-1 rounded">
                                                        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                                    </button>
                                                )}
                                            </div>
                                            {enabled && expanded && (
                                                <div className="border-t border-border p-4 space-y-4">
                                                    {/* Skill prompt override */}
                                                    <div>
                                                        <div className="flex items-center justify-between mb-1">
                                                            <label className="text-xs font-medium text-muted-foreground">{skill.name} Prompt</label>
                                                            {isOverridden && (
                                                                <button type="button"
                                                                    onClick={() => setSkillPrompts(prev => { const n = { ...prev }; delete n[skill.id]; return n; })}
                                                                    className="text-xs text-muted-foreground hover:text-red-400 transition-colors">
                                                                    Reset to default
                                                                </button>
                                                            )}
                                                        </div>
                                                        <textarea
                                                            value={promptVal}
                                                            onChange={e => setSkillPrompts(prev => ({ ...prev, [skill.id]: e.target.value }))}
                                                            rows={3}
                                                            placeholder={DEFAULT_SKILL_PROMPTS[skill.id]}
                                                            className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none text-sm" />
                                                        {!isOverridden && (
                                                            <p className="text-[10px] text-muted-foreground mt-1 italic">Using default</p>
                                                        )}
                                                    </div>

                                                    {/* Tables-specific: knowledge base selector */}
                                                    {skill.id === 'tables' && (
                                                        <div>
                                                            <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-2">
                                                                <Database className="w-3.5 h-3.5" /> Knowledge Base
                                                            </div>
                                                            {tables.length === 0 ? (
                                                                <div className="bg-secondary/50 border border-dashed border-border rounded-xl p-3 text-center text-xs text-muted-foreground">No data tables created yet.</div>
                                                            ) : (
                                                                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                                                    {tables.map(table => (
                                                                        <label key={table.id} className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${allowedTableIds.includes(table.id) ? 'bg-primary/5 border-primary/30' : 'bg-card border-border hover:bg-secondary/50'}`}>
                                                                            <input type="checkbox" checked={allowedTableIds.includes(table.id)}
                                                                                onChange={() => setAllowedTableIds(prev => prev.includes(table.id) ? prev.filter(t => t !== table.id) : [...prev, table.id])}
                                                                                className="w-4 h-4 accent-primary rounded" />
                                                                            <div>
                                                                                <div className="font-medium text-sm">{table.name}</div>
                                                                                <div className="text-xs text-muted-foreground">{table.columns.length} columns</div>
                                                                            </div>
                                                                        </label>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* HTTP-specific: tools manager */}
                                                    {skill.id === 'http' && (
                                                        <div>
                                                            <div className="flex items-center justify-between mb-2">
                                                                <div className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                                                                    <Wrench className="w-3.5 h-3.5" /> HTTP Tools
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => { const t = newTool(); setHttpTools([...httpTools, t]); setExpandedTool(t.id); }}
                                                                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                                                                >
                                                                    <Plus className="w-3 h-3" /> Add Tool
                                                                </button>
                                                            </div>
                                                            <p className="text-xs text-muted-foreground mb-2">
                                                                Each value can be a <span className="text-foreground">fixed</span> value or <span className="text-amber-400">AI-filled</span> at call time.
                                                            </p>
                                                            <div className="text-[11px] text-muted-foreground bg-secondary/30 border border-border rounded-lg px-3 py-2 mb-3 leading-relaxed">
                                                                <div className="font-medium text-foreground mb-1">Placeholders</div>
                                                                Inside any URL / header / body field you can reference the current contact:
                                                                <code className="mx-1 px-1 py-0.5 bg-background/60 rounded">{'{{contact:name}}'}</code>
                                                                <code className="mx-1 px-1 py-0.5 bg-background/60 rounded">{'{{contact:phone}}'}</code>
                                                                <code className="mx-1 px-1 py-0.5 bg-background/60 rounded">{'{{contact:status}}'}</code>
                                                                <code className="mx-1 px-1 py-0.5 bg-background/60 rounded">{'{{contact:summary}}'}</code>
                                                                <code className="mx-1 px-1 py-0.5 bg-background/60 rounded">{'{{contact:tags}}'}</code>
                                                                or a user field:
                                                                <code className="mx-1 px-1 py-0.5 bg-background/60 rounded">{'{{field:<key>}}'}</code>
                                                                — these are resolved from CRM at call time, so the AI doesn't have to fill them.
                                                            </div>
                            <div className="space-y-2">
                                {httpTools.length === 0 && (
                                    <div className="bg-secondary/30 border border-dashed border-border rounded-xl p-4 text-center text-sm text-muted-foreground">
                                        No custom HTTP tools yet. Click "Add Tool" to create one.
                                    </div>
                                )}
                                {httpTools.map((tool, idx) => {
                                    const isOpen = expandedTool === tool.id;
                                    const update = (patch: Partial<HttpToolTemplate>) => {
                                        const next = [...httpTools];
                                        next[idx] = { ...tool, ...patch };
                                        setHttpTools(next);
                                    };
                                    const remove = () => setHttpTools(httpTools.filter(t => t.id !== tool.id));

                                    return (
                                        <div key={tool.id} className="bg-card border border-border rounded-xl overflow-hidden">
                                            <div className="flex items-center gap-2 p-3 hover:bg-secondary/30 cursor-pointer" onClick={() => setExpandedTool(isOpen ? null : tool.id)}>
                                                {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                                                <span className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded ${tool.method === 'GET' ? 'bg-emerald-500/10 text-emerald-400' : tool.method === 'POST' ? 'bg-blue-500/10 text-blue-400' : tool.method === 'DELETE' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                                                    {tool.method}
                                                </span>
                                                <span className="font-medium text-sm flex-1">{tool.name || <span className="text-muted-foreground italic">unnamed</span>}</span>
                                                <span className="text-xs text-muted-foreground truncate max-w-[40%] font-mono">
                                                    {tool.url.mode === 'fixed' ? tool.url.value : `[AI] ${tool.url.description}`}
                                                </span>
                                                <button type="button" onClick={(e) => { e.stopPropagation(); remove(); }} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                            {isOpen && (
                                                <div className="p-4 border-t border-border space-y-4">
                                                    {/* Name + Method */}
                                                    <div className="grid grid-cols-3 gap-3">
                                                        <div className="col-span-2">
                                                            <label className="text-xs font-medium text-muted-foreground">Tool Name</label>
                                                            <input type="text" value={tool.name} onChange={e => update({ name: e.target.value })}
                                                                placeholder="getWeather"
                                                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono" />
                                                        </div>
                                                        <div>
                                                            <label className="text-xs font-medium text-muted-foreground">Method</label>
                                                            <select value={tool.method} onChange={e => update({ method: e.target.value as any })}
                                                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                                                                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m} value={m}>{m}</option>)}
                                                            </select>
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Description (when AI should use this)</label>
                                                        <textarea value={tool.description} onChange={e => update({ description: e.target.value })} rows={2}
                                                            placeholder="Fetches the current weather for a given city"
                                                            className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
                                                    </div>

                                                    {/* Mode toggle: Form (structured) vs Raw (text) */}
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Input Mode</label>
                                                        <div className="mt-1 flex gap-1 bg-secondary/30 p-1 rounded-lg w-fit">
                                                            {(['form', 'raw'] as const).map(m => (
                                                                <button
                                                                    key={m}
                                                                    type="button"
                                                                    onClick={() => update({ inputMode: m })}
                                                                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${(tool.inputMode || 'form') === m ? 'bg-card text-foreground border border-border' : 'text-muted-foreground hover:text-foreground'}`}
                                                                >
                                                                    {m === 'form' ? 'Form (structured)' : 'Raw (text)'}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Raw mode: single textarea with {{description}} placeholders */}
                                                    {tool.inputMode === 'raw' && (
                                                        <div>
                                                            <label className="text-xs font-medium text-muted-foreground">Raw HTTP Request</label>
                                                            <p className="text-xs text-muted-foreground mt-0.5 mb-1">
                                                                Format: <code className="bg-secondary px-1 rounded">METHOD URL</code>, then headers, blank line, then body. Use <code className="bg-secondary px-1 rounded text-amber-400">{`{{description}}`}</code> anywhere to mark an AI-filled placeholder.
                                                            </p>
                                                            <textarea
                                                                value={tool.rawRequest || ''}
                                                                onChange={e => update({ rawRequest: e.target.value })}
                                                                rows={10}
                                                                placeholder={RAW_REQUEST_PLACEHOLDER}
                                                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y font-mono"
                                                            />
                                                        </div>
                                                    )}

                                                    {tool.inputMode !== 'raw' && (
                                                    <>
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">URL</label>
                                                        <div className="mt-1">
                                                            <ValueInput spec={tool.url} onChange={v => update({ url: v })} placeholder="https://api.example.com/data" />
                                                        </div>
                                                    </div>

                                                    {/* Authentication */}
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Authentication</label>
                                                        <select
                                                            value={tool.auth?.type || 'none'}
                                                            onChange={e => {
                                                                const t = e.target.value;
                                                                if (t === 'none') update({ auth: { type: 'none' } });
                                                                else if (t === 'bearer') update({ auth: { type: 'bearer', token: '' } });
                                                                else update({ auth: { type: 'basic', username: '', password: '' } });
                                                            }}
                                                            className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                                                            <option value="none">None</option>
                                                            <option value="bearer">Bearer Token</option>
                                                            <option value="basic">Basic Auth</option>
                                                        </select>
                                                        {tool.auth?.type === 'bearer' && (
                                                            <input type="password" value={tool.auth.token} onChange={e => update({ auth: { type: 'bearer', token: e.target.value } })}
                                                                placeholder="token..."
                                                                className="mt-2 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono" />
                                                        )}
                                                        {tool.auth?.type === 'basic' && (
                                                            <div className="mt-2 grid grid-cols-2 gap-2">
                                                                <input type="text" value={tool.auth.username} onChange={e => update({ auth: { type: 'basic', username: e.target.value, password: tool.auth && tool.auth.type === 'basic' ? tool.auth.password : '' } })}
                                                                    placeholder="username"
                                                                    className="bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                                                <input type="password" value={tool.auth.password} onChange={e => update({ auth: { type: 'basic', username: tool.auth && tool.auth.type === 'basic' ? tool.auth.username : '', password: e.target.value } })}
                                                                    placeholder="password"
                                                                    className="bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Query Parameters */}
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Query Parameters</label>
                                                        <div className="mt-1">
                                                            <NameValueRows items={tool.queryParams || []} onChange={v => update({ queryParams: v })} namePlaceholder="param name" />
                                                        </div>
                                                    </div>

                                                    {/* Headers */}
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Headers</label>
                                                        <div className="mt-1">
                                                            <NameValueRows items={tool.headers || []} onChange={v => update({ headers: v })} namePlaceholder="Header-Name" />
                                                        </div>
                                                    </div>

                                                    {/* Body */}
                                                    <div>
                                                        <label className="text-xs font-medium text-muted-foreground">Body</label>
                                                        <select
                                                            value={tool.bodyType || 'none'}
                                                            onChange={e => update({ bodyType: e.target.value as any })}
                                                            className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                                                            <option value="none">None</option>
                                                            <option value="json">JSON (fields)</option>
                                                            <option value="raw">Raw text</option>
                                                        </select>
                                                        {tool.bodyType === 'json' && (
                                                            <div className="mt-2">
                                                                <NameValueRows items={tool.bodyParams || []} onChange={v => update({ bodyParams: v })} namePlaceholder="field name" />
                                                            </div>
                                                        )}
                                                        {tool.bodyType === 'raw' && (
                                                            <div className="mt-2">
                                                                <ValueInput multiline spec={tool.rawBody || { mode: 'fixed', value: '' }} onChange={v => update({ rawBody: v })} placeholder='{"key":"value"}' />
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Placeholders helper — lists contact + user-field + cross-tool tokens with copy buttons */}
                                                    <div>
                                                        <PlaceholdersPanel
                                                            userFields={userFields}
                                                            httpTools={httpTools}
                                                            currentToolName={tool.name}
                                                            onCopy={() => { /* feedback handled in row */ }} />
                                                    </div>
                                                    </>
                                                    )}

                                                    {/* Test Panel */}
                                                    <div className="pt-3 mt-2 border-t border-dashed border-border">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <h4 className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
                                                                <Play className="w-3.5 h-3.5" /> Test this tool
                                                            </h4>
                                                            <button
                                                                type="button"
                                                                onClick={() => runTest(tool)}
                                                                disabled={testStates[tool.id]?.loading}
                                                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-60"
                                                            >
                                                                {testStates[tool.id]?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                                                                Run Test
                                                            </button>
                                                        </div>

                                                        {(() => {
                                                            const aiFields = aiFieldsOf(tool);
                                                            if (aiFields.length === 0) {
                                                                return <p className="text-xs text-muted-foreground">All values are fixed — nothing to fill in. Click "Run Test".</p>;
                                                            }
                                                            return (
                                                                <div className="space-y-2">
                                                                    <p className="text-xs text-muted-foreground">Provide test values for AI-filled fields:</p>
                                                                    {aiFields.map(f => (
                                                                        <div key={f.key}>
                                                                            <label className="text-xs text-muted-foreground block mb-0.5">{f.label}</label>
                                                                            <input
                                                                                type="text"
                                                                                value={testStates[tool.id]?.values?.[f.key] || ''}
                                                                                onChange={e => setTestValue(tool.id, f.key, e.target.value)}
                                                                                placeholder="test value"
                                                                                className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                                                                            />
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            );
                                                        })()}

                                                        {testStates[tool.id]?.response && (
                                                            <div className="mt-3">
                                                                <div className="flex items-center gap-2 mb-1.5">
                                                                    <span className="text-xs text-muted-foreground">Response:</span>
                                                                    {testStates[tool.id].response.status !== undefined && (
                                                                        <span className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded ${testStates[tool.id].response.status >= 200 && testStates[tool.id].response.status < 300 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                                                            {testStates[tool.id].response.status}
                                                                        </span>
                                                                    )}
                                                                    {testStates[tool.id].response.error && (
                                                                        <span className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">error</span>
                                                                    )}
                                                                </div>
                                                                <pre className="bg-secondary/50 border border-border rounded-lg p-3 text-xs font-mono overflow-auto max-h-64 whitespace-pre-wrap break-all">
{typeof testStates[tool.id].response.data === 'object'
    ? JSON.stringify(testStates[tool.id].response.data, null, 2)
    : (testStates[tool.id].response.data ?? testStates[tool.id].response.error ?? '')}
                                                                </pre>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                                                        </div>
                                                    )}

                                                    {/* Live Operators specific: list + add/remove */}
                                                    {skill.id === 'live_operator' && (
                                                        <div>
                                                            <div className="flex items-center justify-between mb-2">
                                                                <div className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                                                                    <User className="w-3.5 h-3.5" /> Team
                                                                </div>
                                                                <button type="button" onClick={addOperator}
                                                                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors">
                                                                    <Plus className="w-3 h-3" /> Add operator
                                                                </button>
                                                            </div>
                                                            {operators.length === 0 ? (
                                                                <div className="bg-secondary/30 border border-dashed border-border rounded-xl p-4 text-center text-xs text-muted-foreground">
                                                                    No operators yet. Add at least one so the agent can ping a human teammate.
                                                                </div>
                                                            ) : (
                                                                <div className="space-y-3">
                                                                    {operators.map(op => (
                                                                        <div key={op.id} className="border border-border rounded-xl p-3 bg-secondary/20 space-y-2">
                                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                                                <div>
                                                                                    <label className="text-[10px] text-muted-foreground">Name</label>
                                                                                    <input type="text" value={op.name}
                                                                                        onChange={e => updateOperator(op.id, { name: e.target.value })}
                                                                                        placeholder="Tural"
                                                                                        className="w-full bg-secondary/40 border border-border rounded-lg px-2 py-1 text-sm" />
                                                                                </div>
                                                                                <div>
                                                                                    <label className="text-[10px] text-muted-foreground">WhatsApp phone (digits only)</label>
                                                                                    <input type="text" value={op.phone}
                                                                                        onChange={e => updateOperator(op.id, { phone: e.target.value })}
                                                                                        placeholder="994551234567"
                                                                                        className="w-full bg-secondary/40 border border-border rounded-lg px-2 py-1 text-sm font-mono" />
                                                                                </div>
                                                                            </div>
                                                                            <div className="grid grid-cols-3 gap-2">
                                                                                <div>
                                                                                    <label className="text-[10px] text-muted-foreground">Order</label>
                                                                                    <input type="number" min={0} value={op.order}
                                                                                        onChange={e => updateOperator(op.id, { order: Number(e.target.value) || 0 })}
                                                                                        className="w-full bg-secondary/40 border border-border rounded-lg px-2 py-1 text-sm" />
                                                                                </div>
                                                                                <div>
                                                                                    <label className="text-[10px] text-muted-foreground">Timeout (min)</label>
                                                                                    <input type="number" min={1} value={op.timeoutMin}
                                                                                        onChange={e => updateOperator(op.id, { timeoutMin: Number(e.target.value) || 30 })}
                                                                                        className="w-full bg-secondary/40 border border-border rounded-lg px-2 py-1 text-sm" />
                                                                                </div>
                                                                                <div className="flex items-end">
                                                                                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                                                                                        <input type="checkbox" checked={op.isActive}
                                                                                            onChange={e => updateOperator(op.id, { isActive: e.target.checked })}
                                                                                            className="w-3.5 h-3.5 accent-primary" />
                                                                                        Active
                                                                                    </label>
                                                                                </div>
                                                                            </div>
                                                                            <div>
                                                                                <label className="text-[10px] text-muted-foreground">Role / instructions (shown to the AI when deciding who to ask)</label>
                                                                                <textarea value={op.systemPrompt ?? ''}
                                                                                    onChange={e => updateOperator(op.id, { systemPrompt: e.target.value })}
                                                                                    rows={2}
                                                                                    placeholder="e.g. Handles pricing, discounts and stock checks for Istanbul projects."
                                                                                    className="w-full bg-secondary/40 border border-border rounded-lg px-2 py-1 text-sm" />
                                                                            </div>
                                                                            <div className="flex justify-end gap-2">
                                                                                <button type="button" onClick={() => removeOperator(op)}
                                                                                    className="text-xs px-2.5 py-1 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 inline-flex items-center gap-1">
                                                                                    <Trash2 className="w-3 h-3" /> {op._new ? 'Discard' : 'Delete'}
                                                                                </button>
                                                                                <button type="button" onClick={() => saveOperator(op)}
                                                                                    className="text-xs px-3 py-1 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
                                                                                    {op._new ? 'Save' : 'Update'}
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            <p className="text-[11px] text-muted-foreground mt-2 italic">
                                                                Order controls who gets pinged first when the agent escalates. If the first operator doesn't reply within their timeout, the ticket is forwarded to the next one in order.
                                                            </p>
                                                        </div>
                                                    )}

                                                    {/* Google Calendar specific: connection status + Connect CTA */}
                                                    {skill.id === 'google_calendar' && (
                                                        <div>
                                                            {googleCalendarStatus === null ? (
                                                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking connection…
                                                                </div>
                                                            ) : googleCalendarStatus.connected ? (
                                                                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 flex items-start gap-3">
                                                                    <GoogleCalendarLogo className="!w-7 !h-7 mt-0.5" />
                                                                    <div className="flex-1 min-w-0 space-y-1">
                                                                        <div className="text-xs font-medium text-emerald-300 flex items-center gap-1.5">
                                                                            <Check className="w-3.5 h-3.5" /> Google Calendar connected
                                                                        </div>
                                                                        <div className="text-[11px] text-muted-foreground truncate">
                                                                            Account: <span className="font-mono text-foreground/80">{googleCalendarStatus.email}</span>
                                                                            {" · "}Calendar: <span className="font-mono text-foreground/80">{googleCalendarStatus.calendarId || 'primary'}</span>
                                                                        </div>
                                                                        <a href="/dashboard/connectors" className="inline-block text-[11px] text-primary hover:underline">
                                                                            Manage in Connectors →
                                                                        </a>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-start gap-3">
                                                                    <GoogleCalendarLogo className="!w-7 !h-7 mt-0.5" />
                                                                    <div className="flex-1 min-w-0 space-y-2">
                                                                        <div className="text-xs font-medium text-amber-300">
                                                                            No Google Calendar connected to this workspace yet.
                                                                        </div>
                                                                        <p className="text-[11px] text-muted-foreground">
                                                                            The agent can't call any calendar tool until the workspace owner links a Google account. One connection covers every agent with this skill on.
                                                                        </p>
                                                                        <a href="/dashboard/connectors"
                                                                            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                                                                            Connect Google Calendar →
                                                                        </a>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Spacer so the fixed Save button doesn't overlap
                            the last form row when the user scrolls to the
                            bottom. Matches the button's vertical footprint
                            plus its bottom inset. */}
                        <div className="h-20" />
                    </div>
                </motion.div>
            )}

            {tab === 'settings' && (
                <button
                    onClick={handleSave}
                    disabled={saving}
                    title="Save Changes (Ctrl+S)"
                    aria-label="Save Changes"
                    className="fixed bottom-6 right-6 z-40 w-12 h-12 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full flex items-center justify-center shadow-lg shadow-primary/30 transition-all disabled:opacity-70"
                >
                    {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                </button>
            )}
        </div>
    );
}

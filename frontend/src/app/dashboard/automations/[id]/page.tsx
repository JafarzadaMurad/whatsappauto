"use client";

import { useEffect, useState, useCallback, use, useRef } from "react";
import {
    ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
    useNodesState, useEdgesState, addEdge, Handle, Position,
    type Node, type Edge, type Connection, type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Loader2, Save, Power, Trash2, Plus, Zap, MessageSquare, Bot, Tag, Clock, GitBranch, Camera, UserPlus, Send, Image as ImageIcon, Reply, X, Paperclip, History, EyeOff } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";

// ─── Node metadata ───
type NodeMeta = {
    label: string;
    category: "trigger" | "action" | "logic";
    icon: any;
    defaultData: Record<string, any>;
};

type NodeChannel = "wa" | "ig" | "generic";

const NODE_META: Record<string, NodeMeta & { channel?: NodeChannel }> = {
    // ─── WhatsApp triggers ───
    trigger_wa_keyword: {
        label: "WhatsApp · Keyword", category: "trigger", icon: Zap, channel: "wa",
        defaultData: { keywords: "", caseSensitive: false, matchMode: "contains" }
    },
    trigger_wa_any: {
        label: "WhatsApp · Any Message", category: "trigger", icon: MessageSquare, channel: "wa",
        defaultData: {}
    },
    trigger_wa_new_contact: {
        label: "WhatsApp · New Contact", category: "trigger", icon: UserPlus, channel: "wa",
        defaultData: {}
    },
    // ─── Instagram triggers ───
    trigger_ig_dm: {
        label: "Instagram · DM", category: "trigger", icon: MessageSquare, channel: "ig",
        defaultData: { accountId: "any", filterMode: "any", keywords: "", caseSensitive: false, matchMode: "contains" }
    },
    trigger_ig_new_contact: {
        label: "Instagram · New Contact", category: "trigger", icon: UserPlus, channel: "ig",
        defaultData: { accountId: "any" }
    },
    trigger_ig_post: {
        label: "Instagram · Post", category: "trigger", icon: Camera, channel: "ig",
        defaultData: { accountId: "any", mediaId: "any", keywords: "", caseSensitive: false, matchMode: "contains" }
    },
    // ─── WhatsApp actions ───
    action_wa_send_message: {
        label: "WhatsApp · Send Message", category: "action", icon: MessageSquare, channel: "wa",
        defaultData: { text: "", media: null }
    },
    // ─── Instagram actions ───
    action_ig_send_dm: {
        label: "Instagram · Send DM", category: "action", icon: Send, channel: "ig",
        defaultData: { text: "", media: null, quickReplies: [] }
    },
    action_ig_reply_comment: {
        label: "Instagram · Reply Comment", category: "action", icon: Reply, channel: "ig",
        defaultData: { text: "" }
    },
    action_ig_hide_comment: {
        label: "Instagram · Hide Comment", category: "action", icon: EyeOff, channel: "ig",
        defaultData: {}
    },
    action_ig_delete_comment: {
        label: "Instagram · Delete Comment", category: "action", icon: Trash2, channel: "ig",
        defaultData: {}
    },
    // ─── Generic actions / logic ───
    action_ai_reply: {
        label: "AI Agent Reply", category: "action", icon: Bot, channel: "generic",
        defaultData: { agentId: "" }
    },
    action_add_tag: {
        label: "Add Tag", category: "action", icon: Tag, channel: "generic",
        defaultData: { tag: "" }
    },
    action_set_user_field: {
        label: "Set User Field", category: "action", icon: Tag, channel: "generic",
        defaultData: { fieldKey: "", value: "" }
    },
    action_wait: {
        label: "Wait / Delay", category: "action", icon: Clock, channel: "generic",
        defaultData: { seconds: 60 }
    },
    condition: {
        label: "Condition", category: "logic", icon: GitBranch, channel: "generic",
        defaultData: { field: "message", operator: "contains", value: "" }
    },
    // ─── Legacy (kept so old saved automations still render) ───
    trigger_keyword: {
        label: "Keyword Trigger (legacy)", category: "trigger", icon: Zap,
        defaultData: { channel: "any", keywords: "", caseSensitive: false, matchMode: "contains" }
    },
    trigger_any_message: {
        label: "Any Message (legacy)", category: "trigger", icon: MessageSquare,
        defaultData: { channel: "any" }
    },
    trigger_comment: {
        label: "IG Comment (legacy)", category: "trigger", icon: Camera,
        defaultData: { accountId: "", mediaId: "any", keywords: "", caseSensitive: false, matchMode: "contains" }
    },
    trigger_ig_comment: {
        label: "IG Comment (legacy)", category: "trigger", icon: Camera,
        defaultData: { accountId: "any", mediaId: "any", keywords: "", caseSensitive: false, matchMode: "contains" }
    },
    trigger_ig_any: {
        label: "IG Any DM (legacy)", category: "trigger", icon: MessageSquare,
        defaultData: { accountId: "any" }
    },
    trigger_ig_keyword: {
        label: "IG DM Keyword (legacy)", category: "trigger", icon: Zap,
        defaultData: { accountId: "any", keywords: "", caseSensitive: false, matchMode: "contains" }
    },
    trigger_new_contact: {
        label: "New Contact (legacy)", category: "trigger", icon: UserPlus,
        defaultData: { channel: "any" }
    },
    action_send_message: {
        label: "Send Message (legacy)", category: "action", icon: MessageSquare,
        defaultData: { text: "" }
    },
    action_send_media: {
        label: "Send Media (legacy)", category: "action", icon: Paperclip,
        defaultData: { mediaKind: "image", url: "", caption: "", filename: "", mimetype: "" }
    },
    action_send_dm: {
        label: "Send IG DM (legacy)", category: "action", icon: Send,
        defaultData: { kind: "text", text: "", attachmentType: "image", url: "", elements: [], quickReplies: [] }
    },
    action_reply_comment: {
        label: "Reply Comment (legacy)", category: "action", icon: Reply,
        defaultData: { text: "" }
    },
};

const CATEGORY_COLOR: Record<string, { bg: string; border: string; text: string; dot: string }> = {
    trigger: { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-400", dot: "bg-emerald-500" },
    action: { bg: "bg-blue-500/10", border: "border-blue-500/40", text: "text-blue-400", dot: "bg-blue-500" },
    logic: { bg: "bg-amber-500/10", border: "border-amber-500/40", text: "text-amber-400", dot: "bg-amber-500" },
};

const PALETTE: { category: "trigger" | "action" | "logic"; label: string; channel?: NodeChannel; types: string[] }[] = [
    { category: "trigger", channel: "wa", label: "WhatsApp · Triggers", types: ["trigger_wa_keyword", "trigger_wa_any", "trigger_wa_new_contact"] },
    { category: "trigger", channel: "ig", label: "Instagram · Triggers", types: ["trigger_ig_dm", "trigger_ig_new_contact", "trigger_ig_post"] },
    { category: "action", channel: "wa", label: "WhatsApp · Actions", types: ["action_wa_send_message"] },
    { category: "action", channel: "ig", label: "Instagram · Actions", types: ["action_ig_send_dm", "action_ig_reply_comment", "action_ig_hide_comment", "action_ig_delete_comment"] },
    { category: "action", channel: "generic", label: "Generic Actions", types: ["action_ai_reply", "action_add_tag", "action_set_user_field", "action_wait"] },
    { category: "logic", channel: "generic", label: "Logic", types: ["condition"] },
];

// Channel-tinted background per palette group. Uses lucide colour
// tokens for consistency with the rest of the app (WA = emerald,
// IG = pink, generic = slate). The category ring stays the same
// (trigger = emerald, action = blue, logic = amber) so the shape
// of the node still tells you what it does at a glance.
const CHANNEL_TINT: Record<NodeChannel, { bg: string; border: string; text: string; label: string }> = {
    wa:      { bg: 'bg-emerald-500/5',  border: 'border-emerald-500/25', text: 'text-emerald-300', label: 'WhatsApp' },
    ig:      { bg: 'bg-pink-500/5',     border: 'border-pink-500/25',    text: 'text-pink-300',    label: 'Instagram' },
    generic: { bg: 'bg-secondary/40',   border: 'border-border',         text: 'text-muted-foreground', label: 'Generic' },
};

// ─── Variable chip helpers ───────────────────────────────────────────
// Text stays as plain strings with `{{var}}` markers on disk (backwards
// compatible with the engine's interpolate). Only the *rendering* is
// enriched: chips in the node body, chips inline inside the editor.
const VAR_TOKEN_RE = /(\{\{\s*\w+\s*\}\})/g;
const VAR_CAPTURE_RE = /^\{\{\s*(\w+)\s*\}\}$/;

// Inline chip style used by both the read-only summary and the
// contentEditable innerHTML. Inline CSS so it doesn't need globals.css.
const CHIP_INLINE_STYLE =
    'display:inline-block;padding:0 6px;margin:0 2px;background:rgba(139,92,246,0.18);' +
    'color:rgb(196,181,253);border:1px solid rgba(139,92,246,0.45);border-radius:5px;' +
    'font-size:0.85em;font-family:ui-monospace,Menlo,monospace;font-weight:500;' +
    'cursor:default;user-select:none;vertical-align:baseline;';

function TextWithChips({ text }: { text: string }) {
    if (!text) return null;
    const parts = text.split(VAR_TOKEN_RE);
    return (
        <>
            {parts.map((p, i) => {
                const m = p.match(VAR_CAPTURE_RE);
                if (m) return <span key={i} style={{ padding: '0 6px', margin: '0 2px', background: 'rgba(139,92,246,0.18)', color: 'rgb(196,181,253)', border: '1px solid rgba(139,92,246,0.45)', borderRadius: '5px', fontFamily: 'ui-monospace,Menlo,monospace', fontSize: '0.85em', fontWeight: 500 }}>{m[1]}</span>;
                return <span key={i}>{p}</span>;
            })}
        </>
    );
}

const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const stringToChipHtml = (s: string): string => {
    if (!s) return '';
    return s.split(VAR_TOKEN_RE).map(part => {
        const m = part.match(VAR_CAPTURE_RE);
        if (m) {
            const v = m[1];
            return `<span style="${CHIP_INLINE_STYLE}" contenteditable="false" data-var="${v}">${v}</span>`;
        }
        return escapeHtml(part).replace(/\n/g, '<br>');
    }).join('');
};

const chipHtmlToString = (el: HTMLElement): string => {
    let out = '';
    el.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            // Strip zero-width spaces we use for cursor placement.
            out += (node.textContent || '').replace(/​/g, '');
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const e = node as HTMLElement;
            if (e.dataset.var) {
                out += `{{${e.dataset.var}}}`;
            } else if (e.tagName === 'BR') {
                out += '\n';
            } else if (e.tagName === 'DIV') {
                if (out && !out.endsWith('\n')) out += '\n';
                out += chipHtmlToString(e);
            } else {
                out += chipHtmlToString(e);
            }
        }
    });
    return out;
};

function VariableTextEditor({
    value, onChange, variables, rows = 4, hint,
}: {
    value: string;
    onChange: (v: string) => void;
    variables: string[];
    rows?: number;
    hint?: string;
}) {
    const editorRef = useRef<HTMLDivElement | null>(null);
    const skipNextExternal = useRef(false);
    const [dragOver, setDragOver] = useState(false);

    // Sync from external `value` when it differs from what we currently render.
    useEffect(() => {
        const el = editorRef.current;
        if (!el) return;
        if (skipNextExternal.current) { skipNextExternal.current = false; return; }
        const current = chipHtmlToString(el);
        if (current === value) return;
        el.innerHTML = stringToChipHtml(value);
    }, [value]);

    const emitChange = () => {
        const el = editorRef.current;
        if (!el) return;
        skipNextExternal.current = true;
        onChange(chipHtmlToString(el));
    };

    const insertVariable = (v: string, atRange?: Range) => {
        const el = editorRef.current;
        if (!el) return;
        el.focus();
        const sel = window.getSelection();
        if (!sel) return;
        let range = atRange || (sel.rangeCount ? sel.getRangeAt(0) : null);
        if (!range || !el.contains(range.commonAncestorContainer)) {
            range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
        }
        const chip = document.createElement('span');
        chip.setAttribute('style', CHIP_INLINE_STYLE);
        chip.contentEditable = 'false';
        chip.dataset.var = v;
        chip.textContent = v;
        range.deleteContents();
        range.insertNode(chip);
        // Zero-width space so caret has a place to sit after the chip.
        const zws = document.createTextNode('​');
        chip.parentNode?.insertBefore(zws, chip.nextSibling);
        const after = document.createRange();
        after.setStartAfter(zws);
        after.setEndAfter(zws);
        sel.removeAllRanges();
        sel.addRange(after);
        emitChange();
    };

    const onPaste = (e: React.ClipboardEvent) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        // Convert on paste so `{{var}}` typed elsewhere becomes a real chip.
        const html = stringToChipHtml(text);
        document.execCommand('insertHTML', false, html);
        emitChange();
    };

    const onDrop = (e: React.DragEvent) => {
        setDragOver(false);
        const v = e.dataTransfer.getData('text/x-variable');
        if (!v) return;
        e.preventDefault();
        const doc = document as any;
        let dropRange: Range | null = null;
        if (doc.caretRangeFromPoint) dropRange = doc.caretRangeFromPoint(e.clientX, e.clientY);
        else if (doc.caretPositionFromPoint) {
            const cp = doc.caretPositionFromPoint(e.clientX, e.clientY);
            if (cp) { dropRange = document.createRange(); dropRange.setStart(cp.offsetNode, cp.offset); dropRange.collapse(true); }
        }
        insertVariable(v, dropRange || undefined);
    };

    return (
        <div>
            <div className="flex gap-1.5 mb-2 flex-wrap">
                {variables.map(v => (
                    <button key={v}
                        type="button"
                        draggable
                        onDragStart={e => { e.dataTransfer.setData('text/x-variable', v); e.dataTransfer.effectAllowed = 'copy'; }}
                        onClick={() => insertVariable(v)}
                        title={`Drag or click to insert {{${v}}}`}
                        className="inline-flex items-center gap-0.5 text-[11px] font-mono px-2 py-1 rounded-md bg-violet-500/15 border border-violet-500/40 text-violet-300 hover:bg-violet-500/25 cursor-grab active:cursor-grabbing select-none">
                        <span className="opacity-50">{'{{'}</span>{v}<span className="opacity-50">{'}}'}</span>
                    </button>
                ))}
            </div>
            <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={emitChange}
                onPaste={onPaste}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                style={{ minHeight: `${rows * 1.5}em`, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                className={`w-full bg-secondary/50 border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 ${dragOver ? 'border-primary/60 ring-2 ring-primary/40' : 'border-border'}`}
            />
            {hint && <p className="text-[10px] text-muted-foreground/80 mt-1">{hint}</p>}
        </div>
    );
}

// ─── Custom node component ───
function FlowNode({ id, type, data, selected }: NodeProps) {
    const meta = NODE_META[type as string];
    if (!meta) return null;
    const c = CATEGORY_COLOR[meta.category];
    const Icon = meta.icon;
    const isTrigger = meta.category === "trigger";
    const isCondition = type === "condition";

    const d = data as Record<string, any>;
    let summary = "";
    const kwSummary = d.keywords || "(no keywords)";
    if (type === "trigger_wa_keyword" || type === "trigger_ig_keyword" || type === "trigger_keyword") summary = kwSummary;
    else if (type === "trigger_ig_dm") {
        const mode = d.filterMode || 'any';
        summary = mode === 'keyword' ? `keyword: ${d.keywords || '(none)'}` : 'any DM';
    }
    else if (type === "trigger_wa_any" || type === "trigger_wa_new_contact" || type === "trigger_ig_any" || type === "trigger_ig_new_contact") summary = "—";
    else if (type === "trigger_ig_post" || type === "trigger_ig_comment" || type === "trigger_comment") {
        const post = d.mediaId && d.mediaId !== 'any' ? '1 post' : 'any post';
        const kw = d.keywords ? ` · "${d.keywords}"` : '';
        summary = `${post}${kw}`;
    }
    else if (type === "trigger_any_message" || type === "trigger_new_contact") summary = `channel: ${d.channel}`;
    else if (type === "action_wa_send_message" || type === "action_send_message") {
        const t = d.text || '';
        const m = d.media?.url ? ` 📎 ${d.media.kind || 'image'}` : '';
        summary = (t || (d.media?.url ? '(media only)' : '(empty)')) + m;
    }
    else if (type === "action_ig_send_dm") {
        const t = d.text || '';
        const m = d.media?.url ? ` 📎 ${d.media.kind || 'image'}` : '';
        const qr = (d.quickReplies || []).length;
        summary = (t || (d.media?.url ? '(media only)' : '(empty)')) + m + (qr ? ` · ${qr} QR` : '');
    }
    else if (type === "action_send_media") summary = `${d.mediaKind || 'image'}: ${d.url || '(no url)'}`;
    else if (type === "action_send_dm") {
        const kind = d.kind || 'text';
        if (kind === 'text') summary = d.text ? `DM: ${d.text}` : "(empty)";
        else if (kind === 'attachment') summary = `DM ${d.attachmentType || 'image'}: ${d.url || '(no url)'}`;
        else summary = `DM template (${(d.elements || []).length} card${(d.elements || []).length === 1 ? '' : 's'})`;
    }
    else if (type === "action_ig_reply_comment" || type === "action_reply_comment") summary = d.text || "(empty)";
    else if (type === "action_ai_reply") summary = d.agentName || (d.agentId ? "agent set" : "(no agent)");
    else if (type === "action_add_tag") summary = d.tag || "(no tag)";
    else if (type === "action_set_user_field") summary = d.fieldKey ? `${d.fieldKey} = ${d.value || '(empty)'}` : "(no field)";
    else if (type === "action_wait") summary = `${d.seconds || 0}s`;
    else if (type === "condition") summary = `${d.field} ${d.operator} ${d.value || "?"}`;

    // Channel-tinted left ribbon so IG vs WA vs Generic is legible at
    // a glance without needing to read the label.
    const channelKey: NodeChannel = (meta as any).channel || 'generic';
    const tint = CHANNEL_TINT[channelKey];
    const ribbon =
        channelKey === 'ig' ? 'bg-pink-500'      :
        channelKey === 'wa' ? 'bg-emerald-500'   :
                              'bg-muted-foreground/40';

    return (
        <div className={`relative rounded-xl border-2 bg-card min-w-[180px] max-w-[240px] ${selected ? c.border : "border-border"} shadow-md overflow-hidden`}>
            <div className={`absolute left-0 top-0 bottom-0 w-1 ${ribbon}`} />
            {!isTrigger && <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-muted-foreground" />}
            <div className={`flex items-center gap-2 pl-4 pr-3 py-2 rounded-t-[10px] ${c.bg}`}>
                <Icon className={`w-4 h-4 ${c.text}`} />
                <span className="text-sm font-semibold truncate">{meta.label}</span>
                {channelKey !== 'generic' && (
                    <span className={`ml-auto text-[9px] font-semibold uppercase tracking-wide ${tint.text}`}>{tint.label}</span>
                )}
            </div>
            <div className="pl-4 pr-3 py-2 text-xs text-muted-foreground break-words"><TextWithChips text={summary} /></div>
            {isCondition ? (
                <>
                    <Handle id="true" type="source" position={Position.Right} style={{ top: "40%" }} className="!w-3 !h-3 !bg-emerald-500" />
                    <Handle id="false" type="source" position={Position.Right} style={{ top: "70%" }} className="!w-3 !h-3 !bg-red-500" />
                </>
            ) : (
                <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-muted-foreground" />
            )}
        </div>
    );
}

const nodeTypes = Object.keys(NODE_META).reduce((acc, t) => { acc[t] = FlowNode; return acc; }, {} as any);

let idCounter = 1;
const genId = () => `n${Date.now()}_${idCounter++}`;

function Editor({ id }: { id: string }) {
    const [name, setName] = useState("");
    const [isActive, setIsActive] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [agents, setAgents] = useState<any[]>([]);
    const [igAccounts, setIgAccounts] = useState<any[]>([]);
    const [waInstances, setWaInstances] = useState<any[]>([]);
    const [userFields, setUserFields] = useState<any[]>([]);
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [addNodeOpen, setAddNodeOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'editor' | 'executions'>('editor');
    const [executions, setExecutions] = useState<any[]>([]);
    const [loadingExecutions, setLoadingExecutions] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    const loadExecutions = useCallback(async () => {
        setLoadingExecutions(true);
        try {
            const r = await api.get(`/automations/${id}/executions`);
            if (r.data?.success) setExecutions(r.data.executions || []);
        } catch (e) { /* ignore — endpoint may not exist yet */ }
        finally { setLoadingExecutions(false); }
    }, [id]);

    useEffect(() => {
        if (activeTab === 'executions') loadExecutions();
    }, [activeTab, loadExecutions]);

    useEffect(() => {
        const load = async () => {
            try {
                const [aRes, agRes, igRes, waRes, ufRes] = await Promise.all([
                    api.get(`/automations/${id}`),
                    api.get('/agents'),
                    api.get('/instagram/accounts').catch(() => ({ data: { success: false } })),
                    api.get('/instances').catch(() => ({ data: { success: false } })),
                    api.get('/user-fields').catch(() => ({ data: { success: false } })),
                ]);
                if (aRes.data.success) {
                    const a = aRes.data.automation;
                    setName(a.name);
                    setIsActive(a.isActive);
                    setNodes((a.nodes || []) as Node[]);
                    setEdges((a.edges || []) as Edge[]);
                }
                if (agRes.data.success) setAgents(agRes.data.agents);
                if (igRes.data.success) setIgAccounts(igRes.data.accounts || []);
                if (waRes.data.success) setWaInstances(waRes.data.instances || []);
                if (ufRes.data.success) setUserFields(ufRes.data.fields || []);
            } catch (err) { console.error(err); }
            finally { setLoading(false); }
        };
        load();
    }, [id, setNodes, setEdges]);

    const onConnect = useCallback((conn: Connection) => {
        setEdges(eds => addEdge({ ...conn, id: genId() }, eds));
    }, [setEdges]);

    const addNode = (type: string) => {
        const meta = NODE_META[type];
        const newNode: Node = {
            id: genId(),
            type,
            position: { x: 120 + Math.random() * 200, y: 80 + Math.random() * 200 },
            data: { ...meta.defaultData }
        };
        setNodes(nds => [...nds, newNode]);
        setSelectedId(newNode.id);
    };

    const updateNodeData = (nodeId: string, patch: Record<string, any>) => {
        setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n));
    };

    const deleteNode = (nodeId: string) => {
        setNodes(nds => nds.filter(n => n.id !== nodeId));
        setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId));
        if (selectedId === nodeId) setSelectedId(null);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const cleanNodes = nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data }));
            const cleanEdges = edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null }));
            await api.put(`/automations/${id}`, { name, isActive, nodes: cleanNodes, edges: cleanEdges });
        } catch (err) { console.error(err); }
        finally { setSaving(false); }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-screen">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
    );

    const selectedNode = nodes.find(n => n.id === selectedId);

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)]">
            {/* Top bar */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
                <Link href="/dashboard/automations" className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="w-5 h-5" />
                </Link>
                <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 w-64"
                />
                <button
                    onClick={() => setIsActive(v => !v)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${isActive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-secondary/50 text-muted-foreground border-border'}`}
                >
                    <Power className="w-4 h-4" /> {isActive ? 'Active' : 'Inactive'}
                </button>

                {/* Tabs */}
                <div className="ml-4 inline-flex bg-secondary/50 border border-border rounded-lg p-0.5">
                    <button onClick={() => setActiveTab('editor')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${activeTab === 'editor' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                        Editor
                    </button>
                    <button onClick={() => setActiveTab('executions')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${activeTab === 'executions' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                        <History className="w-3 h-3" />
                        Executions
                    </button>
                </div>

                <div className="flex-1" />
                <button onClick={handleSave} disabled={saving}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg px-4 py-1.5 flex items-center gap-2 text-sm transition-all disabled:opacity-70">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save
                </button>
            </div>

            {activeTab === 'editor' ? (
                <div className="flex flex-1 min-h-0 relative">
                    {/* Canvas */}
                    <div className="flex-1 min-w-0" ref={wrapperRef}>
                        <ReactFlow
                            nodes={nodes}
                            edges={edges}
                            onNodesChange={onNodesChange}
                            onEdgesChange={onEdgesChange}
                            onConnect={onConnect}
                            onNodeClick={(_, n) => setSelectedId(n.id)}
                            onPaneClick={() => setSelectedId(null)}
                            nodeTypes={nodeTypes}
                            colorMode="dark"
                            fitView
                            proOptions={{ hideAttribution: true }}
                        >
                            <Background />
                            <Controls />
                            <MiniMap pannable zoomable className="!bg-card" />
                        </ReactFlow>
                    </div>

                    {/* Floating "+" button to open Add Node modal */}
                    {!selectedNode && (
                        <button onClick={() => setAddNodeOpen(true)}
                            title="Add node"
                            className="absolute top-4 right-4 z-20 w-11 h-11 rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-105 active:scale-95 transition-transform flex items-center justify-center">
                            <Plus className="w-5 h-5" />
                        </button>
                    )}

                    {/* Config panel */}
                    {selectedNode && (
                        <div className="w-80 flex-shrink-0 border-l border-border bg-card overflow-y-auto p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold text-sm">{NODE_META[selectedNode.type as string]?.label}</h3>
                                <button onClick={() => deleteNode(selectedNode.id)}
                                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                            <NodeConfig node={selectedNode} agents={agents} igAccounts={igAccounts} waInstances={waInstances} userFields={userFields} onChange={(patch) => updateNodeData(selectedNode.id, patch)} />
                        </div>
                    )}

                    {/* Add Node modal */}
                    {addNodeOpen && (
                        <AddNodeModal
                            onPick={(t) => { addNode(t); setAddNodeOpen(false); }}
                            onClose={() => setAddNodeOpen(false)}
                        />
                    )}
                </div>
            ) : (
                <ExecutionsView executions={executions} loading={loadingExecutions} onRefresh={loadExecutions} />
            )}
        </div>
    );
}

// ─── Add Node modal (centered, searchable, tab-filtered, channel-tinted) ───
type PaletteTab = 'all' | 'trigger' | 'action';

function AddNodeModal({ onPick, onClose }: { onPick: (type: string) => void; onClose: () => void }) {
    const [query, setQuery] = useState("");
    const [tab, setTab] = useState<PaletteTab>('all');
    const q = query.trim().toLowerCase();

    const groups = PALETTE
        .filter(g => tab === 'all' || (tab === 'trigger' && g.category === 'trigger') || (tab === 'action' && (g.category === 'action' || g.category === 'logic')))
        .map(g => ({
            ...g,
            types: g.types.filter(t => {
                if (!q) return true;
                const meta = NODE_META[t];
                return meta.label.toLowerCase().includes(q) || t.toLowerCase().includes(q);
            })
        }))
        .filter(g => g.types.length > 0);

    return (
        <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-start justify-center pt-20 p-4" onClick={onClose}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[75vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="p-3 border-b border-border space-y-3">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/50 border border-border focus-within:ring-2 focus-within:ring-primary/40">
                        <Plus className="w-4 h-4 text-muted-foreground rotate-45" />
                        <input
                            autoFocus
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search node…"
                            className="flex-1 bg-transparent outline-none text-sm" />
                        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    {/* Category tabs — All / Triggers / Actions. Logic
                        nodes tuck under Actions since they're side-by-
                        side in a flow. */}
                    <div className="flex items-center gap-1.5">
                        {([
                            { id: 'all',     label: 'All' },
                            { id: 'trigger', label: 'Triggers' },
                            { id: 'action',  label: 'Actions' },
                        ] as { id: PaletteTab; label: string }[]).map(t => (
                            <button key={t.id} onClick={() => setTab(t.id)}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${tab === t.id
                                    ? 'bg-primary/15 border-primary/40 text-foreground'
                                    : 'bg-secondary/40 border-border text-muted-foreground hover:text-foreground'}`}>
                                {t.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                    {groups.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">No matches.</p>
                    ) : groups.map(group => {
                        const tint = CHANNEL_TINT[group.channel || 'generic'];
                        return (
                            <div key={group.label}>
                                <div className="flex items-center gap-2 mb-2 px-1">
                                    <div className={`w-2 h-2 rounded-full ${CATEGORY_COLOR[group.category].dot}`} />
                                    <span className="text-[11px] font-semibold uppercase text-muted-foreground tracking-wide">{group.label}</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {group.types.map(t => {
                                        const meta = NODE_META[t];
                                        const Icon = meta.icon;
                                        return (
                                            <button key={t} onClick={() => onPick(t)}
                                                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border ${tint.border} ${tint.bg} hover:brightness-125 hover:border-primary/60 text-left text-sm transition-all`}>
                                                <div className={`w-8 h-8 rounded-lg ${CATEGORY_COLOR[group.category].bg} flex items-center justify-center flex-shrink-0`}>
                                                    <Icon className={`w-4 h-4 ${CATEGORY_COLOR[group.category].text}`} />
                                                </div>
                                                <span className={`truncate font-medium ${tint.text}`}>{meta.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

// ─── Executions view ───
function ExecutionsView({ executions, loading, onRefresh }: { executions: any[]; loading: boolean; onRefresh: () => void }) {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selected = executions.find(e => e.id === selectedId) || executions[0];

    return (
        <div className="flex flex-1 min-h-0">
            <div className="w-80 flex-shrink-0 border-r border-border bg-card overflow-y-auto">
                <div className="sticky top-0 bg-card border-b border-border p-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Executions</h3>
                    <button onClick={onRefresh} className="text-xs text-primary hover:underline">Refresh</button>
                </div>
                {loading ? (
                    <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                ) : executions.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8 px-4">No executions yet. Once a trigger fires, runs will appear here.</p>
                ) : (
                    <div className="divide-y divide-border">
                        {executions.map(ex => {
                            const isActive = selected?.id === ex.id;
                            const ok = ex.status === 'success';
                            return (
                                <button key={ex.id} onClick={() => setSelectedId(ex.id)}
                                    className={`w-full text-left p-3 hover:bg-secondary/40 transition-colors ${isActive ? 'bg-secondary/60' : ''}`}>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                        <span className="text-xs font-medium">{new Date(ex.startedAt).toLocaleString()}</span>
                                    </div>
                                    <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                                        <span className={ok ? 'text-emerald-400' : 'text-red-400'}>{ok ? 'Succeeded' : 'Failed'}</span>
                                        <span>· {ex.durationMs}ms</span>
                                        <span>· {ex.triggerType?.replace(/^trigger_/, '')}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
                {!selected ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Select an execution to see details.</div>
                ) : (
                    <div className="max-w-3xl space-y-5">
                        <div>
                            <div className="flex items-center gap-3 mb-1">
                                <h2 className="text-lg font-semibold">{new Date(selected.startedAt).toLocaleString()}</h2>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${selected.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                    {selected.status === 'success' ? 'Succeeded' : 'Failed'}
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Took {selected.durationMs}ms · {selected.nodesExecuted ?? 0} nodes · ID #{selected.id.slice(-8)}
                            </p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 rounded-xl border border-border bg-secondary/20">
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Trigger</p>
                                <p className="text-sm">{selected.triggerType}</p>
                            </div>
                            <div className="p-3 rounded-xl border border-border bg-secondary/20">
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Channel</p>
                                <p className="text-sm capitalize">{selected.channel}</p>
                            </div>
                            <div className="p-3 rounded-xl border border-border bg-secondary/20">
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Contact</p>
                                <p className="text-sm">{selected.contactName || selected.contactId || '—'}</p>
                            </div>
                            <div className="p-3 rounded-xl border border-border bg-secondary/20">
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Message</p>
                                <p className="text-sm break-words">{selected.inputText || '—'}</p>
                            </div>
                        </div>
                        {selected.errorMessage && (
                            <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/5">
                                <p className="text-[10px] uppercase tracking-wide text-red-400 mb-1">Error</p>
                                <p className="text-sm font-mono text-red-300">{selected.errorMessage}</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Per-node config fields ───
function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
            {children}
        </div>
    );
}

const inputCls = "w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50";

// ─── Reusable media picker: paste a URL OR upload from disk ───
function MediaPicker({
    media, onChange, allowedKinds = ["image", "video", "audio", "document"]
}: {
    media: { kind?: string; url?: string; filename?: string; mimetype?: string } | null;
    onChange: (m: any) => void;
    allowedKinds?: string[];
}) {
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const m = media || {};

    const detectKind = (mime: string): string => {
        if (mime.startsWith("image/")) return "image";
        if (mime.startsWith("video/")) return "video";
        if (mime.startsWith("audio/")) return "audio";
        return "document";
    };

    const detectKindFromUrl = (url: string): string => {
        const ext = (url.split("?")[0].split(".").pop() || "").toLowerCase();
        if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) return "image";
        if (["mp4", "mov", "webm", "avi", "mkv"].includes(ext)) return "video";
        if (["mp3", "ogg", "wav", "aac", "m4a", "flac"].includes(ext)) return "audio";
        return "document";
    };

    const upload = async (file: File) => {
        setError(null);
        setUploading(true);
        try {
            const form = new FormData();
            form.append("file", file);
            const r = await api.post("/uploads", form, { headers: { "Content-Type": "multipart/form-data" } });
            if (r.data?.success) {
                onChange({
                    kind: detectKind(r.data.mimetype || ""),
                    url: r.data.url,
                    filename: r.data.filename,
                    mimetype: r.data.mimetype,
                });
            } else {
                setError(r.data?.message || "Upload failed");
            }
        } catch (e: any) {
            setError(e.response?.data?.message || e.message);
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    if (!m.url) {
        return (
            <div className="space-y-2">
                <div className="flex gap-2">
                    <button onClick={() => fileRef.current?.click()} disabled={uploading}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border bg-secondary/30 hover:bg-secondary/60 text-xs disabled:opacity-60">
                        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                        Upload file
                    </button>
                    <input ref={fileRef} type="file" className="hidden"
                        onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
                </div>
                <div className="text-[10px] text-center text-muted-foreground">or paste a public URL</div>
                <div className="flex gap-2">
                    <input type="url" placeholder="https://yourdomain.com/file.jpg"
                        onChange={e => {
                            const url = e.target.value.trim();
                            if (url) onChange({ kind: detectKindFromUrl(url), url });
                        }}
                        className={inputCls} />
                </div>
                {error && <p className="text-[10px] text-red-400">{error}</p>}
            </div>
        );
    }

    const notAllowed = m.kind && !allowedKinds.includes(m.kind);
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2 p-2 rounded-lg border border-border bg-secondary/30">
                {m.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt="" className="w-12 h-12 object-cover rounded" />
                ) : (
                    <div className="w-12 h-12 rounded bg-secondary flex items-center justify-center">
                        {m.kind === "video" ? <Camera className="w-5 h-5 text-muted-foreground" /> :
                            m.kind === "audio" ? <MessageSquare className="w-5 h-5 text-muted-foreground" /> :
                                <Paperclip className="w-5 h-5 text-muted-foreground" />}
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <p className="text-xs truncate">{m.filename || m.url}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{m.kind}{m.mimetype ? ` · ${m.mimetype}` : ''}</p>
                </div>
                <button onClick={() => onChange(null)}
                    className="text-muted-foreground hover:text-red-400 p-1">
                    <X className="w-4 h-4" />
                </button>
            </div>
            {notAllowed && (
                <p className="text-[10px] text-amber-400/90">
                    Instagram doesn&apos;t accept {m.kind}s — the URL will be sent as a text link instead.
                </p>
            )}
        </div>
    );
}

// ─── Instagram comment trigger: account + post picker ───
function CommentTriggerConfig({ d, igAccounts, onChange }: { d: Record<string, any>; igAccounts: any[]; onChange: (p: Record<string, any>) => void }) {
    const [media, setMedia] = useState<any[]>([]);
    const [loadingMedia, setLoadingMedia] = useState(false);
    const [mediaError, setMediaError] = useState<string | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    // Effective account id we'll fetch media from — 'any' or empty is
    // NOT a valid Meta account id, so fall back to the first connected
    // account. The stored trigger.accountId can still be 'any' (engine
    // matches against every account); the picker just needs A real one
    // to talk to Meta.
    const accountId = (d.accountId && d.accountId !== 'any') ? d.accountId : (igAccounts[0]?.id || '');
    const selectedPost = media.find(m => m.id === d.mediaId);

    useEffect(() => {
        // Bootstrap: if no accountId at all, plant the first connected
        // account so the media picker knows what to query.
        if ((!d.accountId || d.accountId === 'any') && igAccounts[0]?.id) {
            onChange({ accountId: igAccounts[0].id });
        }
    }, [igAccounts.length]);

    useEffect(() => {
        if (!accountId) return;
        setLoadingMedia(true);
        setMediaError(null);
        api.get(`/instagram/accounts/${accountId}/media`).then(r => {
            if (r.data?.success) setMedia(r.data.media || []);
            else setMediaError(r.data?.message || 'Could not load posts');
        }).catch(e => {
            setMediaError(e?.response?.data?.message || e.message);
        }).finally(() => setLoadingMedia(false));
    }, [accountId]);

    if (igAccounts.length === 0) {
        return (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
                Connect an Instagram account first under <Link href="/dashboard/instagram" className="underline">Networks → Instagram</Link>.
            </div>
        );
    }

    return (
        <>
            <Field label="Instagram account">
                <select value={accountId}
                    onChange={e => onChange({ accountId: e.target.value, mediaId: 'any' })}
                    className={inputCls}>
                    {igAccounts.map(a => <option key={a.id} value={a.id}>@{a.igUsername}</option>)}
                </select>
            </Field>
            <Field label="Trigger on comments to">
                <div className="flex items-center gap-2">
                    <select value={d.mediaId === 'any' || !d.mediaId ? 'any' : 'specific'}
                        onChange={e => {
                            if (e.target.value === 'any') onChange({ mediaId: 'any' });
                            else setPickerOpen(true);
                        }}
                        className={inputCls}>
                        <option value="any">Any post</option>
                        <option value="specific">A specific post…</option>
                    </select>
                </div>
                {d.mediaId && d.mediaId !== 'any' && (
                    <div className="mt-2 flex items-center gap-2 p-2 rounded-lg border border-border bg-secondary/30">
                        {selectedPost?.thumbnail_url || selectedPost?.media_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={selectedPost.thumbnail_url || selectedPost.media_url} alt="" className="w-10 h-10 object-cover rounded" />
                        ) : (
                            <div className="w-10 h-10 rounded bg-secondary flex items-center justify-center">
                                <ImageIcon className="w-4 h-4 text-muted-foreground" />
                            </div>
                        )}
                        <div className="flex-1 min-w-0">
                            <p className="text-xs truncate">{selectedPost?.caption || `Post ${d.mediaId.slice(-6)}`}</p>
                            <button onClick={() => setPickerOpen(true)} className="text-[10px] text-primary hover:underline">Change</button>
                        </div>
                    </div>
                )}
            </Field>

            {pickerOpen && (
                <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPickerOpen(false)}>
                    <div className="bg-card border border-border rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-border">
                            <h3 className="font-semibold">Pick a post</h3>
                            <button onClick={() => setPickerOpen(false)} className="text-muted-foreground hover:text-foreground">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            {loadingMedia ? (
                                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                            ) : mediaError ? (
                                <div className="text-center py-8 px-4">
                                    <p className="text-sm text-red-400 break-words">{mediaError}</p>
                                    <p className="text-xs text-muted-foreground mt-2">Check that this Instagram account still has a valid token — reconnect from Networks → Instagram if needed.</p>
                                </div>
                            ) : media.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-8">No posts found on this account.</p>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                    {media.map(m => (
                                        <button key={m.id}
                                            onClick={() => { onChange({ mediaId: m.id, permalink: m.permalink || '' }); setPickerOpen(false); }}
                                            className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${d.mediaId === m.id ? 'border-primary' : 'border-border hover:border-primary/50'}`}>
                                            {m.thumbnail_url || m.media_url ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={m.thumbnail_url || m.media_url} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full bg-secondary flex items-center justify-center">
                                                    <ImageIcon className="w-6 h-6 text-muted-foreground" />
                                                </div>
                                            )}
                                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                                                <p className="text-[10px] text-white truncate">{m.caption || '(no caption)'}</p>
                                                <p className="text-[9px] text-white/60">{m.comments_count ?? 0} comments · {m.like_count ?? 0} likes</p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// ─── Rich Instagram DM action config ───
function SendDmConfig({ d, onChange }: { d: Record<string, any>; onChange: (p: Record<string, any>) => void }) {
    const kind = d.kind || 'text';
    const quickReplies: { title: string; payload?: string }[] = d.quickReplies || [];
    const elements: any[] = d.elements || [];

    const setQr = (next: any[]) => onChange({ quickReplies: next });
    const setEls = (next: any[]) => onChange({ elements: next });

    return (
        <div className="space-y-3">
            <Field label="Content type">
                <select value={kind} onChange={e => onChange({ kind: e.target.value })} className={inputCls}>
                    <option value="text">Text</option>
                    <option value="attachment">Image / Video / Audio</option>
                    <option value="template">Card (template with buttons)</option>
                </select>
            </Field>

            {kind === 'text' && (
                <Field label="Message text">
                    <VariableTextEditor value={d.text || ''} onChange={(t) => onChange({ text: t })} rows={5}
                        variables={["username", "name", "comment", "message", "post_url"]} />
                </Field>
            )}

            {kind === 'attachment' && (
                <>
                    <Field label="Attachment type">
                        <select value={d.attachmentType || 'image'} onChange={e => onChange({ attachmentType: e.target.value })} className={inputCls}>
                            <option value="image">Image (JPG / PNG)</option>
                            <option value="video">Video (MP4)</option>
                            <option value="audio">Audio (MP3)</option>
                        </select>
                    </Field>
                    <Field label="Public URL">
                        <input type="url" value={d.url || ''} onChange={e => onChange({ url: e.target.value })}
                            placeholder="https://yourdomain.com/file.jpg" className={inputCls} />
                    </Field>
                    <p className="text-[10px] text-muted-foreground">The file must be publicly accessible by Instagram's servers.</p>
                </>
            )}

            {kind === 'template' && (
                <div className="space-y-3">
                    <p className="text-[10px] text-muted-foreground">Up to 10 cards. Each card needs a title; image, subtitle and buttons are optional.</p>
                    {elements.map((el, i) => (
                        <div key={i} className="border border-border rounded-lg p-3 space-y-2 bg-secondary/20">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold">Card {i + 1}</span>
                                <button onClick={() => setEls(elements.filter((_, j) => j !== i))}
                                    className="text-muted-foreground hover:text-red-400">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                            <input type="text" value={el.title || ''} placeholder="Title (required)"
                                onChange={e => setEls(elements.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                                className={inputCls} />
                            <input type="text" value={el.subtitle || ''} placeholder="Subtitle"
                                onChange={e => setEls(elements.map((x, j) => j === i ? { ...x, subtitle: e.target.value } : x))}
                                className={inputCls} />
                            <input type="url" value={el.image_url || ''} placeholder="Image URL"
                                onChange={e => setEls(elements.map((x, j) => j === i ? { ...x, image_url: e.target.value } : x))}
                                className={inputCls} />
                            <div className="space-y-1.5">
                                {(el.buttons || []).map((b: any, bi: number) => (
                                    <div key={bi} className="flex gap-1.5">
                                        <input type="text" value={b.title || ''} placeholder="Button label"
                                            onChange={e => {
                                                const buttons = [...(el.buttons || [])];
                                                buttons[bi] = { ...buttons[bi], title: e.target.value };
                                                setEls(elements.map((x, j) => j === i ? { ...x, buttons } : x));
                                            }}
                                            className={inputCls + ' flex-1'} />
                                        <input type="url" value={b.url || ''} placeholder="URL"
                                            onChange={e => {
                                                const buttons = [...(el.buttons || [])];
                                                buttons[bi] = { ...buttons[bi], type: 'web_url', url: e.target.value };
                                                setEls(elements.map((x, j) => j === i ? { ...x, buttons } : x));
                                            }}
                                            className={inputCls + ' flex-1'} />
                                        <button onClick={() => {
                                            const buttons = (el.buttons || []).filter((_: any, j: number) => j !== bi);
                                            setEls(elements.map((x, j) => j === i ? { ...x, buttons } : x));
                                        }} className="text-muted-foreground hover:text-red-400 px-1.5">
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                ))}
                                {(el.buttons || []).length < 3 && (
                                    <button onClick={() => {
                                        const buttons = [...(el.buttons || []), { type: 'web_url', title: '', url: '' }];
                                        setEls(elements.map((x, j) => j === i ? { ...x, buttons } : x));
                                    }} className="text-[11px] text-primary hover:underline">+ Add button</button>
                                )}
                            </div>
                        </div>
                    ))}
                    {elements.length < 10 && (
                        <button onClick={() => setEls([...elements, { title: '', buttons: [] }])}
                            className="w-full px-3 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:bg-secondary/40">
                            + Add card
                        </button>
                    )}
                </div>
            )}

            {(kind === 'text' || kind === 'attachment') && (
                <div className="border-t border-border pt-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">Quick replies</span>
                        {quickReplies.length < 13 && (
                            <button onClick={() => setQr([...quickReplies, { title: '' }])} className="text-[11px] text-primary hover:underline">+ Add</button>
                        )}
                    </div>
                    {quickReplies.map((r, i) => (
                        <div key={i} className="flex gap-1.5">
                            <input type="text" value={r.title} placeholder="Button label (max 20 chars)"
                                onChange={e => setQr(quickReplies.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                                className={inputCls} />
                            <button onClick={() => setQr(quickReplies.filter((_, j) => j !== i))}
                                className="text-muted-foreground hover:text-red-400 px-1.5">
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <p className="text-[10px] text-muted-foreground leading-relaxed">
                Variables: <code>{'{{username}}'}</code>, <code>{'{{comment}}'}</code>, <code>{'{{post_url}}'}</code>.
            </p>
        </div>
    );
}

function NodeConfig({ node, agents, igAccounts, waInstances, userFields, onChange }: { node: Node; agents: any[]; igAccounts: any[]; waInstances: any[]; userFields: any[]; onChange: (p: Record<string, any>) => void }) {
    const d = node.data as Record<string, any>;
    const type = node.type as string;

    const ChannelField = (
        <Field label="Channel">
            <select value={d.channel || 'any'} onChange={e => onChange({ channel: e.target.value })} className={inputCls}>
                <option value="any">Any (WhatsApp + Instagram)</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="instagram">Instagram</option>
            </select>
        </Field>
    );

    const WaInstanceField = (
        <Field label="WhatsApp number">
            {waInstances.length === 0 ? (
                <p className="text-[10px] text-amber-400/90">No WhatsApp instances connected yet — fires on no message until you add one.</p>
            ) : (
                <select value={d.instanceId || 'any'} onChange={e => onChange({ instanceId: e.target.value })} className={inputCls}>
                    <option value="any">Any connected number</option>
                    {waInstances.map(i => (
                        <option key={i.id} value={i.id}>{i.name || i.phoneNumber || i.id.slice(0, 8)}</option>
                    ))}
                </select>
            )}
        </Field>
    );

    const IgAccountField = (
        <Field label="Instagram account">
            {igAccounts.length === 0 ? (
                <p className="text-[10px] text-amber-400/90">No Instagram accounts connected yet.</p>
            ) : (
                <select value={d.accountId || 'any'} onChange={e => onChange({ accountId: e.target.value })} className={inputCls}>
                    <option value="any">Any connected account</option>
                    {igAccounts.map(a => (
                        <option key={a.id} value={a.id}>@{a.igUsername}</option>
                    ))}
                </select>
            )}
        </Field>
    );

    const KeywordFields = (
        <>
            <Field label="Keywords (comma-separated)">
                <input type="text" value={d.keywords || ''} onChange={e => onChange({ keywords: e.target.value })}
                    placeholder="salam, qiymet, info" className={inputCls} />
            </Field>
            <Field label="Match mode">
                <select value={d.matchMode || 'contains'} onChange={e => onChange({ matchMode: e.target.value })} className={inputCls}>
                    <option value="contains">Message contains keyword</option>
                    <option value="exact">Message exactly equals keyword</option>
                    <option value="starts">Message starts with keyword</option>
                    <option value="regex">Regex match</option>
                </select>
            </Field>
            <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!d.caseSensitive} onChange={e => onChange({ caseSensitive: e.target.checked })}
                    className="w-4 h-4 accent-primary rounded" />
                <span className="text-xs text-muted-foreground">Case sensitive</span>
            </label>
        </>
    );

    switch (type) {
        // ─── New channel-specific triggers ───
        case 'trigger_wa_keyword':
            return <div className="space-y-3">{WaInstanceField}{KeywordFields}</div>;
        case 'trigger_ig_dm': {
            const mode = d.filterMode || 'any';
            return (
                <div className="space-y-3">
                    {IgAccountField}
                    <Field label="Filter">
                        <div className="flex gap-2">
                            {(['any', 'keyword'] as const).map(m => (
                                <button key={m} type="button" onClick={() => onChange({ filterMode: m })}
                                    className={`flex-1 text-xs px-3 py-2 rounded-md border transition-colors ${mode === m
                                        ? 'bg-primary/15 border-primary/40 text-foreground'
                                        : 'bg-secondary/40 border-border text-muted-foreground hover:text-foreground'}`}>
                                    {m === 'any' ? 'Every DM' : 'Match keyword'}
                                </button>
                            ))}
                        </div>
                    </Field>
                    {mode === 'keyword' && KeywordFields}
                </div>
            );
        }
        // Legacy IG DM triggers — kept so saved automations render, edit UI stays identical.
        case 'trigger_ig_keyword':
            return <div className="space-y-3">{IgAccountField}{KeywordFields}</div>;
        case 'trigger_wa_any':
        case 'trigger_wa_new_contact':
            return <div className="space-y-3">{WaInstanceField}</div>;
        case 'trigger_ig_any':
        case 'trigger_ig_new_contact':
            return <div className="space-y-3">{IgAccountField}</div>;
        case 'trigger_ig_post':
        case 'trigger_ig_comment':
            return (
                <div className="space-y-3">
                    <CommentTriggerConfig d={d} igAccounts={igAccounts} onChange={onChange} />
                    {KeywordFields}
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                        Fires on comment events for the selected post(s). Variables available in actions: <code>{'{{username}}'}</code>, <code>{'{{comment}}'}</code>, <code>{'{{post_url}}'}</code>.
                    </p>
                </div>
            );

        // ─── New channel-specific actions ───
        case 'action_wa_send_message':
            return (
                <div className="space-y-3">
                    <Field label="Message text">
                        <VariableTextEditor value={d.text || ''} onChange={(t) => onChange({ text: t })} rows={4}
                            variables={["name", "username", "message", "comment"]} />
                    </Field>
                    <Field label="Attachment (optional)">
                        <MediaPicker media={d.media} onChange={(m) => onChange({ media: m })} />
                    </Field>
                    <p className="text-[10px] text-muted-foreground">When both text and image/video/document are set, the text is used as caption.</p>
                </div>
            );
        case 'action_ig_send_dm':
            return (
                <div className="space-y-3">
                    <Field label="DM text">
                        <VariableTextEditor value={d.text || ''} onChange={(t) => onChange({ text: t })} rows={4}
                            variables={["username", "name", "comment", "message", "post_url"]} />
                    </Field>
                    <Field label="Attachment (optional)">
                        <MediaPicker media={d.media}
                            allowedKinds={["image", "video", "audio"]}
                            onChange={(m) => onChange({ media: m })} />
                    </Field>
                    <div className="border-t border-border pt-3 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">Quick replies (max 13)</span>
                            {(d.quickReplies || []).length < 13 && (
                                <button onClick={() => onChange({ quickReplies: [...(d.quickReplies || []), { title: '' }] })}
                                    className="text-[11px] text-primary hover:underline">+ Add</button>
                            )}
                        </div>
                        {(d.quickReplies || []).map((r: any, i: number) => (
                            <div key={i} className="flex gap-1.5">
                                <input type="text" value={r.title} placeholder="Button label (max 20 chars)"
                                    onChange={e => {
                                        const next = [...(d.quickReplies || [])];
                                        next[i] = { ...next[i], title: e.target.value };
                                        onChange({ quickReplies: next });
                                    }}
                                    className={inputCls} />
                                <button onClick={() => onChange({ quickReplies: (d.quickReplies || []).filter((_: any, j: number) => j !== i) })}
                                    className="text-muted-foreground hover:text-red-400 px-1.5">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                        Documents fall back to a text link on Instagram.
                    </p>
                </div>
            );
        case 'action_ig_reply_comment':
            return (
                <div className="space-y-3">
                    <Field label="Reply text">
                        <VariableTextEditor value={d.text || ''} onChange={(t) => onChange({ text: t })} rows={4}
                            variables={["username", "name", "comment", "message", "post_url"]} />
                    </Field>
                    <p className="text-[10px] text-amber-400/80 leading-relaxed">
                        Posts a public reply on the comment. Requires the <code>instagram_business_manage_comments</code> permission — pending re-approval from Meta.
                    </p>
                </div>
            );

        // ─── Legacy (kept for backward compat with old saved automations) ───
        case 'trigger_keyword':
            return <div className="space-y-3">{ChannelField}{KeywordFields}</div>;
        case 'trigger_comment':
            return (
                <div className="space-y-3">
                    <CommentTriggerConfig d={d} igAccounts={igAccounts} onChange={onChange} />
                    {KeywordFields}
                </div>
            );
        case 'trigger_any_message':
        case 'trigger_new_contact':
            return <div className="space-y-3">{ChannelField}</div>;
        case 'action_send_message':
            return (
                <div className="space-y-3">
                    <Field label="Message text">
                        <VariableTextEditor value={d.text || ''} onChange={(t) => onChange({ text: t })} rows={5}
                            variables={["name", "username", "message", "comment"]} />
                    </Field>
                </div>
            );
        case 'action_send_media':
            return (
                <div className="space-y-3">
                    <Field label="Media type">
                        <select value={d.mediaKind || 'image'} onChange={e => onChange({ mediaKind: e.target.value })} className={inputCls}>
                            <option value="image">Image (JPG / PNG)</option>
                            <option value="video">Video (MP4)</option>
                            <option value="audio">Audio (MP3 / OGG)</option>
                            <option value="document">Document (PDF / DOCX) — WhatsApp only</option>
                        </select>
                    </Field>
                    <Field label="Public URL">
                        <input type="url" value={d.url || ''} onChange={e => onChange({ url: e.target.value })}
                            placeholder="https://yourdomain.com/file.jpg" className={inputCls} />
                    </Field>
                    {(d.mediaKind === 'image' || d.mediaKind === 'video' || d.mediaKind === 'document') && (
                        <Field label="Caption (optional)">
                            <VariableTextEditor value={d.caption || ''} onChange={(t) => onChange({ caption: t })} rows={3}
                                variables={["name", "username", "message", "comment"]} />
                        </Field>
                    )}
                    {d.mediaKind === 'document' && (
                        <Field label="File name (optional)">
                            <input type="text" value={d.filename || ''} onChange={e => onChange({ filename: e.target.value })}
                                placeholder="invoice.pdf" className={inputCls} />
                        </Field>
                    )}
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                        The URL must be publicly reachable. Works for both WhatsApp and Instagram (Instagram doesn&apos;t accept documents — falls back to a text link).
                    </p>
                </div>
            );
        case 'action_send_dm':
            return <SendDmConfig d={d} onChange={onChange} />;
        case 'action_reply_comment':
            return (
                <div className="space-y-3">
                    <Field label="Reply text">
                        <VariableTextEditor value={d.text || ''} onChange={(t) => onChange({ text: t })} rows={4}
                            variables={["username", "name", "comment", "message", "post_url"]} />
                    </Field>
                    <p className="text-[10px] text-amber-400/80 leading-relaxed">
                        Posts a public reply on the comment. Requires the <code>instagram_business_manage_comments</code> permission — pending re-approval from Meta.
                    </p>
                </div>
            );
        case 'action_ai_reply':
            return (
                <div className="space-y-3">
                    <Field label="AI Agent">
                        <select value={d.agentId || ''}
                            onChange={e => {
                                const ag = agents.find(a => a.id === e.target.value);
                                onChange({ agentId: e.target.value, agentName: ag?.name || '' });
                            }}
                            className={inputCls}>
                            <option value="">Select agent</option>
                            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                    </Field>
                </div>
            );
        case 'action_add_tag':
            return (
                <div className="space-y-3">
                    <Field label="Tag">
                        <input type="text" value={d.tag || ''} onChange={e => onChange({ tag: e.target.value })}
                            placeholder="VIP" className={inputCls} />
                    </Field>
                </div>
            );
        case 'action_set_user_field':
            return (
                <div className="space-y-3">
                    <Field label="Field">
                        {userFields.length === 0 ? (
                            <p className="text-[10px] text-amber-400/90">No custom fields defined yet. Open <code>/dashboard/contacts</code> → <code>Manage Fields</code> to create some.</p>
                        ) : (
                            <select value={d.fieldKey || ''}
                                onChange={e => onChange({ fieldKey: e.target.value })}
                                className={inputCls}>
                                <option value="">Pick a field…</option>
                                {userFields.map((f: any) => (
                                    <option key={f.id} value={f.key}>{f.label} ({f.type})</option>
                                ))}
                            </select>
                        )}
                    </Field>
                    <Field label="Value">
                        <VariableTextEditor value={d.value || ''} onChange={(v) => onChange({ value: v })} rows={2}
                            variables={["name", "username", "message", "comment", "post_url"]} />
                    </Field>
                </div>
            );
        case 'action_wait':
            return (
                <div className="space-y-3">
                    <Field label="Wait (seconds)">
                        <input type="number" value={d.seconds || 0} onChange={e => onChange({ seconds: Number(e.target.value) })}
                            className={inputCls} />
                    </Field>
                </div>
            );
        case 'condition':
            return (
                <div className="space-y-3">
                    <Field label="Check field">
                        <select value={d.field || 'message'} onChange={e => onChange({ field: e.target.value })} className={inputCls}>
                            <option value="message">Message text</option>
                            <option value="tag">Contact has tag</option>
                            <option value="status">CRM status</option>
                        </select>
                    </Field>
                    <Field label="Operator">
                        <select value={d.operator || 'contains'} onChange={e => onChange({ operator: e.target.value })} className={inputCls}>
                            <option value="contains">contains</option>
                            <option value="equals">equals</option>
                            <option value="not_equals">does not equal</option>
                        </select>
                    </Field>
                    <Field label="Value">
                        <input type="text" value={d.value || ''} onChange={e => onChange({ value: e.target.value })} className={inputCls} />
                    </Field>
                    <p className="text-[10px] text-muted-foreground">Green handle = condition true, red handle = false.</p>
                </div>
            );
        default:
            return <p className="text-xs text-muted-foreground">No settings.</p>;
    }
}

export default function AutomationEditorPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    return (
        <ReactFlowProvider>
            <Editor id={id} />
        </ReactFlowProvider>
    );
}

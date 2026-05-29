"use client";

import { useEffect, useState, useCallback, use, useRef } from "react";
import {
    ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
    useNodesState, useEdgesState, addEdge, Handle, Position,
    type Node, type Edge, type Connection, type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Loader2, Save, Power, Trash2, Plus, Zap, MessageSquare, Bot, Tag, Clock, GitBranch, Camera, UserPlus, Send, Image as ImageIcon, Reply, X } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";

// ─── Node metadata ───
type NodeMeta = {
    label: string;
    category: "trigger" | "action" | "logic";
    icon: any;
    defaultData: Record<string, any>;
};

const NODE_META: Record<string, NodeMeta> = {
    trigger_keyword: {
        label: "Keyword Trigger", category: "trigger", icon: Zap,
        defaultData: { channel: "any", keywords: "", caseSensitive: false, matchMode: "contains" }
    },
    trigger_any_message: {
        label: "Any Message", category: "trigger", icon: MessageSquare,
        defaultData: { channel: "any" }
    },
    trigger_comment: {
        label: "Instagram Comment", category: "trigger", icon: Camera,
        defaultData: { accountId: "", mediaId: "any", keywords: "", caseSensitive: false, matchMode: "contains" }
    },
    trigger_new_contact: {
        label: "New Contact", category: "trigger", icon: UserPlus,
        defaultData: { channel: "any" }
    },
    action_send_message: {
        label: "Send Message", category: "action", icon: MessageSquare,
        defaultData: { text: "" }
    },
    action_send_dm: {
        label: "Send Instagram DM", category: "action", icon: Send,
        defaultData: { kind: "text", text: "", attachmentType: "image", url: "", elements: [], quickReplies: [] }
    },
    action_reply_comment: {
        label: "Reply to Comment", category: "action", icon: Reply,
        defaultData: { text: "" }
    },
    action_ai_reply: {
        label: "AI Agent Reply", category: "action", icon: Bot,
        defaultData: { agentId: "" }
    },
    action_add_tag: {
        label: "Add Tag", category: "action", icon: Tag,
        defaultData: { tag: "" }
    },
    action_wait: {
        label: "Wait / Delay", category: "action", icon: Clock,
        defaultData: { seconds: 60 }
    },
    condition: {
        label: "Condition", category: "logic", icon: GitBranch,
        defaultData: { field: "message", operator: "contains", value: "" }
    },
};

const CATEGORY_COLOR: Record<string, { bg: string; border: string; text: string; dot: string }> = {
    trigger: { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-400", dot: "bg-emerald-500" },
    action: { bg: "bg-blue-500/10", border: "border-blue-500/40", text: "text-blue-400", dot: "bg-blue-500" },
    logic: { bg: "bg-amber-500/10", border: "border-amber-500/40", text: "text-amber-400", dot: "bg-amber-500" },
};

const PALETTE = [
    { category: "trigger", label: "Triggers", types: ["trigger_keyword", "trigger_any_message", "trigger_comment", "trigger_new_contact"] },
    { category: "action", label: "Actions", types: ["action_send_message", "action_send_dm", "action_reply_comment", "action_ai_reply", "action_add_tag", "action_wait"] },
    { category: "logic", label: "Logic", types: ["condition"] },
];

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
    if (type === "trigger_keyword") summary = d.keywords || "(no keywords)";
    else if (type === "trigger_comment") {
        const post = d.mediaId && d.mediaId !== 'any' ? '1 post' : 'any post';
        const kw = d.keywords ? ` · "${d.keywords}"` : '';
        summary = `${post}${kw}`;
    }
    else if (type === "trigger_any_message" || type === "trigger_new_contact") summary = `channel: ${d.channel}`;
    else if (type === "action_send_message") summary = d.text || "(empty)";
    else if (type === "action_send_dm") {
        const kind = d.kind || 'text';
        if (kind === 'text') summary = d.text ? `DM: ${d.text}` : "(empty)";
        else if (kind === 'attachment') summary = `DM ${d.attachmentType || 'image'}: ${d.url || '(no url)'}`;
        else summary = `DM template (${(d.elements || []).length} card${(d.elements || []).length === 1 ? '' : 's'})`;
    }
    else if (type === "action_reply_comment") summary = d.text || "(empty)";
    else if (type === "action_ai_reply") summary = d.agentName || (d.agentId ? "agent set" : "(no agent)");
    else if (type === "action_add_tag") summary = d.tag || "(no tag)";
    else if (type === "action_wait") summary = `${d.seconds || 0}s`;
    else if (type === "condition") summary = `${d.field} ${d.operator} ${d.value || "?"}`;

    return (
        <div className={`rounded-xl border-2 bg-card min-w-[180px] max-w-[240px] ${selected ? c.border : "border-border"} shadow-md`}>
            {!isTrigger && <Handle type="target" position={Position.Left} className="!w-3 !h-3 !bg-muted-foreground" />}
            <div className={`flex items-center gap-2 px-3 py-2 rounded-t-[10px] ${c.bg}`}>
                <Icon className={`w-4 h-4 ${c.text}`} />
                <span className="text-sm font-semibold truncate">{meta.label}</span>
            </div>
            <div className="px-3 py-2 text-xs text-muted-foreground break-words">{summary}</div>
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
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const [aRes, agRes, igRes] = await Promise.all([
                    api.get(`/automations/${id}`),
                    api.get('/agents'),
                    api.get('/instagram/accounts').catch(() => ({ data: { success: false } }))
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
                <div className="flex-1" />
                <button onClick={handleSave} disabled={saving}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg px-4 py-1.5 flex items-center gap-2 text-sm transition-all disabled:opacity-70">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save
                </button>
            </div>

            <div className="flex flex-1 min-h-0">
                {/* Node palette */}
                <div className="w-52 flex-shrink-0 border-r border-border bg-card overflow-y-auto p-3 space-y-4">
                    {PALETTE.map(group => (
                        <div key={group.category}>
                            <div className="flex items-center gap-2 mb-2">
                                <div className={`w-2 h-2 rounded-full ${CATEGORY_COLOR[group.category].dot}`} />
                                <span className="text-xs font-semibold uppercase text-muted-foreground">{group.label}</span>
                            </div>
                            <div className="space-y-1.5">
                                {group.types.map(t => {
                                    const meta = NODE_META[t];
                                    const Icon = meta.icon;
                                    return (
                                        <button key={t} onClick={() => addNode(t)}
                                            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/60 text-left text-sm transition-colors">
                                            <Icon className={`w-4 h-4 ${CATEGORY_COLOR[group.category].text}`} />
                                            <span className="truncate">{meta.label}</span>
                                            <Plus className="w-3.5 h-3.5 ml-auto text-muted-foreground" />
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

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

                {/* Config panel */}
                {selectedNode && (
                    <div className="w-72 flex-shrink-0 border-l border-border bg-card overflow-y-auto p-4 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-sm">{NODE_META[selectedNode.type as string]?.label}</h3>
                            <button onClick={() => deleteNode(selectedNode.id)}
                                className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                        <NodeConfig node={selectedNode} agents={agents} igAccounts={igAccounts} onChange={(patch) => updateNodeData(selectedNode.id, patch)} />
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

// ─── Instagram comment trigger: account + post picker ───
function CommentTriggerConfig({ d, igAccounts, onChange }: { d: Record<string, any>; igAccounts: any[]; onChange: (p: Record<string, any>) => void }) {
    const [media, setMedia] = useState<any[]>([]);
    const [loadingMedia, setLoadingMedia] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const accountId = d.accountId || (igAccounts[0]?.id || '');
    const selectedPost = media.find(m => m.id === d.mediaId);

    useEffect(() => {
        if (!d.accountId && igAccounts[0]?.id) onChange({ accountId: igAccounts[0].id });
    }, [igAccounts.length]);

    useEffect(() => {
        if (!accountId || !pickerOpen) return;
        setLoadingMedia(true);
        api.get(`/instagram/accounts/${accountId}/media`).then(r => {
            if (r.data?.success) setMedia(r.data.media || []);
        }).catch(() => {}).finally(() => setLoadingMedia(false));
    }, [accountId, pickerOpen]);

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
                            ) : media.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-8">No posts found.</p>
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
                    <textarea value={d.text || ''} onChange={e => onChange({ text: e.target.value })} rows={5}
                        placeholder="Hi {{username}}, thanks for your comment!" className={inputCls + ' resize-none'} />
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

function NodeConfig({ node, agents, igAccounts, onChange }: { node: Node; agents: any[]; igAccounts: any[]; onChange: (p: Record<string, any>) => void }) {
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
        case 'trigger_keyword':
            return <div className="space-y-3">{ChannelField}{KeywordFields}</div>;
        case 'trigger_comment':
            return (
                <div className="space-y-3">
                    <CommentTriggerConfig d={d} igAccounts={igAccounts} onChange={onChange} />
                    {KeywordFields}
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                        Variables available in actions: <code>{'{{username}}'}</code>, <code>{'{{comment}}'}</code>, <code>{'{{post_url}}'}</code>.
                    </p>
                </div>
            );
        case 'trigger_any_message':
        case 'trigger_new_contact':
            return <div className="space-y-3">{ChannelField}</div>;
        case 'action_send_message':
            return (
                <div className="space-y-3">
                    <Field label="Message text">
                        <textarea value={d.text || ''} onChange={e => onChange({ text: e.target.value })} rows={5}
                            placeholder="Use {{name}} for the contact's name" className={inputCls + ' resize-none'} />
                    </Field>
                </div>
            );
        case 'action_send_dm':
            return <SendDmConfig d={d} onChange={onChange} />;
        case 'action_reply_comment':
            return (
                <div className="space-y-3">
                    <Field label="Reply text">
                        <textarea value={d.text || ''} onChange={e => onChange({ text: e.target.value })} rows={4}
                            placeholder="Thanks for commenting, {{username}}!" className={inputCls + ' resize-none'} />
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

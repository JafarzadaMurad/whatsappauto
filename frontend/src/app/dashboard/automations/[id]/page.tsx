"use client";

import { useEffect, useState, useCallback, use, useRef } from "react";
import {
    ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
    useNodesState, useEdgesState, addEdge, Handle, Position,
    type Node, type Edge, type Connection, type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Loader2, Save, Power, Trash2, Plus, Zap, MessageSquare, Bot, Tag, Clock, GitBranch, Camera, UserPlus } from "lucide-react";
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
        defaultData: { keywords: "", caseSensitive: false, matchMode: "contains" }
    },
    trigger_new_contact: {
        label: "New Contact", category: "trigger", icon: UserPlus,
        defaultData: { channel: "any" }
    },
    action_send_message: {
        label: "Send Message", category: "action", icon: MessageSquare,
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
    { category: "action", label: "Actions", types: ["action_send_message", "action_ai_reply", "action_add_tag", "action_wait"] },
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
    if (type === "trigger_keyword" || type === "trigger_comment") summary = d.keywords || "(no keywords)";
    else if (type === "trigger_any_message" || type === "trigger_new_contact") summary = `channel: ${d.channel}`;
    else if (type === "action_send_message") summary = d.text || "(empty)";
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
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const [aRes, agRes] = await Promise.all([
                    api.get(`/automations/${id}`),
                    api.get('/agents')
                ]);
                if (aRes.data.success) {
                    const a = aRes.data.automation;
                    setName(a.name);
                    setIsActive(a.isActive);
                    setNodes((a.nodes || []) as Node[]);
                    setEdges((a.edges || []) as Edge[]);
                }
                if (agRes.data.success) setAgents(agRes.data.agents);
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
                        <NodeConfig node={selectedNode} agents={agents} onChange={(patch) => updateNodeData(selectedNode.id, patch)} />
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

function NodeConfig({ node, agents, onChange }: { node: Node; agents: any[]; onChange: (p: Record<string, any>) => void }) {
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
            return <div className="space-y-3">{KeywordFields}</div>;
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

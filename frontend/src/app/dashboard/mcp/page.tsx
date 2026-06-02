"use client";

import { useEffect, useState, useCallback } from "react";
import { Plug, Key, Shield, ListChecks, Copy, Loader2, Trash2, Check, AlertTriangle, RefreshCw } from "lucide-react";
import api from "@/lib/api";

const CATEGORIES = [
    { id: 'meta', label: 'Meta / Discovery' },
    { id: 'automation', label: 'Automations' },
    { id: 'agent', label: 'AI Agents' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'instagram', label: 'Instagram' },
    { id: 'inbox', label: 'Inbox' },
    { id: 'client', label: 'Contacts (CRM)' },
    { id: 'campaign', label: 'Campaigns' },
    { id: 'table', label: 'Data Tables' },
    { id: 'webhook', label: 'Webhooks' },
    { id: 'apikey', label: 'API Keys' },
    { id: 'aiprovider', label: 'AI Providers' },
];
const VERBS = ['read', 'create', 'update', 'delete'] as const;

type Tab = 'setup' | 'clients' | 'permissions' | 'activity';

export default function McpSettingsPage() {
    const [tab, setTab] = useState<Tab>('setup');

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Plug className="w-5 h-5" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">MCP</h1>
                    <p className="text-sm text-muted-foreground">Connect external AI clients (Claude Desktop, etc.) to your alChatBot account.</p>
                </div>
            </div>

            <div className="inline-flex bg-secondary/40 border border-border rounded-xl p-1">
                {([
                    { id: 'setup', label: 'Setup', icon: Plug },
                    { id: 'clients', label: 'Connected clients', icon: Key },
                    { id: 'permissions', label: 'Permissions', icon: Shield },
                    { id: 'activity', label: 'Activity', icon: ListChecks },
                ] as const).map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)}
                        className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                        <t.icon className="w-4 h-4" />
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'setup' && <SetupTab />}
            {tab === 'clients' && <ClientsTab />}
            {tab === 'permissions' && <PermissionsTab />}
            {tab === 'activity' && <ActivityTab />}
        </div>
    );
}

// ──────────────────────────────────────────────────────────
function SetupTab() {
    const [creating, setCreating] = useState(false);
    const [newKey, setNewKey] = useState<string | null>(null);
    const [name, setName] = useState('Claude Desktop');
    const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : 'https://chatbot.tur.al/api/mcp';

    const generate = async () => {
        setCreating(true);
        try {
            const r = await api.post('/keys', { name: name || 'MCP Client' });
            if (r.data?.success && r.data.apiKey?.key) setNewKey(r.data.apiKey.key);
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        } finally { setCreating(false); }
    };

    const token = newKey || 'sk_live_…';
    // Default: mcp-remote bridge (works with current Claude Desktop, which only
    // natively supports stdio MCP servers).
    const configJson = JSON.stringify({
        mcpServers: {
            alchatbot: {
                command: 'npx',
                args: [
                    '-y', 'mcp-remote',
                    baseUrl,
                    '--header', `Authorization:Bearer ${token}`,
                ],
            },
        },
    }, null, 2);
    // Future-proof: when Claude Desktop adds native HTTP support, this is
    // the entry to use instead.
    const configJsonHttp = JSON.stringify({
        mcpServers: {
            alchatbot: { type: 'http', url: baseUrl, headers: { Authorization: `Bearer ${token}` } },
        },
    }, null, 2);

    return (
        <div className="space-y-6">
            <Card title="Endpoint URL" description="This is the address Claude Desktop (and other MCP clients) should connect to.">
                <CopyField value={baseUrl} />
            </Card>

            <Card title="API key" description="Generate a key dedicated to this MCP client. The full secret is shown only once.">
                {newKey ? (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-300 text-xs">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                            Save this key now — it will not be shown again.
                        </div>
                        <CopyField value={newKey} mono />
                        <button onClick={() => setNewKey(null)} className="text-xs text-muted-foreground hover:text-foreground underline">
                            Done — hide
                        </button>
                    </div>
                ) : (
                    <div className="flex gap-2">
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="Key name"
                            className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                        <button onClick={generate} disabled={creating}
                            className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-60">
                            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                            Generate
                        </button>
                    </div>
                )}
            </Card>

            <Card title="Claude Desktop config" description="Claude Desktop currently only supports stdio MCP servers, so we bridge through the official mcp-remote npm package. Paste this into your config and restart Claude Desktop.">
                <CopyField value={configJson} mono multiline />
                <p className="text-[10px] text-muted-foreground mt-2">
                    macOS: <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>
                    <br />
                    Windows: <code>%APPDATA%\Claude\claude_desktop_config.json</code>
                </p>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                    Requirements: Node.js installed and on PATH. The first launch downloads <code>mcp-remote</code> via <code>npx</code> (10–20 seconds).
                </p>
                <details className="mt-3 text-[11px] text-muted-foreground">
                    <summary className="cursor-pointer hover:text-foreground">Native HTTP variant (for clients that already support remote MCP)</summary>
                    <div className="mt-2 space-y-1.5">
                        <p>If your MCP client speaks the Streamable HTTP transport natively (e.g. some IDE plugins), use this instead:</p>
                        <CopyField mono multiline value={configJsonHttp} />
                    </div>
                </details>
            </Card>

            <Card title="OAuth (alternative)" description="Claude Desktop also supports OAuth. Pick &quot;Connect via URL&quot; and use the endpoint above; the browser will open a consent screen.">
                <p className="text-xs text-muted-foreground">
                    The MCP server advertises OAuth metadata at <code>{baseUrl}/.well-known/oauth-authorization-server</code>. Dynamic Client Registration is enabled, so no manual setup is required.
                </p>
            </Card>
        </div>
    );
}

// ──────────────────────────────────────────────────────────
function ClientsTab() {
    const [data, setData] = useState<{ clients: any[]; tokens: any[] }>({ clients: [], tokens: [] });
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api.get('/mcp/clients');
            if (r.data?.success) setData({ clients: r.data.clients || [], tokens: r.data.tokens || [] });
        } catch { /* ignore */ }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const revokeClient = async (id: string) => {
        if (!confirm('Revoke this OAuth client? Any tokens issued to it will stop working.')) return;
        await api.delete(`/mcp/clients/${id}`);
        load();
    };
    const revokeToken = async (id: string) => {
        if (!confirm('Revoke this access token?')) return;
        await api.delete(`/mcp/tokens/${id}`);
        load();
    };

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

    return (
        <div className="space-y-6">
            <Card title="OAuth clients" description="Apps that connected via OAuth (e.g., Claude Desktop with dynamic registration).">
                {data.clients.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No OAuth clients yet. They appear here after the first &quot;Allow&quot; on the consent screen.</p>
                ) : (
                    <div className="space-y-2">
                        {data.clients.map(c => (
                            <div key={c.id} className="flex items-center justify-between p-3 border border-border rounded-lg bg-secondary/30">
                                <div>
                                    <p className="text-sm font-medium">{c.name}</p>
                                    <p className="text-[10px] text-muted-foreground font-mono">{c.clientId} · added {new Date(c.createdAt).toLocaleDateString()}</p>
                                </div>
                                <button onClick={() => revokeClient(c.id)} className="text-muted-foreground hover:text-red-400">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            <Card title="Active OAuth tokens" description="Live access tokens. Revoke to force the client to re-authenticate.">
                {data.tokens.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No active tokens.</p>
                ) : (
                    <div className="space-y-2">
                        {data.tokens.map(t => (
                            <div key={t.id} className="flex items-center justify-between p-3 border border-border rounded-lg bg-secondary/30">
                                <div>
                                    <p className="text-xs font-mono">{t.clientId}</p>
                                    <p className="text-[10px] text-muted-foreground">
                                        issued {new Date(t.createdAt).toLocaleString()} · expires {new Date(t.expiresAt).toLocaleString()}
                                    </p>
                                </div>
                                <button onClick={() => revokeToken(t.id)} className="text-muted-foreground hover:text-red-400">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </Card>
        </div>
    );
}

// ──────────────────────────────────────────────────────────
function PermissionsTab() {
    const [flags, setFlags] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savedAt, setSavedAt] = useState<number | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const r = await api.get('/mcp/permissions');
                if (r.data?.success) setFlags(r.data.toolFlags || {});
            } catch { /* ignore */ }
            finally { setLoading(false); }
        })();
    }, []);

    const isAllowed = (key: string) => flags[key] !== false;

    const toggle = (key: string) => {
        setFlags(f => ({ ...f, [key]: f[key] === false ? true : false }));
    };

    const save = async () => {
        setSaving(true);
        try {
            await api.put('/mcp/permissions', { toolFlags: flags });
            setSavedAt(Date.now());
        } catch (e: any) {
            alert(e.response?.data?.message || e.message);
        } finally { setSaving(false); }
    };

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

    return (
        <div className="space-y-4">
            <Card title="Tool permissions" description="Per category, decide which verbs your AI is allowed to invoke. Default for every checkbox is ON — uncheck to deny.">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-muted-foreground text-xs uppercase tracking-wide">
                                <th className="text-left py-2 pr-3">Category</th>
                                {VERBS.map(v => <th key={v} className="py-2 px-3 capitalize">{v}</th>)}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {CATEGORIES.map(c => (
                                <tr key={c.id}>
                                    <td className="py-2 pr-3 font-medium">{c.label}</td>
                                    {VERBS.map(v => {
                                        const key = `${c.id}.${v}`;
                                        const allowed = isAllowed(key);
                                        return (
                                            <td key={v} className="text-center py-2 px-3">
                                                <input type="checkbox" checked={allowed} onChange={() => toggle(key)}
                                                    className="w-4 h-4 accent-primary cursor-pointer" />
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="flex items-center gap-3 mt-4">
                    <button onClick={save} disabled={saving}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg px-4 py-1.5 text-sm flex items-center gap-2 disabled:opacity-60">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Save
                    </button>
                    {savedAt && <span className="text-xs text-emerald-400">Saved</span>}
                </div>
            </Card>
        </div>
    );
}

// ──────────────────────────────────────────────────────────
function ActivityTab() {
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<'all' | 'ok' | 'error'>('all');
    const [openId, setOpenId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api.get('/mcp/audit', { params: { status: status === 'all' ? undefined : status } });
            if (r.data?.success) setLogs(r.data.logs || []);
        } catch { /* ignore */ }
        finally { setLoading(false); }
    }, [status]);

    useEffect(() => { load(); }, [load]);

    return (
        <div className="space-y-4">
            <Card
                title="Audit log"
                description="Every MCP tool call your AI made is recorded here. Use this to debug or audit what was done on your behalf."
                rightSlot={
                    <div className="flex items-center gap-2">
                        <select value={status} onChange={e => setStatus(e.target.value as any)}
                            className="bg-secondary/50 border border-border rounded-lg px-2 py-1 text-xs">
                            <option value="all">All</option>
                            <option value="ok">Succeeded</option>
                            <option value="error">Failed</option>
                        </select>
                        <button onClick={load} className="text-muted-foreground hover:text-foreground">
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    </div>
                }
            >
                {loading ? (
                    <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                ) : logs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No tool calls recorded yet.</p>
                ) : (
                    <div className="space-y-1">
                        {logs.map(l => {
                            const isOpen = openId === l.id;
                            return (
                                <div key={l.id} className="rounded-lg border border-border bg-secondary/20">
                                    <button onClick={() => setOpenId(isOpen ? null : l.id)}
                                        className="w-full flex items-center gap-3 px-3 py-2 text-left">
                                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${l.resultOk ? 'bg-emerald-500' : 'bg-red-500'}`} />
                                        <span className="text-xs text-muted-foreground w-36 flex-shrink-0">{new Date(l.createdAt).toLocaleString()}</span>
                                        <span className="text-xs font-mono flex-1 truncate">{l.tool}</span>
                                        <span className="text-[10px] text-muted-foreground">{l.authKind}</span>
                                        <span className="text-[10px] text-muted-foreground">{l.durationMs}ms</span>
                                    </button>
                                    {isOpen && (
                                        <div className="border-t border-border px-3 py-2 space-y-1.5">
                                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Args</p>
                                            <pre className="text-[10px] font-mono bg-secondary/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(l.argsJson, null, 2)}</pre>
                                            {l.errorMsg && (
                                                <>
                                                    <p className="text-[10px] uppercase tracking-wide text-red-400">Error</p>
                                                    <pre className="text-[10px] font-mono bg-red-500/5 text-red-300 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">{l.errorMsg}</pre>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </Card>
        </div>
    );
}

// ──────────────────────────────────────────────────────────
function Card({ title, description, rightSlot, children }: { title: string; description?: string; rightSlot?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-start justify-between mb-3">
                <div>
                    <h3 className="font-semibold">{title}</h3>
                    {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
                </div>
                {rightSlot}
            </div>
            {children}
        </div>
    );
}

function CopyField({ value, mono, multiline }: { value: string; mono?: boolean; multiline?: boolean }) {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    return (
        <div className="relative">
            {multiline ? (
                <pre className={`bg-secondary/50 border border-border rounded-lg p-3 text-xs overflow-x-auto ${mono ? 'font-mono' : ''}`}>{value}</pre>
            ) : (
                <div className={`bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm break-all ${mono ? 'font-mono' : ''}`}>{value}</div>
            )}
            <button onClick={copy}
                className="absolute top-2 right-2 px-2 py-1 rounded bg-card border border-border hover:bg-secondary/70 text-[10px] flex items-center gap-1">
                {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
            </button>
        </div>
    );
}

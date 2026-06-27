"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Megaphone, Loader2, Plus, Trash2, ExternalLink, ChevronRight, X as XIcon, RefreshCw, AlertCircle, CheckCircle2, Bot } from "lucide-react";
import api from "@/lib/api";
import { motion } from "framer-motion";

type ConnectedAccount = {
    id: string;
    fbUserId: string | null;
    fbUserName: string | null;
    adAccountId: string;
    accountName: string;
    currency: string | null;
    status: 'active' | 'inactive' | 'error';
    lastError: string | null;
    lastSyncedAt: string | null;
    tokenExpiresAt: string | null;
    createdAt: string;
};

type Ad = {
    id: string;
    name: string;
    status: string;
    effectiveStatus: string | null;
    createdTime: string | null;
    campaign?: { id: string; name: string };
    adset?: { id: string; name: string };
    thumbnailUrl: string | null;
    route: null | {
        id: string;
        agentId: string;
        agent: { name: string };
        isActive: boolean;
    };
};

type AdInsights = {
    impressions?: string;
    clicks?: string;
    spend?: string;
    ctr?: string;
    cpm?: string;
    cpc?: string;
    reach?: string;
    actions?: Array<{ action_type: string; value: string }>;
};

type AgentLite = { id: string; name: string };

type PickerPayload = {
    accessToken: string;
    tokenExpiresAt: string | null;
    fbUserId: string;
    fbUserName: string;
    accounts: Array<{ adAccountId: string; accountIdRaw: string; accountName: string; currency?: string; status?: number }>;
};

export default function MetaAdsPage() {
    const router = useRouter();
    const params = useSearchParams();

    const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
    const [loadingAccounts, setLoadingAccounts] = useState(true);
    const [agents, setAgents] = useState<AgentLite[]>([]);
    const [picker, setPicker] = useState<PickerPayload | null>(null);
    const [connecting, setConnecting] = useState(false);

    const loadAccounts = useCallback(async () => {
        setLoadingAccounts(true);
        try {
            const r = await api.get('/meta/accounts');
            if (r.data?.success) setAccounts(r.data.accounts);
        } catch (e) { console.error(e); }
        finally { setLoadingAccounts(false); }
    }, []);

    const loadAgents = useCallback(async () => {
        try {
            const r = await api.get('/agents');
            if (r.data?.success) setAgents((r.data.agents || []).map((a: any) => ({ id: a.id, name: a.name })));
        } catch (e) { console.error(e); }
    }, []);

    useEffect(() => {
        loadAccounts();
        loadAgents();
        // The OAuth callback page parks the freshly-exchanged payload
        // in sessionStorage; if ?picker=1 is set, surface the picker.
        if (params?.get('picker') === '1') {
            try {
                const raw = sessionStorage.getItem('meta:connect:payload');
                if (raw) setPicker(JSON.parse(raw));
            } catch { /* ignore */ }
        }
    }, [loadAccounts, loadAgents, params]);

    const onConnect = async () => {
        setConnecting(true);
        try {
            const r = await api.get('/meta/auth-url');
            if (r.data?.success && r.data.url) {
                window.location.href = r.data.url;
            } else {
                alert(r.data?.message || 'Could not start Facebook login');
                setConnecting(false);
            }
        } catch (e: any) {
            alert(e?.response?.data?.message || e.message);
            setConnecting(false);
        }
    };

    const onPickerSave = async (chosen: PickerPayload['accounts']) => {
        if (!picker || chosen.length === 0) return;
        try {
            await api.post('/meta/accounts', {
                accessToken: picker.accessToken,
                tokenExpiresAt: picker.tokenExpiresAt || undefined,
                fbUserId: picker.fbUserId,
                fbUserName: picker.fbUserName,
                accounts: chosen.map(a => ({
                    adAccountId: a.adAccountId,
                    accountName: a.accountName,
                    currency: a.currency,
                })),
            });
            sessionStorage.removeItem('meta:connect:payload');
            setPicker(null);
            router.replace('/dashboard/meta');
            await loadAccounts();
        } catch (e: any) {
            alert(e?.response?.data?.message || e.message);
        }
    };

    const onDeleteAccount = async (id: string) => {
        if (!confirm('Disconnecting this account will not delete the agent rules bound to its ads — only the account itself is removed.')) return;
        try {
            await api.delete(`/meta/accounts/${id}`);
            await loadAccounts();
        } catch (e) { console.error(e); }
    };

    return (
        <div className="p-3 sm:p-6 max-w-7xl mx-auto">
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                className="mb-6 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center">
                    <Megaphone className="w-5 h-5" />
                </div>
                <div className="flex-1">
                    <h1 className="text-xl sm:text-2xl font-semibold">Facebook Ads</h1>
                    <p className="text-xs text-muted-foreground">Connect an ad account, bind agents to ads, monitor performance.</p>
                </div>
                {accounts.length > 0 && (
                    <button onClick={onConnect} disabled={connecting}
                        className="text-xs px-3 py-2 rounded-lg bg-secondary/60 hover:bg-secondary border border-border flex items-center gap-1.5 disabled:opacity-60">
                        {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        Connect another account
                    </button>
                )}
            </motion.div>

            {loadingAccounts ? (
                <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : accounts.length === 0 ? (
                <EmptyConnectCard onConnect={onConnect} connecting={connecting} />
            ) : (
                <div className="space-y-6">
                    {accounts.map(acc => (
                        <ConnectedAccountSection key={acc.id} account={acc} agents={agents}
                            onDelete={() => onDeleteAccount(acc.id)} />
                    ))}
                </div>
            )}

            {picker && (
                <PickerModal payload={picker}
                    onClose={() => { setPicker(null); sessionStorage.removeItem('meta:connect:payload'); router.replace('/dashboard/meta'); }}
                    onSave={onPickerSave} />
            )}
        </div>
    );
}

// ─── Empty state ──────────────────────────────────────────────

function EmptyConnectCard({ onConnect, connecting }: { onConnect: () => void; connecting: boolean }) {
    return (
        <div className="border border-dashed border-border rounded-2xl px-6 py-12 text-center max-w-xl mx-auto">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/15 text-blue-400 mx-auto mb-4 flex items-center justify-center">
                <Megaphone className="w-6 h-6" />
            </div>
            <h3 className="font-semibold">Connect your Facebook account</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto mt-2 mb-5">
                Once connected, your ads will show up here. You can bind a different agent to each ad and watch live spend, impressions and click statistics.
            </p>
            <button onClick={onConnect} disabled={connecting}
                className="bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg px-4 py-2.5 flex items-center gap-2 mx-auto disabled:opacity-60">
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
                Connect with Facebook
            </button>
        </div>
    );
}

// ─── Ad-account section ──────────────────────────────────────

function ConnectedAccountSection({ account, agents, onDelete }: { account: ConnectedAccount; agents: AgentLite[]; onDelete: () => void }) {
    const [ads, setAds] = useState<Ad[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const r = await api.get(`/meta/accounts/${account.id}/ads`);
            if (r.data?.success) setAds(r.data.ads);
            else setError(r.data?.message || 'Could not load ads');
        } catch (e: any) {
            setError(e?.response?.data?.message || e.message);
        } finally { setLoading(false); }
    }, [account.id]);

    useEffect(() => { load(); }, [load]);

    const tokenIssue = useMemo(() => {
        if (account.status === 'error') return account.lastError || 'Last sync failed';
        if (account.tokenExpiresAt && new Date(account.tokenExpiresAt) < new Date()) return 'Access token expired — please reconnect';
        return null;
    }, [account]);

    return (
        <div className="border border-border rounded-2xl bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-500/15 text-blue-400 flex items-center justify-center flex-shrink-0">
                    <Megaphone className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm truncate">{account.accountName}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary/60 text-muted-foreground">{account.adAccountId}</span>
                        {account.currency && <span className="text-[10px] text-muted-foreground">{account.currency}</span>}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                        {account.fbUserName ? `Connected by ${account.fbUserName}` : 'Connected'}
                        {account.lastSyncedAt && ` · last sync ${new Date(account.lastSyncedAt).toLocaleString()}`}
                    </p>
                </div>
                <button onClick={load} disabled={loading} title="Refresh ads"
                    className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary disabled:opacity-50">
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
                <button onClick={onDelete} title="Disconnect"
                    className="p-1.5 text-muted-foreground hover:text-red-400 rounded-md hover:bg-secondary">
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>

            {tokenIssue && (
                <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 flex items-center gap-2 text-xs text-amber-300">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="flex-1">{tokenIssue}</span>
                </div>
            )}

            {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : error ? (
                <div className="px-4 py-8 text-xs text-red-400 text-center break-words">{error}</div>
            ) : ads.length === 0 ? (
                <div className="px-4 py-8 text-xs text-muted-foreground text-center">No ads in this account.</div>
            ) : (
                <div>
                    {ads.map(ad => (
                        <AdRow key={ad.id} ad={ad} accountId={account.id} agents={agents}
                            // Local patch — avoids re-fetching the whole
                            // ad list (and flashing the spinner) every
                            // time the operator picks an agent.
                            onRouteChange={route => setAds(prev => prev.map(a => a.id === ad.id ? { ...a, route } : a))} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Single ad row ────────────────────────────────────────────

function AdRow({ ad, accountId, agents, onRouteChange }: {
    ad: Ad;
    accountId: string;
    agents: AgentLite[];
    onRouteChange: (route: Ad['route']) => void;
}) {
    const [open, setOpen] = useState(false);
    const [insights, setInsights] = useState<AdInsights | null>(null);
    const [loadingInsights, setLoadingInsights] = useState(false);
    const [insightsError, setInsightsError] = useState<string | null>(null);
    const [binding, setBinding] = useState(false);
    const [datePreset, setDatePreset] = useState<'last_7d' | 'last_30d' | 'maximum'>('last_7d');
    const [contactsTotal, setContactsTotal] = useState<number | null>(null);
    const [contactsModalOpen, setContactsModalOpen] = useState(false);

    const loadInsights = useCallback(async (preset: string) => {
        setLoadingInsights(true);
        setInsightsError(null);
        try {
            const r = await api.get(`/meta/accounts/${accountId}/ads/${ad.id}/insights`, { params: { preset } });
            if (r.data?.success) setInsights(r.data.insights);
            else setInsightsError(r.data?.message || 'No insights');
        } catch (e: any) {
            setInsightsError(e?.response?.data?.message || e.message);
        } finally { setLoadingInsights(false); }
    }, [accountId, ad.id]);

    // First-page contact lookup is just used to populate the count
    // tile. The modal does its own paginated fetch.
    const loadContactsCount = useCallback(async (preset: string) => {
        try {
            const r = await api.get(`/meta/accounts/${accountId}/ads/${ad.id}/contacts`, {
                params: { preset, page: 1, pageSize: 1 },
            });
            if (r.data?.success) setContactsTotal(r.data.total);
        } catch { setContactsTotal(null); }
    }, [accountId, ad.id]);

    useEffect(() => {
        if (open && !insights && !insightsError) loadInsights(datePreset);
        if (open && contactsTotal === null) loadContactsCount(datePreset);
    }, [open, insights, insightsError, datePreset, loadInsights, contactsTotal, loadContactsCount]);

    // Whenever the operator switches range, both stat sources need
    // to re-fetch — keep them in lock-step.
    const switchPreset = (p: typeof datePreset) => {
        setInsights(null);
        setContactsTotal(null);
        setDatePreset(p);
        loadInsights(p);
        loadContactsCount(p);
    };

    const onBind = async (agentId: string) => {
        setBinding(true);
        try {
            if (!agentId) {
                await api.delete(`/meta/accounts/${accountId}/ads/${ad.id}/bind`);
                onRouteChange(null);
            } else {
                const r = await api.post(`/meta/accounts/${accountId}/ads/${ad.id}/bind`, {
                    agentId, adName: ad.name,
                });
                // The bind endpoint returns the saved AdRoute incl. the
                // populated `agent` relation, so we can patch the row
                // locally without re-pulling the whole ad list from
                // Marketing API.
                const newRoute = r.data?.route ? {
                    id: r.data.route.id,
                    agentId: r.data.route.agentId,
                    agent: { name: r.data.route.agent?.name || agents.find(a => a.id === agentId)?.name || '' },
                    isActive: r.data.route.isActive ?? true,
                } : null;
                onRouteChange(newRoute);
            }
        } catch (e: any) {
            alert(e?.response?.data?.message || e.message);
        } finally { setBinding(false); }
    };

    const statusColour =
        ad.effectiveStatus === 'ACTIVE'  ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' :
        ad.effectiveStatus === 'PAUSED'  ? 'text-amber-300 bg-amber-500/10 border-amber-500/30' :
                                            'text-muted-foreground bg-secondary/60 border-border';

    return (
        <div className="border-b border-border last:border-0">
            <div className="flex items-start gap-3 px-3 sm:px-4 py-3 hover:bg-secondary/30">
                <button onClick={() => setOpen(v => !v)}
                    className="flex-shrink-0 mt-1 text-muted-foreground hover:text-foreground">
                    <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
                </button>
                {ad.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ad.thumbnailUrl} alt="" className="w-12 h-12 rounded-lg object-cover bg-secondary/50 flex-shrink-0" />
                ) : (
                    <div className="w-12 h-12 rounded-lg bg-secondary/40 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{ad.name}</span>
                        <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${statusColour}`}>
                            {ad.effectiveStatus || ad.status}
                        </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">
                        {ad.campaign?.name || '—'}{ad.adset?.name && ` · ${ad.adset.name}`}
                    </p>
                </div>
                {/* AI-agent binding control — the most important
                    interaction on this row, so it gets its own
                    labelled block with colour-coded states so
                    operators don't miss what the dropdown is for. */}
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                        <Bot className="w-2.5 h-2.5" />
                        AI Agent
                    </span>
                    <div className="flex items-center gap-1.5">
                        {binding && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                        <select value={ad.route?.agentId || ''} onChange={e => onBind(e.target.value)}
                            disabled={binding}
                            className={`text-xs px-2.5 py-1.5 rounded-md border-2 focus:outline-none focus:ring-2 focus:ring-violet-500/50 disabled:opacity-50 min-w-[170px] transition-colors font-medium cursor-pointer ${ad.route
                                ? 'bg-violet-500/15 border-violet-500/50 text-violet-200'
                                : 'bg-amber-500/5 border-amber-500/40 border-dashed text-amber-300 hover:bg-amber-500/10'}`}>
                            <option value="" className="bg-card text-foreground">
                                {ad.route ? '✕  Unbind' : 'Choose an agent…'}
                            </option>
                            {agents.map(a => (
                                <option key={a.id} value={a.id} className="bg-card text-foreground">{a.name}</option>
                            ))}
                        </select>
                        {ad.route && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                    </div>
                </div>
            </div>
            {open && (
                <div className="px-3 sm:px-4 pb-4 pl-12 sm:pl-14 space-y-3">
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Range:</span>
                        {(['last_7d', 'last_30d', 'maximum'] as const).map(p => (
                            <button key={p} onClick={() => switchPreset(p)}
                                className={`px-2 py-1 rounded ${datePreset === p ? 'bg-primary/20 text-primary' : 'bg-secondary/40 text-muted-foreground hover:bg-secondary/70'}`}>
                                {p === 'last_7d' ? 'Last 7 days' : p === 'last_30d' ? 'Last 30 days' : 'All time'}
                            </button>
                        ))}
                    </div>
                    {loadingInsights ? (
                        <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                    ) : insightsError ? (
                        <p className="text-xs text-amber-300">{insightsError}</p>
                    ) : !insights ? (
                        <p className="text-xs text-muted-foreground">No data for this range.</p>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <Stat label="Spend" value={insights.spend} suffix="" />
                            <Stat label="Impressions" value={insights.impressions} />
                            <Stat label="Clicks" value={insights.clicks} />
                            <Stat label="CTR" value={insights.ctr} suffix="%" />
                            <Stat label="CPM" value={insights.cpm} />
                            <Stat label="CPC" value={insights.cpc} />
                            <Stat label="Reach" value={insights.reach} />
                            {/* Contacts that arrived via this exact ad
                                — clickable, opens the paginated modal.
                                Highlighted differently from the read-only
                                Meta stats so its interactivity is obvious. */}
                            <button onClick={() => setContactsModalOpen(true)}
                                className="bg-violet-500/10 border border-violet-500/30 hover:bg-violet-500/20 hover:border-violet-500/50 rounded-lg px-3 py-2 text-left transition-colors">
                                <p className="text-[10px] uppercase tracking-wide text-violet-300/80 flex items-center gap-1">
                                    Contacts <ExternalLink className="w-2.5 h-2.5" />
                                </p>
                                <p className="text-sm font-semibold tabular-nums mt-0.5 text-violet-200">
                                    {contactsTotal === null ? '—' : contactsTotal.toLocaleString()}
                                </p>
                            </button>
                            {insights.actions && insights.actions.length > 0 && (
                                <Stat label={prettifyAction(insights.actions[0].action_type)} value={insights.actions[0].value} />
                            )}
                        </div>
                    )}
                    {contactsModalOpen && (
                        <AdContactsModal
                            accountId={accountId}
                            adId={ad.id}
                            adName={ad.name}
                            preset={datePreset}
                            onClose={() => setContactsModalOpen(false)}
                        />
                    )}
                </div>
            )}
        </div>
    );
}

function Stat({ label, value, suffix }: { label: string; value?: string | number; suffix?: string }) {
    return (
        <div className="bg-secondary/30 border border-border rounded-lg px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-sm font-semibold tabular-nums mt-0.5">
                {value != null ? `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix || ''}` : '—'}
            </p>
        </div>
    );
}

function prettifyAction(t: string): string {
    return t.replace(/onsite_conversion\./, '').replace(/_/g, ' ');
}

// ─── Picker modal (choose which ad accounts to connect) ──────

function PickerModal({ payload, onClose, onSave }: {
    payload: PickerPayload;
    onClose: () => void;
    onSave: (chosen: PickerPayload['accounts']) => void;
}) {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const toggle = (id: string) => setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const chosen = payload.accounts.filter(a => selected.has(a.adAccountId));

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                    <div>
                        <h3 className="font-semibold">Pick ad accounts to connect</h3>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{payload.accounts.length} account{payload.accounts.length === 1 ? '' : 's'} available from {payload.fbUserName}</p>
                    </div>
                    <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground rounded">
                        <XIcon className="w-4 h-4" />
                    </button>
                </div>
                <div className="overflow-y-auto px-5 py-3">
                    {payload.accounts.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-6 text-center">No ad accounts found on this profile.</p>
                    ) : (
                        <div className="space-y-1.5">
                            {payload.accounts.map(a => {
                                const isSel = selected.has(a.adAccountId);
                                return (
                                    <button key={a.adAccountId} onClick={() => toggle(a.adAccountId)}
                                        className={`w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-lg border ${isSel ? 'bg-primary/15 border-primary/40' : 'bg-secondary/30 border-border hover:bg-secondary/50'}`}>
                                        <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${isSel ? 'bg-primary border-primary' : 'border-border'}`}>
                                            {isSel && <CheckCircle2 className="w-3 h-3 text-primary-foreground" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm truncate">{a.accountName}</p>
                                            <p className="text-[10px] text-muted-foreground font-mono">{a.adAccountId}{a.currency ? ` · ${a.currency}` : ''}</p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
                <div className="border-t border-border px-5 py-4 flex justify-between items-center">
                    <a href="https://business.facebook.com/adsmanager" target="_blank" rel="noreferrer"
                        className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                        Ads Manager <ExternalLink className="w-3 h-3" />
                    </a>
                    <div className="flex gap-2">
                        <button onClick={onClose}
                            className="text-sm px-3 py-2 rounded-lg bg-secondary/40 hover:bg-secondary border border-border">Cancel</button>
                        <button onClick={() => onSave(chosen)} disabled={chosen.length === 0}
                            className="text-sm px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 font-medium">
                            {chosen.length === 0 ? 'Pick' : `Connect (${chosen.length})`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Ad → contacts modal ──────────────────────────────────────
//
// Pulls /meta/accounts/:id/ads/:adId/contacts paginated. 15 rows
// per page matches the spec; backend caps at 50 if anything tries
// to ask for more.

type AdContact = {
    id: string;
    name: string | null;
    phone: string;
    status: string;
    tags: string[];
    isAnonymous: boolean;
    createdAt: string;
    assignedAgent: { id: string; name: string } | null;
};

const CONTACTS_PAGE_SIZE = 15;

function AdContactsModal({ accountId, adId, adName, preset, onClose }: {
    accountId: string;
    adId: string;
    adName: string;
    preset: 'last_7d' | 'last_30d' | 'maximum';
    onClose: () => void;
}) {
    const [contacts, setContacts] = useState<AdContact[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (p: number) => {
        setLoading(true);
        setError(null);
        try {
            const r = await api.get(`/meta/accounts/${accountId}/ads/${adId}/contacts`, {
                params: { preset, page: p, pageSize: CONTACTS_PAGE_SIZE },
            });
            if (r.data?.success) {
                setContacts(r.data.contacts);
                setTotal(r.data.total);
            } else {
                setError(r.data?.message || 'Failed to load');
            }
        } catch (e: any) {
            setError(e?.response?.data?.message || e.message);
        } finally { setLoading(false); }
    }, [accountId, adId, preset]);

    useEffect(() => { load(page); }, [load, page]);

    const totalPages = Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE));
    const presetLabel = preset === 'last_7d' ? 'Last 7 days' : preset === 'last_30d' ? 'Last 30 days' : 'All time';

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="font-semibold truncate">Contacts from this ad</h3>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                            {adName} · {presetLabel} · {total.toLocaleString()} total
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground rounded flex-shrink-0">
                        <XIcon className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                    ) : error ? (
                        <div className="px-5 py-10 text-xs text-red-400 text-center break-words">{error}</div>
                    ) : contacts.length === 0 ? (
                        <div className="px-5 py-12 text-xs text-muted-foreground text-center">
                            No contacts arrived from this ad in the selected range yet.
                        </div>
                    ) : (
                        <div>
                            {contacts.map(c => (
                                <a key={c.id} href={`/dashboard/contacts/${c.id}`} target="_blank" rel="noreferrer"
                                    className="flex items-center gap-3 px-5 py-2.5 border-b border-border last:border-0 hover:bg-secondary/30 transition-colors">
                                    <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">
                                        {(c.name || c.phone || '?').charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-medium truncate">{c.name || (c.isAnonymous ? 'WhatsApp contact' : `+${c.phone}`)}</span>
                                            {c.status && c.status !== 'NEW' && (
                                                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-secondary/60 text-muted-foreground">{c.status}</span>
                                            )}
                                            {c.assignedAgent && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 border border-violet-500/30 truncate max-w-[120px]">
                                                    {c.assignedAgent.name}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                                            {c.name && !c.isAnonymous && <span className="font-mono">+{c.phone} · </span>}
                                            arrived {new Date(c.createdAt).toLocaleString()}
                                        </p>
                                    </div>
                                    {c.tags.length > 0 && (
                                        <div className="hidden sm:flex gap-1 flex-shrink-0">
                                            {c.tags.slice(0, 2).map(t => (
                                                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/60 text-muted-foreground">{t}</span>
                                            ))}
                                        </div>
                                    )}
                                </a>
                            ))}
                        </div>
                    )}
                </div>

                {totalPages > 1 && (
                    <div className="border-t border-border px-5 py-3 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                            Page {page} of {totalPages}
                        </span>
                        <div className="flex gap-1.5">
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1 || loading}
                                className="px-2.5 py-1 rounded bg-secondary/40 hover:bg-secondary border border-border disabled:opacity-40">
                                Previous
                            </button>
                            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages || loading}
                                className="px-2.5 py-1 rounded bg-secondary/40 hover:bg-secondary border border-border disabled:opacity-40">
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

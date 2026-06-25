"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Megaphone, Loader2, Plus, Trash2, ExternalLink, ChevronRight, X as XIcon, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
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
            router.replace('/dashboard/ads/meta');
            await loadAccounts();
        } catch (e: any) {
            alert(e?.response?.data?.message || e.message);
        }
    };

    const onDeleteAccount = async (id: string) => {
        if (!confirm('Bu hesabı ayırsaq, onun reklamlarına bağlı agent qaydaları silinmir — sadəcə hesabın özü silinir.')) return;
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
                    <p className="text-xs text-muted-foreground">Reklam hesabını qoş, hər reklama agent bağla, statistika gör.</p>
                </div>
                {accounts.length > 0 && (
                    <button onClick={onConnect} disabled={connecting}
                        className="text-xs px-3 py-2 rounded-lg bg-secondary/60 hover:bg-secondary border border-border flex items-center gap-1.5 disabled:opacity-60">
                        {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        Başqa hesab qoş
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
                    onClose={() => { setPicker(null); sessionStorage.removeItem('meta:connect:payload'); router.replace('/dashboard/ads/meta'); }}
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
            <h3 className="font-semibold">Facebook hesabını qoş</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto mt-2 mb-5">
                Facebook hesabınızı qoşduqdan sonra reklamlarınız burada görünəcək. Hər reklama ayrı agent bağlaya, reklamın xərc / impression / klik statistikasını canlı göstərə bilərsiniz.
            </p>
            <button onClick={onConnect} disabled={connecting}
                className="bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg px-4 py-2.5 flex items-center gap-2 mx-auto disabled:opacity-60">
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
                Facebook ilə qoş
            </button>
            <p className="text-[10px] text-muted-foreground/70 mt-3">Tələb olunan icazələr: ads_read, business_management.</p>
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
                        {account.fbUserName ? `${account.fbUserName} tərəfindən qoşuldu` : 'Connected'}
                        {account.lastSyncedAt && ` · son sync ${new Date(account.lastSyncedAt).toLocaleString()}`}
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
                <div className="px-4 py-8 text-xs text-muted-foreground text-center">Bu hesabda reklam yoxdur.</div>
            ) : (
                <div>
                    {ads.map(ad => (
                        <AdRow key={ad.id} ad={ad} accountId={account.id} agents={agents} onBindChange={load} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Single ad row ────────────────────────────────────────────

function AdRow({ ad, accountId, agents, onBindChange }: { ad: Ad; accountId: string; agents: AgentLite[]; onBindChange: () => void }) {
    const [open, setOpen] = useState(false);
    const [insights, setInsights] = useState<AdInsights | null>(null);
    const [loadingInsights, setLoadingInsights] = useState(false);
    const [insightsError, setInsightsError] = useState<string | null>(null);
    const [binding, setBinding] = useState(false);
    const [datePreset, setDatePreset] = useState<'last_7d' | 'last_30d' | 'maximum'>('last_7d');

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

    useEffect(() => {
        if (open && !insights && !insightsError) loadInsights(datePreset);
    }, [open, insights, insightsError, datePreset, loadInsights]);

    const onBind = async (agentId: string) => {
        setBinding(true);
        try {
            if (!agentId) {
                await api.delete(`/meta/accounts/${accountId}/ads/${ad.id}/bind`);
            } else {
                await api.post(`/meta/accounts/${accountId}/ads/${ad.id}/bind`, {
                    agentId, adName: ad.name,
                });
            }
            onBindChange();
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
                    {ad.route && (
                        <p className="text-[11px] text-violet-300 mt-0.5">
                            → {ad.route.agent.name}
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <select value={ad.route?.agentId || ''} onChange={e => onBind(e.target.value)}
                        disabled={binding}
                        className="bg-secondary/50 border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50 min-w-[140px]">
                        <option value="">— bağlanmayıb —</option>
                        {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    {ad.route && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                </div>
            </div>
            {open && (
                <div className="px-3 sm:px-4 pb-4 pl-12 sm:pl-14 space-y-3">
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Tarix:</span>
                        {(['last_7d', 'last_30d', 'maximum'] as const).map(p => (
                            <button key={p} onClick={() => { setInsights(null); setDatePreset(p); loadInsights(p); }}
                                className={`px-2 py-1 rounded ${datePreset === p ? 'bg-primary/20 text-primary' : 'bg-secondary/40 text-muted-foreground hover:bg-secondary/70'}`}>
                                {p === 'last_7d' ? 'Son 7 gün' : p === 'last_30d' ? 'Son 30 gün' : 'Bütün vaxt'}
                            </button>
                        ))}
                    </div>
                    {loadingInsights ? (
                        <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
                    ) : insightsError ? (
                        <p className="text-xs text-amber-300">{insightsError}</p>
                    ) : !insights ? (
                        <p className="text-xs text-muted-foreground">Bu dövr üçün məlumat yoxdur.</p>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <Stat label="Xərc" value={insights.spend} suffix="" />
                            <Stat label="Impressions" value={insights.impressions} />
                            <Stat label="Klik" value={insights.clicks} />
                            <Stat label="CTR" value={insights.ctr} suffix="%" />
                            <Stat label="CPM" value={insights.cpm} />
                            <Stat label="CPC" value={insights.cpc} />
                            <Stat label="Reach" value={insights.reach} />
                            {insights.actions && insights.actions.length > 0 && (
                                <Stat label={prettifyAction(insights.actions[0].action_type)} value={insights.actions[0].value} />
                            )}
                        </div>
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
                        <h3 className="font-semibold">Reklam hesabını seç</h3>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{payload.fbUserName} hesabından əldə olunan {payload.accounts.length} hesab</p>
                    </div>
                    <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground rounded">
                        <XIcon className="w-4 h-4" />
                    </button>
                </div>
                <div className="overflow-y-auto px-5 py-3">
                    {payload.accounts.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-6 text-center">Bu hesabda heç bir reklam hesabı tapılmadı.</p>
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
                            className="text-sm px-3 py-2 rounded-lg bg-secondary/40 hover:bg-secondary border border-border">Ləğv</button>
                        <button onClick={() => onSave(chosen)} disabled={chosen.length === 0}
                            className="text-sm px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 font-medium">
                            {chosen.length === 0 ? 'Seç' : `Qoş (${chosen.length})`}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

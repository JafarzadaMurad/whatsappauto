"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone, Loader2, Plus, Pencil, Trash2, ExternalLink, Sparkles, X as XIcon, ChevronRight } from "lucide-react";
import api from "@/lib/api";
import { motion } from "framer-motion";

type AdRoute = {
    id: string;
    name: string;
    matchType: 'headline' | 'source_url' | 'ad_id' | 'ctwa_prefix';
    matchValue: string;
    priority: number;
    isActive: boolean;
    hitCount: number;
    lastHitAt: string | null;
    createdAt: string;
    agent: { id: string; name: string };
};

type RecentAd = {
    key: string;
    title: string | null;
    sourceUrl: string | null;
    sourceId: string | null;
    mediaType: string | null;
    contacts: number;
    wonCount: number;
    lastSeenAt: string;
    sample: { phone: string; name: string | null; createdAt: string };
};

type AgentLite = { id: string; name: string };

const MATCH_TYPE_LABELS: Record<AdRoute['matchType'], string> = {
    headline:    'Reklam başlığı (substring)',
    source_url:  'Source URL (substring)',
    ad_id:       'Reklam ID (dəqiq)',
    ctwa_prefix: 'CTWA Click ID (prefix)',
};

type Tab = 'routing' | 'recent';

export default function AdsPage() {
    const [tab, setTab] = useState<Tab>('routing');
    const [routes, setRoutes] = useState<AdRoute[]>([]);
    const [recent, setRecent] = useState<RecentAd[]>([]);
    const [agents, setAgents] = useState<AgentLite[]>([]);
    const [loadingRoutes, setLoadingRoutes] = useState(true);
    const [loadingRecent, setLoadingRecent] = useState(true);
    const [editing, setEditing] = useState<Partial<AdRoute> | null>(null);

    const loadRoutes = useCallback(async () => {
        setLoadingRoutes(true);
        try {
            const r = await api.get('/ads/routes');
            if (r.data?.success) setRoutes(r.data.routes);
        } catch (e) { console.error(e); }
        finally { setLoadingRoutes(false); }
    }, []);

    const loadRecent = useCallback(async () => {
        setLoadingRecent(true);
        try {
            const r = await api.get('/ads/recent');
            if (r.data?.success) setRecent(r.data.ads);
        } catch (e) { console.error(e); }
        finally { setLoadingRecent(false); }
    }, []);

    const loadAgents = useCallback(async () => {
        try {
            const r = await api.get('/agents');
            if (r.data?.success) setAgents((r.data.agents || []).map((a: any) => ({ id: a.id, name: a.name })));
        } catch (e) { console.error(e); }
    }, []);

    useEffect(() => { loadRoutes(); loadRecent(); loadAgents(); }, [loadRoutes, loadRecent, loadAgents]);

    const onSave = async (draft: Partial<AdRoute>) => {
        const body = {
            name: draft.name,
            matchType: draft.matchType,
            matchValue: draft.matchValue,
            agentId: (draft as any).agentId || draft.agent?.id,
            priority: draft.priority ?? 0,
            isActive: draft.isActive ?? true,
        };
        try {
            if (draft.id) await api.put(`/ads/routes/${draft.id}`, body);
            else await api.post('/ads/routes', body);
            setEditing(null);
            await loadRoutes();
        } catch (e) { console.error(e); }
    };

    const onDelete = async (id: string) => {
        if (!confirm('Bu qaydanı silmək istədiyinizə əminsiniz?')) return;
        try {
            await api.delete(`/ads/routes/${id}`);
            await loadRoutes();
        } catch (e) { console.error(e); }
    };

    const recentTotals = useMemo(() => ({
        ads: recent.length,
        contacts: recent.reduce((s, a) => s + a.contacts, 0),
        won: recent.reduce((s, a) => s + a.wonCount, 0),
    }), [recent]);

    return (
        <div className="p-3 sm:p-6 max-w-7xl mx-auto">
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                className="mb-6 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                    <Megaphone className="w-5 h-5" />
                </div>
                <div>
                    <h1 className="text-xl sm:text-2xl font-semibold">Ads</h1>
                    <p className="text-xs text-muted-foreground">Click-to-WhatsApp reklamlarını agentlərə yönləndir, hər reklamın trafikinə bax.</p>
                </div>
            </motion.div>

            <div className="flex gap-1 border-b border-border mb-4">
                <TabButton active={tab === 'routing'} onClick={() => setTab('routing')}>
                    Routing qaydaları
                    {routes.length > 0 && <span className="ml-1.5 text-[10px] opacity-60">{routes.length}</span>}
                </TabButton>
                <TabButton active={tab === 'recent'} onClick={() => setTab('recent')}>
                    Son reklamlar
                    {recent.length > 0 && <span className="ml-1.5 text-[10px] opacity-60">{recent.length}</span>}
                </TabButton>
            </div>

            {tab === 'routing' && (
                <div>
                    <div className="mb-3 flex items-center justify-between">
                        <p className="text-xs text-muted-foreground max-w-xl">
                            Bu qaydalar yalnız <span className="text-foreground">ilk mesajda</span> tətbiq olunur. Müştəri reklamdan gəldikdə uyğun qaydanın agentinə bağlanır və bundan sonra həmin agentlə danışır.
                        </p>
                        <button onClick={() => setEditing({ matchType: 'headline', priority: 0, isActive: true })}
                            className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg px-3 py-2 flex items-center gap-2 text-sm flex-shrink-0">
                            <Plus className="w-4 h-4" /> Yeni qayda
                        </button>
                    </div>

                    {loadingRoutes ? (
                        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                    ) : routes.length === 0 ? (
                        <EmptyHint
                            title="Hələ ki, routing qaydası yoxdur"
                            body="Reklamlardan müştərilər gəlir, amma hamısı eyni default agentə düşür. Yeni qayda ilə hansı reklamın hansı agentə getməsini təyin et."
                        />
                    ) : (
                        <div className="border border-border rounded-xl overflow-hidden bg-card">
                            {routes.map(r => (
                                <div key={r.id} className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-border last:border-0 hover:bg-secondary/30">
                                    <div className={`w-1 self-stretch rounded-full ${r.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-medium">{r.name}</span>
                                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-secondary/60 text-muted-foreground">
                                                {MATCH_TYPE_LABELS[r.matchType]}
                                            </span>
                                            {r.priority > 0 && (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">
                                                    P{r.priority}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">
                                            “{r.matchValue}”
                                        </p>
                                        <p className="text-[11px] text-muted-foreground mt-0.5">
                                            → <span className="text-violet-300">{r.agent.name}</span>
                                            {r.hitCount > 0 && <span className="ml-2 opacity-60">{r.hitCount} dəfə işlədi{r.lastHitAt && ` · son ${new Date(r.lastHitAt).toLocaleDateString()}`}</span>}
                                        </p>
                                    </div>
                                    <button onClick={() => setEditing({ ...r, agentId: r.agent.id } as any)}
                                        className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary">
                                        <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button onClick={() => onDelete(r.id)}
                                        className="p-1.5 text-muted-foreground hover:text-red-400 rounded-md hover:bg-secondary">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {tab === 'recent' && (
                <div>
                    <div className="mb-3 grid grid-cols-3 gap-3">
                        <Stat label="Unikal reklam" value={recentTotals.ads} />
                        <Stat label="Gələn müştərilər" value={recentTotals.contacts} />
                        <Stat label="Won statusda" value={recentTotals.won} />
                    </div>
                    {loadingRecent ? (
                        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                    ) : recent.length === 0 ? (
                        <EmptyHint
                            title="Hələ ki, click-to-WhatsApp reklamından trafik gəlməyib"
                            body="Reklamdan klik edib WhatsApp-da yazan ilk müştəri olduqda burada hansı reklamdan gəldiyi avtomatik görünəcək."
                        />
                    ) : (
                        <div className="border border-border rounded-xl overflow-hidden bg-card">
                            {recent.map(a => (
                                <RecentAdRow key={a.key} ad={a}
                                    onCreateRule={() => setEditing({
                                        name: a.title || a.sourceUrl || 'Yeni qayda',
                                        matchType: a.title ? 'headline' : 'source_url',
                                        matchValue: a.title || a.sourceUrl || '',
                                        priority: 0,
                                        isActive: true,
                                    })} />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {editing && (
                <RouteEditorModal
                    initial={editing}
                    agents={agents}
                    onClose={() => setEditing(null)}
                    onSave={onSave}
                />
            )}
        </div>
    );
}

// ─── Sub-components ───────────────────────────────────────────

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button onClick={onClick}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {children}
        </button>
    );
}

function Stat({ label, value }: { label: string; value: number }) {
    return (
        <div className="bg-card border border-border rounded-xl px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-xl font-semibold tabular-nums mt-1">{value}</p>
        </div>
    );
}

function EmptyHint({ title, body }: { title: string; body: string }) {
    return (
        <div className="border border-dashed border-border rounded-xl px-6 py-12 text-center">
            <Sparkles className="w-6 h-6 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1">{body}</p>
        </div>
    );
}

function RecentAdRow({ ad, onCreateRule }: { ad: RecentAd; onCreateRule: () => void }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="border-b border-border last:border-0">
            <button onClick={() => setOpen(v => !v)}
                className="w-full flex items-center gap-3 px-3 sm:px-4 py-3 hover:bg-secondary/30 text-left">
                <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ad.title || '(başlıqsız)'}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{ad.sourceUrl || '—'}</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
                    <span className="tabular-nums"><b className="text-foreground">{ad.contacts}</b> contact</span>
                    {ad.wonCount > 0 && <span className="tabular-nums text-emerald-400"><b>{ad.wonCount}</b> won</span>}
                </div>
            </button>
            {open && (
                <div className="px-10 sm:px-12 pb-3 space-y-2 text-xs">
                    <KV label="Reklam ID" value={ad.sourceId} mono />
                    <KV label="Media" value={ad.mediaType} />
                    <KV label="Son gələn" value={new Date(ad.lastSeenAt).toLocaleString()} />
                    <KV label="Nümunə müştəri" value={ad.sample.name ? `${ad.sample.name} (+${ad.sample.phone})` : `+${ad.sample.phone}`} />
                    <div className="flex gap-2 pt-1">
                        <button onClick={onCreateRule}
                            className="text-[11px] px-2.5 py-1.5 rounded-md bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30 flex items-center gap-1.5">
                            <Plus className="w-3 h-3" /> Bu reklamdan qayda yarat
                        </button>
                        {ad.sourceUrl && (
                            <a href={ad.sourceUrl} target="_blank" rel="noreferrer"
                                className="text-[11px] px-2.5 py-1.5 rounded-md bg-secondary/60 hover:bg-secondary text-foreground border border-border flex items-center gap-1.5">
                                <ExternalLink className="w-3 h-3" /> Source URL
                            </a>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function KV({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
    return (
        <div className="flex gap-2">
            <span className="text-muted-foreground min-w-[100px]">{label}</span>
            <span className={`break-all ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
        </div>
    );
}

function RouteEditorModal({ initial, agents, onClose, onSave }: {
    initial: Partial<AdRoute & { agentId?: string }>;
    agents: AgentLite[];
    onClose: () => void;
    onSave: (r: Partial<AdRoute>) => void;
}) {
    const [draft, setDraft] = useState<Partial<AdRoute & { agentId?: string }>>(initial);
    const set = (patch: any) => setDraft(d => ({ ...d, ...patch }));
    const canSave = !!draft.name?.trim() && !!draft.matchValue?.trim() && !!(draft.agentId || draft.agent?.id);

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                    <h3 className="font-semibold">{draft.id ? 'Routing qaydası — redaktə' : 'Yeni routing qaydası'}</h3>
                    <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground rounded">
                        <XIcon className="w-4 h-4" />
                    </button>
                </div>
                <div className="px-5 py-4 space-y-3">
                    <Field label="Qaydanın adı">
                        <input type="text" value={draft.name || ''} onChange={e => set({ name: e.target.value })}
                            placeholder="məs. Türkiyə əmlakı kampaniyası"
                            className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                    </Field>
                    <Field label="Uyğunluq növü">
                        <select value={draft.matchType || 'headline'} onChange={e => set({ matchType: e.target.value })}
                            className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
                            {(Object.keys(MATCH_TYPE_LABELS) as AdRoute['matchType'][]).map(k => (
                                <option key={k} value={k}>{MATCH_TYPE_LABELS[k]}</option>
                            ))}
                        </select>
                    </Field>
                    <Field label={draft.matchType === 'ad_id' ? 'Reklam ID' : draft.matchType === 'ctwa_prefix' ? 'Click ID prefix' : 'Axtarılan mətn'}>
                        <input type="text" value={draft.matchValue || ''} onChange={e => set({ matchValue: e.target.value })}
                            placeholder={
                                draft.matchType === 'headline'    ? 'Türkiyə əmlakı' :
                                draft.matchType === 'source_url'  ? 'utm_campaign=turkey-real-estate' :
                                draft.matchType === 'ad_id'       ? '120211234567890123' :
                                                                    'fb.1.1234'
                            }
                            className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
                        <p className="text-[10px] text-muted-foreground mt-1">
                            {draft.matchType === 'headline'   && 'Reklam başlığında bu mətnin keçdiyi yerlər (case-insensitive).'}
                            {draft.matchType === 'source_url' && 'Source URL-də (landing page) bu mətnin olduğu reklamlar.'}
                            {draft.matchType === 'ad_id'      && 'Meta-nın verdiyi dəqiq ad-creative ID.'}
                            {draft.matchType === 'ctwa_prefix' && 'WhatsApp Click ID-nin başlığı bununla başlayan reklamlar.'}
                        </p>
                    </Field>
                    <Field label="Hansı agentə getsin?">
                        <select value={draft.agentId || draft.agent?.id || ''} onChange={e => set({ agentId: e.target.value })}
                            className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40">
                            <option value="">— seç —</option>
                            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Prioritet">
                            <input type="number" value={draft.priority ?? 0} onChange={e => set({ priority: Number(e.target.value) })}
                                min={0} max={1000}
                                className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                            <p className="text-[10px] text-muted-foreground mt-1">Yüksək prioritet birinci yoxlanır.</p>
                        </Field>
                        <Field label="Status">
                            <label className="flex items-center gap-2 mt-2 text-sm select-none">
                                <input type="checkbox" checked={draft.isActive ?? true} onChange={e => set({ isActive: e.target.checked })}
                                    className="rounded" />
                                Aktiv
                            </label>
                        </Field>
                    </div>
                </div>
                <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
                    <button onClick={onClose}
                        className="text-sm px-3 py-2 rounded-lg bg-secondary/40 hover:bg-secondary text-foreground border border-border">
                        Ləğv
                    </button>
                    <button onClick={() => onSave(draft)} disabled={!canSave}
                        className="text-sm px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 font-medium">
                        {draft.id ? 'Yadda saxla' : 'Yarat'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{label}</label>
            {children}
        </div>
    );
}

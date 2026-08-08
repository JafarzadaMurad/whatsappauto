"use client";

// Admin → AI Providers & Pricing. One page for what used to be three.
//
// "AI Models", "Platform Keys" and "AI Pricing" were separate screens,
// but they're three facets of one thing: a provider. Splitting them
// meant the answers to "can users pick this?", "can the server call
// it?" and "what do we charge for it?" lived in three places, and a
// half-configured provider looked fine on every one of them.
//
// So: one row per provider. The API key sits in the row itself — the
// thing you most often come here to paste shouldn't need a click to
// reach. Opening a row reveals its models, and since a model IS its
// price row, models and pricing are one table rather than two tabs.
// A model with no rate is a billing hole, so adding one demands its
// rate in the same breath.
//
// Everything is edited locally and committed by one save (⌘S / the
// floating bar). No autosave: these numbers decide what customers pay.

import { useEffect, useMemo, useState } from "react";
import {
    Sparkles, Loader2, KeyRound, Coins, Bot, ChevronRight, Plus, Trash2, Save,
    Search, Eye, EyeOff, ExternalLink, Mic, Volume2, MessageSquare,
    AudioLines, AlertTriangle,
} from "lucide-react";
import api from "@/lib/api";
import UnsavedChangesBar from "@/components/UnsavedChangesBar";

// ─── Types mirroring GET /admin/ai-hub ──────────────────────────────
type Capability = "text" | "stt" | "voice-llm" | "tts";
type Kind = "token" | "stt_minute" | "tts_chars";

type PricingRow = {
    id: string;
    provider: string;
    model: string;
    kind: Kind;
    unitCostUsd: number;
    inputCostPer1M: number;
    outputCostPer1M: number;
    cachedCostPer1M: number;
    marginMultiplier: number;
    isActive: boolean;
};

type Provider = {
    id: string;
    label: string;
    blurb: string;
    docsUrl: string | null;
    capabilities: Capability[];
    configKey: string | null;
    keyPlaceholder: string;
    keyHint: string | null;
    keySet: boolean;
    keyUpdatedAt: string | null;
    catalogueBucket: "OPENAI" | "CLAUDE" | "GEMINI" | "GLM" | null;
    catalogueModels: string[];
    pricingIds: string[];
    pricingCount: number;
    voice: {
        transcribers: { model: string; label: string; costPerMin: number }[];
        llms: { provider: string; model: string; label: string; inCostPer1M: number; outCostPer1M: number; combinesSttTts: boolean }[];
        voices: { voiceId: string; label: string; costPer1MChars: number }[];
        voiceModels: { id: string; label: string; costPer1MChars: number | null }[];
    };
};

const CAP_META: Record<Capability, { label: string; icon: any; cls: string }> = {
    text: { label: "Text", icon: MessageSquare, cls: "bg-sky-500/10 text-sky-400 border-sky-500/25" },
    "voice-llm": { label: "Voice LLM", icon: AudioLines, cls: "bg-violet-500/10 text-violet-400 border-violet-500/25" },
    stt: { label: "Transcribe", icon: Mic, cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" },
    tts: { label: "Speak", icon: Volume2, cls: "bg-amber-500/10 text-amber-400 border-amber-500/25" },
};

const KIND_LABEL: Record<Kind, string> = {
    token: "per 1M tokens",
    stt_minute: "per audio minute",
    tts_chars: "per 1M characters",
};

// 1 credit = $0.0001.
const previewCredits = (r: PricingRow) => {
    const usd =
        r.kind === "stt_minute" ? r.unitCostUsd :
        r.kind === "tts_chars" ? (1_000 / 1_000_000) * r.unitCostUsd :
        (1_000 / 1_000_000) * r.outputCostPer1M;
    return Math.ceil(usd * r.marginMultiplier * 10_000);
};
// A row whose effective rate is zero charges nothing at all. It looks
// like a normal row, so it needs to be said out loud.
const rateOf = (r: PricingRow) => (r.kind === "token" ? r.outputCostPer1M : r.unitCostUsd);
const isFree = (r: PricingRow) => r.isActive && rateOf(r) <= 0;

const previewUnit = (k: Kind) => (k === "stt_minute" ? "min" : k === "tts_chars" ? "1K chars" : "1K out");

export default function AdminAiProvidersPage() {
    const [providers, setProviders] = useState<Provider[]>([]);
    const [pricing, setPricing] = useState<PricingRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Local edit buffers, one per concern. Baselines are what the
    // server last confirmed, so the save bar reflects real changes.
    const [keys, setKeys] = useState<Record<string, string>>({});
    const [keyBase, setKeyBase] = useState<Record<string, string>>({});
    const [catalogue, setCatalogue] = useState<Record<string, string[]>>({});
    const [catalogueBase, setCatalogueBase] = useState<Record<string, string[]>>({});
    const [rows, setRows] = useState<PricingRow[]>([]);

    const [open, setOpen] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [onlyConfigured, setOnlyConfigured] = useState(false);

    const load = async () => {
        try {
            const [hub, cfg] = await Promise.all([
                api.get("/admin/ai-hub"),
                api.get("/admin/config"),
            ]);
            if (hub.data?.success) {
                const ps: Provider[] = hub.data.providers;
                setProviders(ps);
                setPricing(hub.data.pricing);
                setRows(hub.data.pricing);
                const cat: Record<string, string[]> = {};
                for (const p of ps) if (p.catalogueBucket) cat[p.catalogueBucket] = p.catalogueModels;
                setCatalogue(cat);
                setCatalogueBase(cat);
                // Key values live in SystemConfig; the hub only reports
                // whether one is set.
                const conf = cfg.data?.config || {};
                const kv: Record<string, string> = {};
                for (const p of ps) if (p.configKey) kv[p.configKey] = conf[p.configKey]?.value || "";
                setKeys(kv);
                setKeyBase(kv);
            }
        } catch (e: any) {
            setError(e.response?.data?.message || e.message);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    // ─── Dirty tracking ─────────────────────────────────────────────
    const dirtyKeys = Object.keys(keys).filter(k => (keys[k] || "") !== (keyBase[k] || ""));
    const dirtyBuckets = Object.keys(catalogue).filter(
        b => JSON.stringify(catalogue[b]) !== JSON.stringify(catalogueBase[b] || [])
    );
    const dirtyRows = rows.filter(r => {
        const b = pricing.find(x => x.id === r.id);
        if (!b) return false;
        return b.inputCostPer1M !== r.inputCostPer1M
            || b.outputCostPer1M !== r.outputCostPer1M
            || b.cachedCostPer1M !== r.cachedCostPer1M
            || b.unitCostUsd !== r.unitCostUsd
            || b.marginMultiplier !== r.marginMultiplier
            || b.isActive !== r.isActive;
    });
    const dirty = dirtyKeys.length > 0 || dirtyBuckets.length > 0 || dirtyRows.length > 0;

    const dirtyLabel = [
        dirtyKeys.length && `${dirtyKeys.length} key${dirtyKeys.length > 1 ? "s" : ""}`,
        dirtyBuckets.length && `${dirtyBuckets.length} catalogue${dirtyBuckets.length > 1 ? "s" : ""}`,
        dirtyRows.length && `${dirtyRows.length} rate${dirtyRows.length > 1 ? "s" : ""}`,
    ].filter(Boolean).join(" · ");

    const discard = () => { setKeys(keyBase); setCatalogue(catalogueBase); setRows(pricing); };

    const saveAll = async () => {
        setSaving(true);
        setError(null);
        try {
            if (dirtyKeys.length) {
                // Only send what changed — a blanket PUT of every field
                // would rewrite keys nobody touched.
                const entries: Record<string, string> = {};
                for (const k of dirtyKeys) entries[k] = keys[k].trim();
                await api.put("/admin/config", { entries });
            }
            if (dirtyBuckets.length) await putCatalogue(catalogue);
            for (const r of dirtyRows) {
                await api.put(`/admin/ai-pricing/${r.id}`, {
                    inputCostPer1M: r.inputCostPer1M,
                    outputCostPer1M: r.outputCostPer1M,
                    cachedCostPer1M: r.cachedCostPer1M,
                    unitCostUsd: r.unitCostUsd,
                    marginMultiplier: r.marginMultiplier,
                    isActive: r.isActive,
                });
            }
            await load();
        } catch (e: any) {
            setError(e.response?.data?.message || e.message);
        } finally {
            setSaving(false);
        }
    };

    const putCatalogue = (cat: Record<string, string[]>) => api.put("/admin/ai-models", {
        models: {
            OPENAI: cat.OPENAI || [],
            CLAUDE: cat.CLAUDE || [],
            GEMINI: cat.GEMINI || [],
            GLM: cat.GLM || [],
        },
    });

    // Adding a model writes its price row immediately — a model with no
    // rate silently bills at the fallback estimate, which is the exact
    // hole this page exists to close. Catalogue membership goes with it
    // in the same action so the two can't drift apart.
    const addModel = async (p: Provider, draft: {
        model: string; kind: Kind; inputCostPer1M: number; outputCostPer1M: number;
        cachedCostPer1M: number; unitCostUsd: number; marginMultiplier: number; pickable: boolean;
    }) => {
        setError(null);
        try {
            await api.post("/admin/ai-pricing", {
                provider: p.id,
                model: draft.model,
                kind: draft.kind,
                inputCostPer1M: draft.inputCostPer1M,
                outputCostPer1M: draft.outputCostPer1M,
                cachedCostPer1M: draft.cachedCostPer1M,
                unitCostUsd: draft.unitCostUsd,
                marginMultiplier: draft.marginMultiplier,
            });
            if (draft.pickable && p.catalogueBucket) {
                const bucket = p.catalogueBucket;
                const next = { ...catalogue, [bucket]: [...(catalogue[bucket] || []), draft.model] };
                await putCatalogue(next);
            }
            await load();
        } catch (e: any) {
            setError(e.response?.data?.message || e.message);
        }
    };

    // ─── Search / filter ────────────────────────────────────────────
    const q = search.trim().toLowerCase();
    const rowsFor = (p: Provider) => rows.filter(r => p.pricingIds.includes(r.provider.toLowerCase()));
    const matches = (p: Provider) => {
        if (onlyConfigured && !p.keySet) return false;
        if (!q) return true;
        if (p.label.toLowerCase().includes(q) || p.id.includes(q)) return true;
        if (p.catalogueModels.some(m => m.toLowerCase().includes(q))) return true;
        if (rowsFor(p).some(r => r.model.toLowerCase().includes(q))) return true;
        return [...p.voice.transcribers, ...p.voice.llms, ...p.voice.voices]
            .some((v: any) => (v.label || "").toLowerCase().includes(q) || (v.model || v.voiceId || "").toLowerCase().includes(q));
    };
    const visible = useMemo(() => providers.filter(matches), [providers, rows, q, onlyConfigured]);

    const stats = useMemo(() => ({
        configured: providers.filter(p => p.keySet).length,
        total: providers.length,
        priced: rows.length,
        pickable: Object.values(catalogue).reduce((n, v) => n + v.length, 0),
    }), [providers, rows, catalogue]);

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    return (
        <div className="max-w-6xl mx-auto space-y-6 pb-24">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-xl"><Sparkles className="w-6 h-6" /></div>
                        AI Providers &amp; Pricing
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
                        Every provider in one place. Paste its API key right in the row; open the row to see the models
                        it offers and set what each one costs, read off that provider's own pricing page.
                        Nothing saves until you hit Save (⌘S).
                    </p>
                </div>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-2.5 rounded-xl">{error}</div>
            )}

            {/* Summary strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat icon={KeyRound} label="Keys installed" value={`${stats.configured} / ${stats.total}`} />
                <Stat icon={Bot} label="Models users can pick" value={stats.pickable} />
                <Stat icon={Coins} label="Priced models" value={stats.priced} />
                <Stat icon={Sparkles} label="Credit rate" value="1 cai = $0.0001" small />
            </div>

            {/* Search + filter */}
            <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[220px]">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search a provider or any model id…"
                        className="w-full bg-secondary/40 border border-border rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </div>
                <button onClick={() => setOnlyConfigured(v => !v)}
                    className={`text-xs font-medium rounded-xl px-3 py-2 border transition-all ${
                        onlyConfigured ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 border-border hover:bg-secondary"
                    }`}>
                    Installed only
                </button>
            </div>

            {/* Provider list */}
            <div className="space-y-2.5">
                {visible.map(p => {
                    const isOpen = open === p.id;
                    const myRows = rowsFor(p);
                    const bucket = p.catalogueBucket;
                    const models = bucket ? (catalogue[bucket] || []) : [];
                    const unpriced = models.filter(m => !myRows.some(r => r.model === m));
                    const freeRows = myRows.filter(isFree);
                    const edited =
                        (p.configKey && dirtyKeys.includes(p.configKey)) ||
                        (bucket && dirtyBuckets.includes(bucket)) ||
                        myRows.some(r => dirtyRows.some(d => d.id === r.id));

                    return (
                        <div key={p.id} className={`bg-card border rounded-2xl overflow-hidden transition-colors ${
                            edited ? "border-amber-500/40" : "border-border"
                        }`}>
                            {/* Row header — name toggles the dropdown, the key
                                stays reachable without opening anything. */}
                            <div className="flex items-center gap-3 px-3 sm:px-4 py-3">
                                <button onClick={() => setOpen(isOpen ? null : p.id)}
                                    className="flex items-center gap-3 min-w-0 flex-1 text-left group">
                                    <ChevronRight className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${p.keySet ? "bg-emerald-400" : "bg-muted-foreground/40"}`}
                                        title={p.keySet ? "API key installed" : "No API key — this provider's models are hidden from users"} />
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-semibold group-hover:text-primary transition-colors">{p.label}</span>
                                            {p.capabilities.map(c => {
                                                const m = CAP_META[c];
                                                const Icon = m.icon;
                                                return (
                                                    <span key={c} className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${m.cls}`}>
                                                        <Icon className="w-3 h-3" /> {m.label}
                                                    </span>
                                                );
                                            })}
                                            {edited && <span className="text-[10px] font-semibold text-amber-400">● edited</span>}
                                            {(unpriced.length + freeRows.length) > 0 && (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400"
                                                    title="Models with no rate — they charge nothing, or bill at the fallback estimate">
                                                    <AlertTriangle className="w-3 h-3" /> {unpriced.length + freeRows.length} unpriced
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                            {bucket ? `${models.length} pickable · ` : ""}{myRows.length} priced
                                        </p>
                                    </div>
                                </button>

                                {p.configKey && (
                                    <InlineKey provider={p}
                                        value={keys[p.configKey] || ""}
                                        onChange={v => setKeys({ ...keys, [p.configKey!]: v })} />
                                )}
                            </div>

                            {isOpen && (
                                <div className="border-t border-border p-4 space-y-5">
                                    {p.keyHint && <p className="text-xs text-amber-400">{p.keyHint}</p>}
                                    <p className="text-xs text-muted-foreground">
                                        {p.blurb}
                                        {p.configKey && <> Key stored in <code className="bg-secondary px-1 rounded">{p.configKey}</code>; workers pick up a change within ~60 s.</>}
                                        {p.keyUpdatedAt && <> Last updated {new Date(p.keyUpdatedAt).toLocaleString()}.</>}
                                    </p>
                                    {!p.keySet && (
                                        <p className="text-xs text-amber-400">
                                            No key — this provider is hidden from the voice pipeline picker and its calls fail, whatever is listed below.
                                        </p>
                                    )}

                                    <ModelTable
                                        provider={p}
                                        rows={myRows}
                                        unpriced={unpriced}
                                        freeRows={freeRows}
                                        catalogueModels={models}
                                        onChange={(id, patch) => setRows(rows.map(r => r.id === id ? { ...r, ...patch } : r))}
                                        onTogglePickable={(model, on) => {
                                            if (!bucket) return;
                                            const next = on
                                                ? [...models, model]
                                                : models.filter(x => x !== model);
                                            setCatalogue({ ...catalogue, [bucket]: next });
                                        }}
                                        onAdd={draft => addModel(p, draft)}
                                        onDelete={async row => {
                                            if (!confirm(`Delete the price row for ${row.provider}/${row.model}?`)) return;
                                            try {
                                                await api.delete(`/admin/ai-pricing/${row.id}`);
                                                await load();
                                            } catch (e: any) { setError(e.response?.data?.message || e.message); }
                                        }}
                                    />

                                    {p.catalogueBucket === "CLAUDE" && <ClaudeSubscriptionPool />}

                                    <VoiceCatalogue provider={p} />
                                </div>
                            )}
                        </div>
                    );
                })}

                {visible.length === 0 && (
                    <div className="bg-card border border-border rounded-2xl px-4 py-12 text-center text-muted-foreground text-sm">
                        No provider matches that search.
                    </div>
                )}
            </div>

            <UnsavedChangesBar
                dirty={dirty}
                saving={saving}
                onSave={saveAll}
                onDiscard={discard}
                label={`Unsaved: ${dirtyLabel}`}
            />
        </div>
    );
}

// ─── Pieces ─────────────────────────────────────────────────────────

function Stat({ icon: Icon, label, value, small }: { icon: any; label: string; value: any; small?: boolean }) {
    return (
        <div className="bg-card border border-border rounded-2xl px-4 py-3">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <Icon className="w-3.5 h-3.5" /> {label}
            </div>
            <div className={`mt-1 font-bold ${small ? "text-sm" : "text-xl"}`}>{value}</div>
        </div>
    );
}

// The key lives in the collapsed row. Pasting a key is the single most
// common reason to visit this page; making it the one thing you had to
// open a panel for was backwards.
function InlineKey({ provider, value, onChange }: {
    provider: Provider; value: string; onChange: (v: string) => void;
}) {
    const [show, setShow] = useState(false);
    return (
        <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <div className="relative">
                <input type={show ? "text" : "password"} value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder={provider.keyPlaceholder}
                    spellCheck={false} autoComplete="off"
                    className="w-40 sm:w-64 bg-secondary/50 border border-border rounded-lg pl-3 pr-8 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
                <button type="button" onClick={() => setShow(s => !s)}
                    title={show ? "Hide" : "Show"}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-foreground">
                    {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
            </div>
            {provider.docsUrl && (
                <a href={provider.docsUrl} target="_blank" rel="noreferrer"
                    title="Get a key from the provider"
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-secondary">
                    <ExternalLink className="w-3.5 h-3.5" />
                </a>
            )}
        </div>
    );
}

// One table: a model and its rate are the same object, so listing them
// apart only invited the two to disagree.
function ModelTable({ provider, rows, unpriced, freeRows, catalogueModels, onChange, onTogglePickable, onAdd, onDelete }: {
    provider: Provider;
    rows: PricingRow[];
    unpriced: string[];
    freeRows: PricingRow[];
    catalogueModels: string[];
    onChange: (id: string, patch: Partial<PricingRow>) => void;
    onTogglePickable: (model: string, on: boolean) => void;
    onAdd: (d: {
        model: string; kind: Kind; inputCostPer1M: number; outputCostPer1M: number;
        cachedCostPer1M: number; unitCostUsd: number; marginMultiplier: number; pickable: boolean;
    }) => void;
    onDelete: (row: PricingRow) => void;
}) {
    const bucket = provider.catalogueBucket;
    const groups: { kind: Kind; rows: PricingRow[] }[] = (["token", "stt_minute", "tts_chars"] as Kind[])
        .map(kind => ({ kind, rows: rows.filter(r => r.kind === kind) }))
        .filter(g => g.rows.length > 0);

    return (
        <div className="space-y-5">
            <h3 className="text-sm font-semibold flex items-center gap-2">
                <Coins className="w-4 h-4 text-primary" /> Models &amp; rates
                {bucket && (
                    <span className="text-xs font-normal text-muted-foreground">
                        — tick “Agents” to let users pick a model when configuring an agent
                    </span>
                )}
            </h3>

            {unpriced.length > 0 && (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl px-3 py-2.5 text-xs">
                    <p className="text-amber-400 font-medium flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> No rate set for: {unpriced.join(", ")}
                    </p>
                    <p className="text-muted-foreground mt-1">
                        Users can pick these, but they bill at the fallback estimate rather than their real price.
                        Add each below with its rate, or untick it from the agent catalogue.
                    </p>
                    {bucket && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {unpriced.map(m => (
                                <button key={m} onClick={() => onTogglePickable(m, false)}
                                    className="inline-flex items-center gap-1 text-[11px] font-mono bg-secondary/50 border border-border rounded px-2 py-0.5 hover:text-red-400">
                                    {m} <Trash2 className="w-3 h-3" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {freeRows.length > 0 && (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl px-3 py-2.5 text-xs">
                    <p className="text-amber-400 font-medium flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> Rate is 0 for: {freeRows.map(r => r.model).join(", ")}
                    </p>
                    <p className="text-muted-foreground mt-1">
                        These are active but charge nothing. Fill the rate in from the provider's pricing page, or
                        untick Active if the model isn't in use.
                    </p>
                </div>
            )}

            {groups.map(g => (
                <div key={g.kind}>
                    <div className="text-xs font-medium text-muted-foreground mb-1.5">
                        Billed {KIND_LABEL[g.kind]} <span className="opacity-60">({g.rows.length})</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-[10px] uppercase text-muted-foreground">
                                <tr>
                                    <th className="text-left font-medium py-1.5 pr-3">Model</th>
                                    {bucket && g.kind === "token" && <th className="text-center font-medium py-1.5 px-2">Agents</th>}
                                    {g.kind === "token" ? (
                                        <>
                                            <th className="text-right font-medium py-1.5 px-2">Input $/1M</th>
                                            <th className="text-right font-medium py-1.5 px-2">Output $/1M</th>
                                            <th className="text-right font-medium py-1.5 px-2">Cached $/1M</th>
                                        </>
                                    ) : (
                                        <th className="text-right font-medium py-1.5 px-2">
                                            $ {g.kind === "stt_minute" ? "per minute" : "per 1M chars"}
                                        </th>
                                    )}
                                    <th className="text-right font-medium py-1.5 px-2">Margin ×</th>
                                    <th className="text-right font-medium py-1.5 px-2">Charged</th>
                                    <th className="text-center font-medium py-1.5 pl-2">Active</th>
                                    <th className="w-8" />
                                </tr>
                            </thead>
                            <tbody>
                                {g.rows.map(r => (
                                    <tr key={r.id} className={`border-t border-border/60 ${isFree(r) ? "bg-amber-500/5" : ""}`}>
                                        <td className="py-1.5 pr-3 font-mono text-xs">
                                            {r.model}
                                            {r.provider.toLowerCase() === "openai-realtime" && (
                                                <span className="ml-1.5 text-[10px] text-violet-400">realtime</span>
                                            )}
                                        </td>
                                        {bucket && g.kind === "token" && (
                                            <td className="py-1.5 px-2 text-center">
                                                <input type="checkbox"
                                                    checked={catalogueModels.includes(r.model)}
                                                    onChange={e => onTogglePickable(r.model, e.target.checked)}
                                                    title="Users can pick this model when configuring an agent"
                                                    className="w-4 h-4 accent-primary" />
                                            </td>
                                        )}
                                        {g.kind === "token" ? (
                                            <>
                                                <Num value={r.inputCostPer1M} onChange={v => onChange(r.id, { inputCostPer1M: v })} />
                                                <Num value={r.outputCostPer1M} onChange={v => onChange(r.id, { outputCostPer1M: v })} />
                                                <Num value={r.cachedCostPer1M} onChange={v => onChange(r.id, { cachedCostPer1M: v })} />
                                            </>
                                        ) : (
                                            <Num step="0.0001" value={r.unitCostUsd} onChange={v => onChange(r.id, { unitCostUsd: v })} />
                                        )}
                                        <Num step="0.1" width="w-16" value={r.marginMultiplier} onChange={v => onChange(r.id, { marginMultiplier: v })} />
                                        <td className="py-1.5 px-2 text-right text-xs font-mono text-primary whitespace-nowrap">
                                            {previewCredits(r)} <span className="text-muted-foreground">cai / {previewUnit(r.kind)}</span>
                                        </td>
                                        <td className="py-1.5 pl-2 text-center">
                                            <input type="checkbox" checked={r.isActive}
                                                onChange={e => onChange(r.id, { isActive: e.target.checked })}
                                                className="w-4 h-4 accent-primary" />
                                        </td>
                                        <td className="py-1.5 text-right">
                                            <button onClick={() => onDelete(r)} title="Delete this model"
                                                className="p-1 rounded text-muted-foreground hover:text-red-400">
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ))}

            {rows.length === 0 && (
                <p className="text-sm text-muted-foreground">No models yet for this provider.</p>
            )}

            <AddModel provider={provider} onAdd={onAdd} />

            <p className="text-[11px] text-muted-foreground">
                Charged = raw cost × margin, converted at 1 cai = $0.0001. These rates drive both agent billing and the
                per-minute price shown on a voice assistant.
            </p>
        </div>
    );
}

// Adding a model demands its rate. An unpriced model doesn't fail
// loudly — it quietly bills at a guessed fallback, which is worse.
function AddModel({ provider, onAdd }: {
    provider: Provider;
    onAdd: (d: {
        model: string; kind: Kind; inputCostPer1M: number; outputCostPer1M: number;
        cachedCostPer1M: number; unitCostUsd: number; marginMultiplier: number; pickable: boolean;
    }) => void;
}) {
    const empty = {
        model: "", kind: "token" as Kind,
        input: "", output: "", cached: "0", unit: "",
        margin: "3", pickable: !!provider.catalogueBucket,
    };
    const [d, setD] = useState(empty);

    const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
    const rateOk = d.kind === "token"
        ? Number.isFinite(num(d.input)) && num(d.input) >= 0 && Number.isFinite(num(d.output)) && num(d.output) > 0
        : Number.isFinite(num(d.unit)) && num(d.unit) > 0;
    const ok = d.model.trim().length > 0 && rateOk && Number.isFinite(num(d.margin)) && num(d.margin) > 0;

    const submit = () => {
        if (!ok) return;
        onAdd({
            model: d.model.trim(),
            kind: d.kind,
            inputCostPer1M: d.kind === "token" ? num(d.input) : 0,
            outputCostPer1M: d.kind === "token" ? num(d.output) : 0,
            cachedCostPer1M: d.kind === "token" ? (Number.isFinite(num(d.cached)) ? num(d.cached) : 0) : 0,
            unitCostUsd: d.kind === "token" ? 0 : num(d.unit),
            marginMultiplier: num(d.margin),
            pickable: d.pickable,
        });
        setD(empty);
    };

    return (
        <div className="bg-secondary/20 border border-border rounded-xl p-3 space-y-2.5">
            <div className="text-xs font-medium flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Add a model to {provider.label}
                <span className="font-normal text-muted-foreground">— its rate is required</span>
            </div>

            <div className="flex flex-wrap items-end gap-2">
                <Field label="Model id" className="flex-1 min-w-[180px]">
                    <input value={d.model} onChange={e => setD({ ...d, model: e.target.value })}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
                        placeholder="claude-opus-4-8"
                        className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </Field>
                <Field label="Bills by">
                    <select value={d.kind} onChange={e => setD({ ...d, kind: e.target.value as Kind })}
                        className="bg-card border border-border rounded-lg px-2 py-1.5 text-xs">
                        {(Object.keys(KIND_LABEL) as Kind[]).map(k => (
                            <option key={k} value={k} className="bg-card">{KIND_LABEL[k]}</option>
                        ))}
                    </select>
                </Field>

                {d.kind === "token" ? (
                    <>
                        <Field label="Input $/1M"><RateInput value={d.input} onChange={v => setD({ ...d, input: v })} /></Field>
                        <Field label="Output $/1M"><RateInput value={d.output} onChange={v => setD({ ...d, output: v })} /></Field>
                        <Field label="Cached $/1M"><RateInput value={d.cached} onChange={v => setD({ ...d, cached: v })} /></Field>
                    </>
                ) : (
                    <Field label={d.kind === "stt_minute" ? "$ per minute" : "$ per 1M chars"}>
                        <RateInput step="0.0001" value={d.unit} onChange={v => setD({ ...d, unit: v })} />
                    </Field>
                )}

                <Field label="Margin ×"><RateInput step="0.1" width="w-16" value={d.margin} onChange={v => setD({ ...d, margin: v })} /></Field>

                {provider.catalogueBucket && d.kind === "token" && (
                    <label className="flex items-center gap-1.5 text-xs pb-1.5 cursor-pointer">
                        <input type="checkbox" checked={d.pickable}
                            onChange={e => setD({ ...d, pickable: e.target.checked })}
                            className="w-4 h-4 accent-primary" />
                        Agents can pick
                    </label>
                )}

                <button onClick={submit} disabled={!ok}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    <Plus className="w-3.5 h-3.5" /> Add
                </button>
            </div>

            {!ok && d.model.trim() && (
                <p className="text-[11px] text-amber-400">
                    {d.kind === "token"
                        ? "Enter the input and output $ per 1M tokens — a model without a rate bills at a guessed fallback."
                        : "Enter this model's unit rate — a model without a rate bills at a guessed fallback."}
                </p>
            )}
        </div>
    );
}

function Field({ label, children, className = "" }: { label: string; children: any; className?: string }) {
    return (
        <div className={className}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
            {children}
        </div>
    );
}

function RateInput({ value, onChange, step = "0.001", width = "w-24" }: {
    value: string; onChange: (v: string) => void; step?: string; width?: string;
}) {
    return (
        <input type="number" step={step} value={value} onChange={e => onChange(e.target.value)}
            className={`${width} bg-secondary/50 border border-border rounded-lg px-2 py-1.5 text-xs text-right font-mono focus:outline-none focus:ring-2 focus:ring-primary/40`} />
    );
}

// The voice pipeline's entries are defined in code, not here — showing
// them keeps "what this provider offers" honest, and their rates are
// the rows above.
function VoiceCatalogue({ provider }: { provider: Provider }) {
    const v = provider.voice;
    const items: { title: string; icon: any; list: { id: string; label: string; note: string }[] }[] = [
        { title: "Transcribers", icon: Mic, list: v.transcribers.map(t => ({ id: t.model, label: t.label, note: `$${t.costPerMin}/min` })) },
        {
            title: "Voice LLMs", icon: AudioLines, list: v.llms.map(l => ({
                id: l.model, label: l.label,
                note: `$${l.inCostPer1M} in / $${l.outCostPer1M} out${l.combinesSttTts ? " · speech-to-speech" : ""}`,
            })),
        },
        { title: "TTS voices", icon: Volume2, list: v.voices.map(x => ({ id: x.voiceId, label: x.label, note: `$${x.costPer1MChars}/1M chars` })) },
        { title: "TTS models", icon: Volume2, list: v.voiceModels.map(x => ({ id: x.id, label: x.label, note: x.costPer1MChars ? `$${x.costPer1MChars}/1M chars` : "" })) },
    ].filter(s => s.list.length > 0);

    if (items.length === 0) return null;

    return (
        <div className="space-y-3 pt-1 border-t border-border/60">
            <h3 className="text-sm font-semibold flex items-center gap-2 pt-3">
                <AudioLines className="w-4 h-4 text-violet-400" /> Voice pipeline
                <span className="text-xs font-normal text-muted-foreground">— defined in the voice catalogue; priced in the table above</span>
            </h3>
            {items.map(s => {
                const Icon = s.icon;
                return (
                    <div key={s.title}>
                        <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1.5">
                            <Icon className="w-3.5 h-3.5" /> {s.title} <span className="opacity-60">({s.list.length})</span>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-1.5">
                            {s.list.map(i => (
                                <div key={i.id} className="flex items-center justify-between gap-2 bg-secondary/25 border border-border rounded-lg px-2.5 py-1.5">
                                    <div className="min-w-0">
                                        <div className="text-xs truncate">{i.label}</div>
                                        <div className="text-[10px] font-mono text-muted-foreground truncate">{i.id}</div>
                                    </div>
                                    {i.note && <span className="text-[10px] text-muted-foreground whitespace-nowrap">{i.note}</span>}
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function Num({ value, onChange, step = "0.001", width = "w-24" }: {
    value: number; onChange: (v: number) => void; step?: string; width?: string;
}) {
    return (
        <td className="py-1.5 px-2 text-right">
            <input type="number" step={step} value={value}
                onChange={e => onChange(Number(e.target.value))}
                className={`${width} bg-secondary/30 border border-border rounded px-2 py-1 text-right text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/40`} />
        </td>
    );
}

// A Claude subscription is an alternative to this provider's API key,
// not a separate feature — so it lives inside the provider that owns
// that decision, not on some other screen.
//
// It saves on its own button rather than through the page's unsaved-
// changes bar: tokens are write-only, so folding them into the shared
// dirty check would mean re-sending blank token fields on every
// unrelated save.
type SubToken = { id: string; label: string; tokenSet: boolean; cooldownUntil: number | null };
type TokenDraft = { id?: string; label: string; token: string; tokenSet: boolean; cooldownUntil: number | null };

function ClaudeSubscriptionPool() {
    const [enabled, setEnabled] = useState(false);
    const [model, setModel] = useState("");
    const [drafts, setDrafts] = useState<TokenDraft[]>([]);
    const [busy, setBusy] = useState(false);
    const [saved, setSaved] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const apply = (data: any) => {
        setEnabled(!!data.enabled);
        setModel(data.model || "");
        const list: SubToken[] = data.tokens || [];
        setDrafts(list.map(t => ({
            id: t.id, label: t.label, token: "", tokenSet: t.tokenSet, cooldownUntil: t.cooldownUntil,
        })));
    };

    useEffect(() => {
        api.get("/admin/ai-hub/subscription")
            .then(r => { if (r.data.success) apply(r.data); })
            .catch(() => { /* the pool is optional — the API key path works without it */ });
    }, []);

    const save = async () => {
        setBusy(true); setSaved(false); setErr(null);
        try {
            const r = await api.put("/admin/ai-hub/subscription", {
                enabled,
                model: model || null,
                tokens: drafts.map(d => ({ id: d.id, label: d.label, token: d.token })),
            });
            // Rebuild from the server so a saved token is never left
            // sitting in the DOM.
            if (r.data.success) { apply(r.data); setSaved(true); }
        } catch (e: any) {
            setErr(e.response?.data?.message || e.message);
        } finally { setBusy(false); }
    };

    return (
        <div className="border border-border rounded-xl p-4 space-y-4 bg-secondary/10">
            <div className="flex items-start gap-3">
                <div className="p-2 bg-primary/10 text-primary rounded-lg"><KeyRound className="w-4 h-4" /></div>
                <div className="flex-1">
                    <h3 className="font-semibold text-sm">Subscription pool</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                        Run Claude on subscription tokens instead of the API key above — copilot, WhatsApp agents,
                        Instagram, campaign openers and oversight all use it. Turns served from the pool cost nothing
                        per token and no cai is deducted for them.
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                        A workspace on its own Anthropic key is never diverted here — they are paying their own
                        provider bill. Everyone else uses the pool when it is on, and the API key when it is off
                        or exhausted.
                    </p>
                </div>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}
                    className="rounded border-border" />
                Use the subscription pool instead of the API key
            </label>

            <div className="flex items-start gap-2 text-[11px] text-amber-400 bg-amber-400/5 border border-amber-400/20 rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                <span>
                    A subscription's rate limit is sized for one person's day of work, and the agents answer around
                    the clock. Expect the pool to run out under real traffic — when it does, that token is benched
                    for a while and everything falls back to the API key on its own. Nothing breaks; it just costs
                    money again until the limit resets.
                </span>
            </div>

            <div>
                <label className="text-xs font-medium text-muted-foreground">Model override (optional)</label>
                <input value={model} onChange={e => setModel(e.target.value)}
                    placeholder="leave blank for the subscription's default"
                    className="mt-1 w-full bg-secondary/40 border border-border rounded-lg px-3 py-1.5 text-sm font-mono" />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <h4 className="text-xs font-medium text-muted-foreground">Tokens</h4>
                    <button type="button"
                        onClick={() => setDrafts([...drafts, {
                            label: `Token ${drafts.length + 1}`, token: "", tokenSet: false, cooldownUntil: null,
                        }])}
                        className="text-xs text-primary hover:underline flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Add token
                    </button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                    Run <code className="bg-secondary px-1 rounded">claude setup-token</code> while logged into each
                    Claude subscription and paste the token here. Tokens are stored server-side and never sent back
                    to the browser — leave a field blank to keep the one already saved.
                </p>
                {drafts.length === 0 && (
                    <p className="text-xs text-muted-foreground">No tokens yet — the API key is being used.</p>
                )}
                {drafts.map((d, i) => {
                    const benched = d.cooldownUntil && d.cooldownUntil > Date.now();
                    return (
                        <div key={d.id || `new-${i}`} className="flex items-center gap-2">
                            <input value={d.label}
                                onChange={e => setDrafts(drafts.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                                placeholder="label"
                                className="w-32 shrink-0 bg-secondary/40 border border-border rounded-lg px-2 py-1.5 text-xs" />
                            <input type="password" autoComplete="new-password" spellCheck={false}
                                value={d.token}
                                onChange={e => setDrafts(drafts.map((x, j) => j === i ? { ...x, token: e.target.value } : x))}
                                placeholder={d.tokenSet ? "•••••••• saved" : "sk-ant-oat01-..."}
                                className="flex-1 bg-secondary/40 border border-border rounded-lg px-3 py-1.5 text-xs font-mono" />
                            {benched && (
                                <span className="text-[10px] text-amber-400 shrink-0" title="Skipped until the limit resets">
                                    benched
                                </span>
                            )}
                            <button type="button" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}
                                className="text-muted-foreground hover:text-red-400 shrink-0" title="Remove">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    );
                })}
            </div>

            <div className="flex items-center justify-end gap-3">
                {err && <span className="text-xs text-red-400">{err}</span>}
                {saved && <span className="text-xs text-emerald-400">Saved.</span>}
                <button onClick={save} disabled={busy}
                    className="bg-secondary hover:bg-secondary/80 border border-border font-medium rounded-lg px-4 py-1.5 flex items-center gap-2 text-xs disabled:opacity-60">
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save pool
                </button>
            </div>
        </div>
    );
}

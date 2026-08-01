"use client";

// Admin → AI Providers. One page for what used to be three.
//
// "AI Models", "Platform Keys" and "AI Pricing" were separate screens,
// but they're three facets of one thing: a provider. Splitting them
// meant the answers to "can users pick this?", "can the server call
// it?" and "what do we charge for it?" lived in three places, and a
// half-configured provider looked fine on every one of them. Here each
// provider is a row you open, and the three answers sit side by side —
// so a missing key is visible next to the models it silently disables.
//
// Everything is edited locally and committed by one save (⌘S / the
// floating bar), which fans out to the three endpoints that already
// existed. No autosave: these numbers decide what customers are billed.

import { useEffect, useMemo, useState } from "react";
import {
    Sparkles, Loader2, KeyRound, Coins, Bot, ChevronRight, Plus, Trash2,
    Search, Eye, EyeOff, ExternalLink, RefreshCw, Mic, Volume2, MessageSquare, AudioLines,
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
const usdToCredits = (usd: number) => Math.ceil(usd * 10_000);
const previewCredits = (r: PricingRow) => {
    const usd =
        r.kind === "stt_minute" ? r.unitCostUsd :
        r.kind === "tts_chars" ? (1_000 / 1_000_000) * r.unitCostUsd :
        (1_000 / 1_000_000) * r.outputCostPer1M;
    return usdToCredits(usd * r.marginMultiplier);
};
const previewUnit = (k: Kind) => (k === "stt_minute" ? "min" : k === "tts_chars" ? "1K chars" : "1K out");

type Tab = "key" | "models" | "pricing";

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
    const [tab, setTab] = useState<Record<string, Tab>>({});
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
                // whether one is set (it must never ship secrets around
                // more than it already does).
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
                const entries: Record<string, string> = {};
                // Only send what changed — an empty box means "leave it",
                // not "wipe the key", which is what a blanket PUT of every
                // field would have meant.
                for (const k of dirtyKeys) entries[k] = keys[k].trim();
                await api.put("/admin/config", { entries });
            }
            if (dirtyBuckets.length) {
                await api.put("/admin/ai-models", {
                    models: {
                        OPENAI: catalogue.OPENAI || [],
                        CLAUDE: catalogue.CLAUDE || [],
                        GEMINI: catalogue.GEMINI || [],
                        GLM: catalogue.GLM || [],
                    },
                });
            }
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
                        AI Providers & Pricing
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
                        Every provider in one place — its API key, the models users can pick, and what each model costs.
                        Open a provider to edit all three. Nothing saves until you hit Save (⌘S).
                    </p>
                </div>
                <button
                    onClick={async () => {
                        if (!confirm("Sync every catalog row to the current provider prices? Margins and Active toggles are kept — only raw $ rates are overwritten.")) return;
                        try {
                            const res = await api.post("/admin/ai-pricing/refresh-from-catalog");
                            if (res.data.success) {
                                alert(`Refreshed. Updated ${res.data.updated}, inserted ${res.data.inserted}, unchanged ${res.data.unchanged}.`);
                                load();
                            }
                        } catch (e: any) { alert(e.response?.data?.message || e.message); }
                    }}
                    className="bg-secondary/70 hover:bg-secondary border border-border rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm font-medium transition-all">
                    <RefreshCw className="w-4 h-4" /> Refresh rates from catalog
                </button>
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
                    const active = tab[p.id] || (p.configKey ? "key" : "pricing");
                    const myRows = rowsFor(p);
                    const bucket = p.catalogueBucket;
                    const models = bucket ? (catalogue[bucket] || []) : [];
                    const edited =
                        (p.configKey && dirtyKeys.includes(p.configKey)) ||
                        (bucket && dirtyBuckets.includes(bucket)) ||
                        myRows.some(r => dirtyRows.some(d => d.id === r.id));

                    return (
                        <div key={p.id} className={`bg-card border rounded-2xl overflow-hidden transition-colors ${
                            edited ? "border-amber-500/40" : "border-border"
                        }`}>
                            {/* Row header — the dropdown handle */}
                            <button onClick={() => setOpen(isOpen ? null : p.id)}
                                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-secondary/30 transition-colors">
                                <ChevronRight className={`w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${p.keySet ? "bg-emerald-400" : "bg-muted-foreground/40"}`}
                                    title={p.keySet ? "API key installed" : "No API key — this provider's models are hidden from users"} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-semibold">{p.label}</span>
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
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.blurb}</p>
                                </div>
                                <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground flex-shrink-0">
                                    {bucket && <span>{models.length} pickable</span>}
                                    <span>{myRows.length} priced</span>
                                    <span className={`font-medium ${p.keySet ? "text-emerald-400" : "text-amber-400"}`}>
                                        {p.keySet ? "installed" : "no key"}
                                    </span>
                                </div>
                            </button>

                            {isOpen && (
                                <div className="border-t border-border">
                                    {/* Tabs */}
                                    <div className="flex items-center gap-1 px-4 pt-3">
                                        {([
                                            p.configKey && (["key", "API key"] as const),
                                            ["models", "Models"] as const,
                                            ["pricing", `Pricing (${myRows.length})`] as const,
                                        ].filter(Boolean) as [Tab, string][]).map(([id, label]) => (
                                            <button key={id} onClick={() => setTab({ ...tab, [p.id]: id })}
                                                className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                                                    active === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary/60"
                                                }`}>
                                                {label}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="p-4">
                                        {active === "key" && p.configKey && (
                                            <KeyPanel provider={p}
                                                value={keys[p.configKey] || ""}
                                                onChange={v => setKeys({ ...keys, [p.configKey!]: v })} />
                                        )}

                                        {active === "models" && (
                                            <ModelsPanel provider={p} models={models}
                                                onAdd={m => bucket && setCatalogue({ ...catalogue, [bucket]: [...models, m] })}
                                                onRemove={m => bucket && setCatalogue({ ...catalogue, [bucket]: models.filter(x => x !== m) })} />
                                        )}

                                        {active === "pricing" && (
                                            <PricingPanel rows={myRows} provider={p}
                                                onChange={(id, patch) => setRows(rows.map(r => r.id === id ? { ...r, ...patch } : r))}
                                                onCreate={async draft => {
                                                    try {
                                                        await api.post("/admin/ai-pricing", draft);
                                                        await load();
                                                    } catch (e: any) { setError(e.response?.data?.message || e.message); }
                                                }}
                                                onDelete={async row => {
                                                    if (!confirm(`Delete the price row for ${row.provider}/${row.model}?`)) return;
                                                    try {
                                                        await api.delete(`/admin/ai-pricing/${row.id}`);
                                                        await load();
                                                    } catch (e: any) { setError(e.response?.data?.message || e.message); }
                                                }} />
                                        )}
                                    </div>
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

function KeyPanel({ provider, value, onChange }: { provider: Provider; value: string; onChange: (v: string) => void }) {
    const [show, setShow] = useState(false);
    return (
        <div className="space-y-2 max-w-2xl">
            <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Platform API key</label>
                {provider.docsUrl && (
                    <a href={provider.docsUrl} target="_blank" rel="noreferrer"
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                        Get a key <ExternalLink className="w-3 h-3" />
                    </a>
                )}
            </div>
            <div className="relative">
                <input type={show ? "text" : "password"} value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder={provider.keyPlaceholder}
                    className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 pr-11 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
                <button type="button" onClick={() => setShow(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
            </div>
            {provider.keyHint && <p className="text-xs text-amber-400">{provider.keyHint}</p>}
            <p className="text-xs text-muted-foreground">
                Stored in <code className="bg-secondary px-1 rounded">{provider.configKey}</code>. Workers pick up a new value within ~60 s — no restart.
                {provider.keyUpdatedAt && <> Last updated {new Date(provider.keyUpdatedAt).toLocaleString()}.</>}
            </p>
            {!provider.keySet && (
                <p className="text-xs text-amber-400">
                    Without a key here, this provider is hidden from the voice pipeline picker and its calls fail — even if its models are listed under Models.
                </p>
            )}
        </div>
    );
}

function ModelsPanel({ provider, models, onAdd, onRemove }: {
    provider: Provider; models: string[]; onAdd: (m: string) => void; onRemove: (m: string) => void;
}) {
    const [input, setInput] = useState("");
    const commit = () => {
        const v = input.trim();
        if (!v || models.includes(v)) return;
        onAdd(v);
        setInput("");
    };
    const v = provider.voice;
    const hasVoice = v.transcribers.length + v.llms.length + v.voices.length > 0;

    return (
        <div className="space-y-5">
            {provider.catalogueBucket ? (
                <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-sky-400" /> Agent models
                        <span className="text-xs font-normal text-muted-foreground">— what users can pick for a text agent</span>
                    </h3>
                    {models.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic mt-2">
                            No models listed — users can't pick this provider for an agent.
                        </p>
                    ) : (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {models.map(m => (
                                <span key={m} className="inline-flex items-center gap-1.5 text-xs font-mono bg-secondary/40 border border-border rounded-lg pl-2.5 pr-1 py-1">
                                    {m}
                                    <button onClick={() => onRemove(m)} title={`Remove ${m}`}
                                        className="text-muted-foreground hover:text-red-400 transition-colors p-0.5 rounded">
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                    <div className="flex gap-2 mt-3 max-w-lg">
                        <input value={input} onChange={e => setInput(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
                            placeholder="model id, e.g. claude-opus-4-8"
                            className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
                        <button onClick={commit} disabled={!input.trim()}
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-secondary/60 border border-border hover:bg-secondary disabled:opacity-50">
                            <Plus className="w-3.5 h-3.5" /> Add
                        </button>
                    </div>
                </div>
            ) : (
                <p className="text-sm text-muted-foreground">
                    This provider only serves the voice pipeline — it has no text agent models.
                </p>
            )}

            {hasVoice && (
                <div className="space-y-3 pt-1">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                        <AudioLines className="w-4 h-4 text-violet-400" /> Voice pipeline
                        <span className="text-xs font-normal text-muted-foreground">
                            — defined in the voice catalogue; edit rates under Pricing
                        </span>
                    </h3>
                    <VoiceList title="Transcribers" icon={Mic}
                        items={v.transcribers.map(t => ({ id: t.model, label: t.label, note: `$${t.costPerMin}/min` }))} />
                    <VoiceList title="Voice LLMs" icon={AudioLines}
                        items={v.llms.map(l => ({
                            id: l.model, label: l.label,
                            note: `$${l.inCostPer1M} in / $${l.outCostPer1M} out per 1M${l.combinesSttTts ? " · speech-to-speech" : ""}`,
                        }))} />
                    <VoiceList title="TTS voices" icon={Volume2}
                        items={v.voices.map(x => ({ id: x.voiceId, label: x.label, note: `$${x.costPer1MChars}/1M chars` }))} />
                    <VoiceList title="TTS models" icon={Volume2}
                        items={v.voiceModels.map(x => ({ id: x.id, label: x.label, note: x.costPer1MChars ? `$${x.costPer1MChars}/1M chars` : "" }))} />
                </div>
            )}
        </div>
    );
}

function VoiceList({ title, icon: Icon, items }: {
    title: string; icon: any; items: { id: string; label: string; note: string }[];
}) {
    if (items.length === 0) return null;
    return (
        <div>
            <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-1.5">
                <Icon className="w-3.5 h-3.5" /> {title} <span className="opacity-60">({items.length})</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-1.5">
                {items.map(i => (
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
}

function PricingPanel({ rows, provider, onChange, onCreate, onDelete }: {
    rows: PricingRow[];
    provider: Provider;
    onChange: (id: string, patch: Partial<PricingRow>) => void;
    onCreate: (draft: { provider: string; model: string; kind: Kind }) => void;
    onDelete: (row: PricingRow) => void;
}) {
    const [newModel, setNewModel] = useState("");
    const [newKind, setNewKind] = useState<Kind>("token");
    const adder = (
        <div className="flex flex-wrap items-center gap-2 pt-1">
            <input value={newModel} onChange={e => setNewModel(e.target.value)}
                placeholder="add a model id…"
                className="flex-1 min-w-[180px] bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
            <select value={newKind} onChange={e => setNewKind(e.target.value as Kind)}
                className="bg-card border border-border rounded-lg px-2 py-1.5 text-xs">
                {(Object.keys(KIND_LABEL) as Kind[]).map(k => (
                    <option key={k} value={k} className="bg-card">Billed {KIND_LABEL[k]}</option>
                ))}
            </select>
            <button disabled={!newModel.trim()}
                onClick={() => { onCreate({ provider: provider.id, model: newModel.trim(), kind: newKind }); setNewModel(""); }}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-secondary/60 border border-border hover:bg-secondary disabled:opacity-50">
                <Plus className="w-3.5 h-3.5" /> Add row
            </button>
        </div>
    );

    if (rows.length === 0) return (
        <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
                No price rows yet. They're seeded from the catalogue on boot — or hit “Refresh rates from catalog” above.
            </p>
            {adder}
        </div>
    );

    // Grouped by how the model bills, because the columns differ.
    const groups: { kind: Kind; rows: PricingRow[] }[] = (["token", "stt_minute", "tts_chars"] as Kind[])
        .map(kind => ({ kind, rows: rows.filter(r => r.kind === kind) }))
        .filter(g => g.rows.length > 0);

    return (
        <div className="space-y-5">
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
                                    <tr key={r.id} className="border-t border-border/60">
                                        <td className="py-1.5 pr-3 font-mono text-xs">
                                            {r.model}
                                            {r.provider.toLowerCase() === "openai-realtime" && (
                                                <span className="ml-1.5 text-[10px] text-violet-400">realtime</span>
                                            )}
                                        </td>
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
                                            <button onClick={() => onDelete(r)} title="Delete this price row"
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
            {adder}
            <p className="text-[11px] text-muted-foreground">
                Charged = raw cost × margin, converted at 1 cai = $0.0001. These rates drive both agent billing and the
                per-minute estimate shown on a voice assistant.
            </p>
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

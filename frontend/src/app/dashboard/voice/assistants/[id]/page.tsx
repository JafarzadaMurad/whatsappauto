"use client";

// Voice Assistant editor — the Vapi-style three-pane pipeline picker
// plus the assistant's personality/prompt/first-message fields.
// Layout mirrors the reference screenshot:
//   1. Model Presets row (4 chips + Customized)
//   2. Cost + Latency bars
//   3. Transcriber · Model · Voice cards (side by side, each editable)
//   4. First Message + System Prompt
//   5. Behaviour (silence/interrupt/background sound)

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
    ArrowLeft, Loader2, Save, Mic, Cpu, Volume2, ChevronDown,
    Zap, Brain, DollarSign, Sparkles, Play, Radio, X, Pencil,
    Plus, Trash2, Music, Ear, Waves, Rabbit, Turtle,
} from "lucide-react";
import api from "@/lib/api";

type Estimate = {
    transcriberUsd: number;
    llmUsd: number;
    ttsUsd: number;
    telephonyUsd: number;
    totalUsd: number;
    latencyMs: number;
};

type Transcriber = { provider: string; model: string; label: string; costPerMin: number; latencyMs: number; accuracy: string; languages?: string[] };
type Llm = { provider: string; model: string; label: string; inCostPer1M: number; outCostPer1M: number; latencyMs: number; intelligence: string; combinesSttTts?: boolean };
type Voice = { provider: string; voiceId: string; label: string; costPer1MChars: number; latencyMs: number; humanness: string; languages?: string[] };
type VoiceModel = { provider: string; id: string; label: string; costPer1MChars?: number; isDefault?: boolean };
type Language = { code: string; label: string; nativeName: string };
type Preset = { key: string; label: string; hint: string; transcriber: string; llm: string; tts: string; estimate: Estimate };

type TranscriberFallback = { provider: string; model: string; language?: string | null };
type VoiceFallback = { provider: string; voiceId: string; voiceModel?: string | null };

type Assistant = {
    id: string;
    name: string;
    isPublished: boolean;
    transcriberProvider: string;
    transcriberModel: string;
    transcriberLanguage: string | null;
    transcriberSmartEndpointing: 'off' | 'vapi' | 'livekit';
    transcriberFallbackAuto: boolean;
    transcriberFallbacks: TranscriberFallback[];
    llmProvider: string; llmModel: string; llmTemperature: number | null; llmMaxTokens: number | null;
    ttsProvider: string; ttsVoiceId: string; ttsVoiceModel: string | null; ttsSpeed: number | null;
    ttsFallbacks: VoiceFallback[];
    systemPrompt: string;
    firstMessage: string | null;
    firstMessageMode: 'assistant-speaks-first' | 'wait-for-user' | 'wait-then-assistant-first';
    endCallMessage: string | null;
    voicemailMessage: string | null;
    endCallPhrases: string[];
    silenceTimeoutSec: number;
    maxDurationSec: number;
    responseDelayMs: number;
    numWordsToInterrupt: number;
    backgroundSound: 'off' | 'office' | 'cafe';
    backgroundDenoise: boolean;
    linkedAgentId: string | null;
    mcpToolNames: string[];
};

type Catalog = {
    transcribers: Transcriber[];
    llms: Llm[];
    voices: Voice[];
    voiceModels: VoiceModel[];
    languages: Language[];
    presets: Preset[];
};

const tierColor = (tier?: string) => {
    if (tier === 'Best' || tier === 'Excellent') return 'text-emerald-400';
    if (tier === 'Great') return 'text-primary';
    return 'text-muted-foreground';
};

export default function VoiceAssistantEditorPage() {
    const params = useParams();
    const router = useRouter();
    const id = params?.id as string;

    const [assistant, setAssistant] = useState<Assistant | null>(null);
    const [catalog, setCatalog] = useState<Catalog | null>(null);
    const [estimate, setEstimate] = useState<Estimate | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savedFlash, setSavedFlash] = useState(false);
    const [openDrawer, setOpenPicker] = useState<null | 'transcriber' | 'llm' | 'tts'>(null);

    const load = useCallback(async () => {
        try {
            const [aRes, cRes] = await Promise.all([
                api.get(`/voice/assistants/${id}`),
                api.get('/voice/catalog'),
            ]);
            if (aRes.data.success) {
                setAssistant(aRes.data.assistant);
                setEstimate(aRes.data.estimate);
            }
            if (cRes.data.success) setCatalog({
                transcribers: cRes.data.transcribers,
                llms: cRes.data.llms,
                voices: cRes.data.voices,
                voiceModels: cRes.data.voiceModels || [],
                languages: cRes.data.languages || [],
                presets: cRes.data.presets,
            });
        } finally { setLoading(false); }
    }, [id]);

    useEffect(() => { load(); }, [load]);

    // Re-estimate on every pipeline change — cheap 30 ms POST, keeps the
    // toolbar chip live as the user browses provider options.
    const debounceRef = useRef<any>(null);
    useEffect(() => {
        if (!assistant) return;
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(async () => {
            try {
                const res = await api.post('/voice/estimate', {
                    transcriber: `${assistant.transcriberProvider}:${assistant.transcriberModel}`,
                    llm: `${assistant.llmProvider}:${assistant.llmModel}`,
                    tts: `${assistant.ttsProvider}:${assistant.ttsVoiceId}`,
                });
                if (res.data.success) setEstimate(res.data.estimate);
            } catch { /* silent */ }
        }, 200);
    }, [
        assistant?.transcriberProvider, assistant?.transcriberModel,
        assistant?.llmProvider, assistant?.llmModel,
        assistant?.ttsProvider, assistant?.ttsVoiceId,
        assistant,
    ]);

    // Which preset (if any) exactly matches the current picks — same
    // check Vapi uses to highlight one chip. Falls through to
    // "Customized" when no preset is a full match.
    const activePreset = useMemo(() => {
        if (!assistant || !catalog) return 'customized';
        const key = `${assistant.transcriberProvider}:${assistant.transcriberModel}|${assistant.llmProvider}:${assistant.llmModel}|${assistant.ttsProvider}:${assistant.ttsVoiceId}`;
        for (const p of catalog.presets) {
            const pk = `${p.transcriber}|${p.llm}|${p.tts}`;
            if (pk === key) return p.key;
        }
        return 'customized';
    }, [assistant, catalog]);

    const applyPreset = (p: Preset) => {
        if (!assistant) return;
        const [tProv, tModel] = p.transcriber.split(':');
        const [lProv, lModel] = p.llm.split(':');
        const [vProv, vId] = p.tts.split(':');
        setAssistant({
            ...assistant,
            transcriberProvider: tProv, transcriberModel: tModel,
            llmProvider: lProv, llmModel: lModel,
            ttsProvider: vProv, ttsVoiceId: vId,
        });
    };

    const save = async () => {
        if (!assistant) return;
        setSaving(true);
        setSavedFlash(false);
        try {
            const { id: _id, ...payload } = assistant;
            const res = await api.put(`/voice/assistants/${id}`, payload);
            if (res.data.success) {
                setAssistant(res.data.assistant);
                setSavedFlash(true);
                setTimeout(() => setSavedFlash(false), 1500);
            }
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        } finally { setSaving(false); }
    };

    if (loading || !assistant || !catalog || !estimate) {
        return <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
    }

    const currentTranscriber = catalog.transcribers.find(t => t.provider === assistant.transcriberProvider && t.model === assistant.transcriberModel);
    const currentLlm = catalog.llms.find(l => l.provider === assistant.llmProvider && l.model === assistant.llmModel);
    const currentVoice = catalog.voices.find(v => v.provider === assistant.ttsProvider && v.voiceId === assistant.ttsVoiceId);

    return (
        <div className="max-w-6xl mx-auto space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Link href="/dashboard/voice/assistants"
                        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                        <ArrowLeft className="w-4 h-4" />
                    </Link>
                    <input value={assistant.name}
                        onChange={e => setAssistant({ ...assistant, name: e.target.value })}
                        className="text-xl font-bold bg-transparent focus:outline-none focus:bg-secondary/30 px-2 py-1 rounded-lg flex-1 min-w-0" />
                    <span className="text-[11px] font-mono text-muted-foreground">{id.slice(0, 8)}...{id.slice(-4)}</span>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setAssistant({ ...assistant, isPublished: !assistant.isPublished })}
                        className={`px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${
                            assistant.isPublished
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                : 'bg-secondary/50 border-border text-muted-foreground'
                        }`}>
                        {assistant.isPublished ? '● Published' : '○ Draft'}
                    </button>
                    <button onClick={save} disabled={saving}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-5 py-2 flex items-center gap-2 text-sm disabled:opacity-60">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {savedFlash ? 'Saved' : 'Save'}
                    </button>
                </div>
            </div>

            {/* Model Presets */}
            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                        <h2 className="font-semibold">Model Presets</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Each preset is a ready-made transcriber + model + voice combination. Pick one as a starting point, or customize any component below.
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {catalog.presets.map(p => (
                        <button key={p.key} onClick={() => applyPreset(p)}
                            title={p.hint}
                            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                                activePreset === p.key
                                    ? 'border-primary bg-primary/10 text-primary'
                                    : 'border-border text-muted-foreground hover:text-foreground hover:border-border/80'
                            }`}>
                            {p.label}
                        </button>
                    ))}
                    <button disabled
                        className={`px-4 py-2 rounded-xl text-sm font-medium border ${
                            activePreset === 'customized'
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border/50 text-muted-foreground/50'
                        }`}>
                        Customized
                    </button>
                </div>

                {/* Cost + Latency bars */}
                <div className="grid grid-cols-2 gap-4 pt-2">
                    <div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span className="flex items-center gap-1.5"><DollarSign className="w-3 h-3" /> Cost</span>
                        </div>
                        <div className="mt-1 flex items-baseline gap-2">
                            <span className="text-2xl font-bold text-primary">~${estimate.totalUsd.toFixed(2)}</span>
                            <span className="text-xs text-muted-foreground">/min</span>
                        </div>
                        <div className="mt-1.5 h-2 bg-secondary/60 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500 rounded-full"
                                style={{ width: `${Math.min(100, (estimate.totalUsd / 0.5) * 100)}%` }} />
                        </div>
                    </div>
                    <div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span className="flex items-center gap-1.5"><Zap className="w-3 h-3" /> Latency</span>
                        </div>
                        <div className="mt-1 flex items-baseline gap-2">
                            <span className="text-2xl font-bold text-primary">~{estimate.latencyMs}</span>
                            <span className="text-xs text-muted-foreground">ms end-to-end</span>
                        </div>
                        <div className="mt-1.5 h-2 bg-secondary/60 rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full"
                                style={{ width: `${Math.min(100, (estimate.latencyMs / 2000) * 100)}%` }} />
                        </div>
                    </div>
                </div>

                {/* Component cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                    {/* Transcriber */}
                    <ComponentCard
                        icon={Mic}
                        label="Transcriber"
                        color="emerald"
                        title={currentTranscriber?.label || `${assistant.transcriberProvider}/${assistant.transcriberModel}`}
                        subtitle={`${currentTranscriber?.provider || assistant.transcriberProvider}${assistant.transcriberLanguage ? ` · ${assistant.transcriberLanguage.toUpperCase()}` : ''}`}
                        onClick={() => setOpenPicker('transcriber')}
                        metrics={[
                            { label: 'Latency', value: `${currentTranscriber?.latencyMs ?? '?'}ms` },
                            { label: 'Cost', value: `$${(currentTranscriber?.costPerMin ?? 0).toFixed(4)}/min` },
                            { label: 'Accuracy', value: currentTranscriber?.accuracy || '—', color: tierColor(currentTranscriber?.accuracy) },
                        ]}
                    />
                    {/* LLM */}
                    <ComponentCard
                        icon={Cpu}
                        label="Model"
                        color="primary"
                        title={currentLlm?.label || `${assistant.llmProvider}/${assistant.llmModel}`}
                        subtitle={currentLlm?.provider || assistant.llmProvider}
                        onClick={() => setOpenPicker('llm')}
                        metrics={[
                            { label: 'Latency', value: `${currentLlm?.latencyMs ?? '?'}ms` },
                            { label: 'Cost', value: `$${((currentLlm?.inCostPer1M ?? 0) / 1000).toFixed(4)}/1K in` },
                            { label: 'Intelligence', value: currentLlm?.intelligence || '—', color: tierColor(currentLlm?.intelligence) },
                        ]}
                    />
                    {/* Voice */}
                    <ComponentCard
                        icon={Volume2}
                        label="Voice"
                        color="pink"
                        title={currentVoice?.label || `${assistant.ttsProvider}/${assistant.ttsVoiceId}`}
                        subtitle={currentVoice?.provider || assistant.ttsProvider}
                        onClick={() => setOpenPicker('tts')}
                        metrics={[
                            { label: 'Latency', value: `${currentVoice?.latencyMs ?? '?'}ms` },
                            { label: 'Cost', value: `$${((currentVoice?.costPer1MChars ?? 0) / 1000).toFixed(4)}/1K ch` },
                            { label: 'Humanness', value: currentVoice?.humanness || '—', color: tierColor(currentVoice?.humanness) },
                        ]}
                    />
                </div>
            </div>

            {/* First Message + System Prompt */}
            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                <div>
                    <label className="text-sm font-semibold flex items-center gap-2">
                        First Message
                    </label>
                    <div className="mt-2 flex flex-col sm:flex-row gap-2">
                        <select value={assistant.firstMessageMode}
                            onChange={e => setAssistant({ ...assistant, firstMessageMode: e.target.value as any })}
                            className="bg-card border border-border rounded-xl px-3 py-2 text-sm">
                            <option value="assistant-speaks-first" className="bg-card">Assistant speaks first</option>
                            <option value="wait-for-user" className="bg-card">Wait for user</option>
                            <option value="wait-then-assistant-first" className="bg-card">Wait, then assistant speaks</option>
                        </select>
                    </div>
                    <textarea value={assistant.firstMessage || ''}
                        onChange={e => setAssistant({ ...assistant, firstMessage: e.target.value })}
                        rows={2}
                        placeholder="Hello! How can I help you today?"
                        disabled={assistant.firstMessageMode === 'wait-for-user'}
                        className="mt-2 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none disabled:opacity-50" />
                </div>

                <div>
                    <label className="text-sm font-semibold flex items-center gap-2">
                        System Prompt
                        <Sparkles className="w-3.5 h-3.5 text-primary" />
                    </label>
                    <p className="text-xs text-muted-foreground mt-1">
                        Defines the assistant's personality, rules, and behaviour during calls. Speak in short sentences — TTS reads every word aloud.
                    </p>
                    <textarea value={assistant.systemPrompt}
                        onChange={e => setAssistant({ ...assistant, systemPrompt: e.target.value })}
                        rows={12}
                        placeholder="You are a friendly receptionist at ...&#10;Speak in short, natural sentences.&#10;When the caller says goodbye, end the call."
                        className="mt-2 w-full bg-secondary/30 border border-border rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y" />
                </div>
            </div>

            {/* Call behaviour — component-specific knobs (temperature,
                max tokens, speed, background sound, endpointing) live
                in their respective settings drawers now. This card
                keeps only the call-level timing + terminal messages. */}
            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                <h3 className="font-semibold">Call behaviour</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <NumberField label="Silence timeout (sec)" value={assistant.silenceTimeoutSec}
                        onChange={v => setAssistant({ ...assistant, silenceTimeoutSec: v })} min={5} max={300}
                        hint="End the call after this many seconds of silence." />
                    <NumberField label="Max duration (sec)" value={assistant.maxDurationSec}
                        onChange={v => setAssistant({ ...assistant, maxDurationSec: v })} min={30} max={3600}
                        hint="Hard cap on any single call." />
                    <NumberField label="Response delay (ms)" value={assistant.responseDelayMs}
                        onChange={v => setAssistant({ ...assistant, responseDelayMs: v })} min={0} max={3000}
                        hint="Wait this long after the caller finishes before replying." />
                    <NumberField label="Words to interrupt" value={assistant.numWordsToInterrupt}
                        onChange={v => setAssistant({ ...assistant, numWordsToInterrupt: v })} min={0} max={20}
                        hint="How many words the caller must say to cut off the assistant mid-sentence." />
                </div>
                <div>
                    <label className="text-xs text-muted-foreground">Voicemail message</label>
                    <textarea value={assistant.voicemailMessage || ''}
                        onChange={e => setAssistant({ ...assistant, voicemailMessage: e.target.value })}
                        rows={2}
                        placeholder="Hi, this is [company]. Please leave a message after the beep."
                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm resize-none" />
                </div>
                <div>
                    <label className="text-xs text-muted-foreground">End-call message</label>
                    <input value={assistant.endCallMessage || ''}
                        onChange={e => setAssistant({ ...assistant, endCallMessage: e.target.value })}
                        placeholder="Goodbye — have a great day!"
                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
            </div>

            {/* Right-side settings drawer — opened from a component card
                edit-icon click. Contains the granular per-component
                fields (Vapi-style). */}
            {openDrawer && (
                <SettingsDrawer
                    kind={openDrawer}
                    catalog={catalog}
                    assistant={assistant}
                    onPatch={(patch) => setAssistant({ ...assistant, ...patch })}
                    onClose={() => setOpenDrawer(null)}
                />
            )}
        </div>
    );
}

// ─── Sub-components ────────────────────────────────────────────────

function ComponentCard({
    icon: Icon, label, color, title, subtitle, metrics, onClick,
}: {
    icon: any; label: string; color: 'emerald' | 'primary' | 'pink';
    title: string; subtitle: string;
    metrics: { label: string; value: string; color?: string }[];
    onClick: () => void;
}) {
    const dotColor = color === 'emerald' ? 'bg-emerald-400' : color === 'pink' ? 'bg-pink-400' : 'bg-primary';
    return (
        <div className="text-left bg-secondary/20 border border-border rounded-xl p-3 hover:border-primary/40 hover:bg-secondary/30 transition-all group relative">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                    <Icon className="w-3 h-3" />
                    {label}
                </div>
                {/* Edit-pencil opens the settings drawer for this component,
                    mirroring Vapi's ✎ icon on each pipeline card. */}
                <button onClick={onClick}
                    title="Edit settings"
                    className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                    <Pencil className="w-3 h-3" />
                </button>
            </div>
            <button onClick={onClick} className="w-full text-left mt-2">
                <div className="font-semibold text-sm truncate">{title}</div>
                <div className="text-[10px] text-muted-foreground truncate">{subtitle}</div>
                <div className="mt-3 grid grid-cols-3 gap-1">
                    {metrics.map((m, i) => (
                        <div key={i}>
                            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{m.label}</div>
                            <div className={`text-[11px] font-mono ${m.color || 'text-foreground'}`}>{m.value}</div>
                        </div>
                    ))}
                </div>
            </button>
        </div>
    );
}

function NumberField({ label, value, onChange, min, max, hint }: {
    label: string; value: number; onChange: (v: number) => void;
    min?: number; max?: number; hint?: string;
}) {
    return (
        <div>
            <label className="text-xs text-muted-foreground">{label}</label>
            <input type="number" value={value} min={min} max={max}
                onChange={e => onChange(Number(e.target.value))}
                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm" />
            {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
        </div>
    );
}

// ─── SettingsDrawer — right-side slide-in ──────────────────────────
// Vapi opens a full settings panel on each component's ✎ icon (see
// screenshots the user referenced). Same shape here: provider dropdown
// on top, model dropdown, then component-specific knobs (language +
// endpointing + fallbacks for transcriber, temperature + max tokens
// for LLM, voice-model + speed + background sound + fallbacks for TTS).

function SettingsDrawer({ kind, catalog, assistant, onPatch, onClose }: {
    kind: 'transcriber' | 'llm' | 'tts';
    catalog: Catalog;
    assistant: Assistant;
    onPatch: (patch: Partial<Assistant>) => void;
    onClose: () => void;
}) {
    const title =
        kind === 'transcriber' ? 'Transcriber Settings' :
        kind === 'llm' ? 'Model Settings' :
        'Voice Settings';
    const description =
        kind === 'transcriber' ? 'Configure the speech-to-text transcriber that converts caller speech into text for the LLM.' :
        kind === 'llm' ? "Configure the LLM that powers your assistant's intelligence, reasoning, and conversation abilities." :
        'Configure the text-to-speech voice your assistant uses to speak.';

    return (
        <div className="fixed inset-0 z-50 flex" onClick={onClose}>
            <div className="flex-1 bg-black/60 backdrop-blur-sm" />
            <div className="w-full max-w-md h-full bg-card border-l border-border overflow-y-auto animate-in slide-in-from-right duration-200"
                onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between z-10">
                    <h3 className="font-semibold flex items-center gap-2">
                        {kind === 'transcriber' && <Mic className="w-4 h-4 text-emerald-400" />}
                        {kind === 'llm' && <Cpu className="w-4 h-4 text-primary" />}
                        {kind === 'tts' && <Volume2 className="w-4 h-4 text-pink-400" />}
                        {title}
                    </h3>
                    <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="p-4 space-y-5">
                    <p className="text-xs text-muted-foreground">{description}</p>
                    {kind === 'transcriber' && <TranscriberSettings catalog={catalog} assistant={assistant} onPatch={onPatch} />}
                    {kind === 'llm' && <ModelSettings catalog={catalog} assistant={assistant} onPatch={onPatch} />}
                    {kind === 'tts' && <VoiceSettings catalog={catalog} assistant={assistant} onPatch={onPatch} />}
                </div>
            </div>
        </div>
    );
}

// ─── Transcriber panel ─────────────────────────────────────────────

function TranscriberSettings({ catalog, assistant, onPatch }: {
    catalog: Catalog; assistant: Assistant; onPatch: (p: Partial<Assistant>) => void;
}) {
    const providers = Array.from(new Set(catalog.transcribers.map(t => t.provider)));
    const modelsForProvider = catalog.transcribers.filter(t => t.provider === assistant.transcriberProvider);
    const current = catalog.transcribers.find(t => t.provider === assistant.transcriberProvider && t.model === assistant.transcriberModel);

    return (
        <div className="space-y-5">
            <div>
                <label className="text-xs font-medium text-muted-foreground">Provider</label>
                <select value={assistant.transcriberProvider}
                    onChange={e => {
                        const p = e.target.value;
                        const first = catalog.transcribers.find(t => t.provider === p);
                        onPatch({ transcriberProvider: p, transcriberModel: first?.model || assistant.transcriberModel });
                    }}
                    className="mt-1 w-full bg-card border border-border rounded-xl px-3 py-2 text-sm">
                    {providers.map(p => <option key={p} value={p} className="bg-card">{p}</option>)}
                </select>
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground">Model</label>
                <select value={assistant.transcriberModel}
                    onChange={e => onPatch({ transcriberModel: e.target.value })}
                    className="mt-1 w-full bg-card border border-border rounded-xl px-3 py-2 text-sm font-mono">
                    {modelsForProvider.map(t => (
                        <option key={t.model} value={t.model} className="bg-card">
                            {t.label} · {t.latencyMs}ms · ${t.costPerMin.toFixed(4)}/min · {t.accuracy}
                        </option>
                    ))}
                </select>
                {current && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                        {current.label} · ~{current.latencyMs}ms · ${current.costPerMin.toFixed(4)}/min
                    </p>
                )}
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                    Language
                </label>
                <p className="text-[10px] text-muted-foreground mt-0.5">Leave empty to auto-detect the spoken language.</p>
                <select value={assistant.transcriberLanguage || ''}
                    onChange={e => onPatch({ transcriberLanguage: e.target.value || null })}
                    className="mt-1 w-full bg-card border border-border rounded-xl px-3 py-2 text-sm">
                    <option value="" className="bg-card">Auto-detect</option>
                    {catalog.languages.map(l => (
                        <option key={l.code} value={l.code} className="bg-card">{l.label} · {l.nativeName}</option>
                    ))}
                </select>
            </div>
            <ToggleRow icon={Ear} label="Background Denoising" hint="Filter background noise while the user is talking."
                value={assistant.backgroundDenoise}
                onChange={v => onPatch({ backgroundDenoise: v })} />
            <div>
                <div className="flex items-center gap-2 mb-1.5">
                    <Waves className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Smart Endpointing</span>
                </div>
                <p className="text-[10px] text-muted-foreground mb-2">Enable for more accurate speech endpoint detection.</p>
                <div className="grid grid-cols-3 gap-1 bg-secondary/40 rounded-xl p-1">
                    {(['off', 'vapi', 'livekit'] as const).map(mode => (
                        <button key={mode}
                            onClick={() => onPatch({ transcriberSmartEndpointing: mode })}
                            className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                                assistant.transcriberSmartEndpointing === mode
                                    ? 'bg-primary/15 text-primary'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}>
                            {mode === 'off' ? 'Off' : mode === 'vapi' ? 'Built-in' : 'LiveKit'}
                        </button>
                    ))}
                </div>
            </div>
            <FallbackList
                title="Transcriber Fallback"
                hint="Protect your calls from STT failures. Manual fallbacks are tried in order; the auto backup only kicks in if all of them fail."
                autoLabel="Let the runtime pick a backup STT provider automatically"
                autoOn={assistant.transcriberFallbackAuto}
                onAutoChange={v => onPatch({ transcriberFallbackAuto: v })}
                fallbacks={assistant.transcriberFallbacks.map(f => `${f.provider}/${f.model}`)}
                onAdd={() => {
                    const first = catalog.transcribers.find(t => t.provider !== assistant.transcriberProvider);
                    if (!first) return;
                    onPatch({ transcriberFallbacks: [...assistant.transcriberFallbacks, { provider: first.provider, model: first.model }] });
                }}
                onRemove={i => onPatch({ transcriberFallbacks: assistant.transcriberFallbacks.filter((_, idx) => idx !== i) })} />
        </div>
    );
}

// ─── Model panel ───────────────────────────────────────────────────

function ModelSettings({ catalog, assistant, onPatch }: {
    catalog: Catalog; assistant: Assistant; onPatch: (p: Partial<Assistant>) => void;
}) {
    const providers = Array.from(new Set(catalog.llms.map(l => l.provider)));
    const modelsForProvider = catalog.llms.filter(l => l.provider === assistant.llmProvider);
    const current = catalog.llms.find(l => l.provider === assistant.llmProvider && l.model === assistant.llmModel);

    return (
        <div className="space-y-5">
            <div>
                <label className="text-xs font-medium text-muted-foreground">Provider</label>
                <select value={assistant.llmProvider}
                    onChange={e => {
                        const p = e.target.value;
                        const first = catalog.llms.find(l => l.provider === p);
                        onPatch({ llmProvider: p, llmModel: first?.model || assistant.llmModel });
                    }}
                    className="mt-1 w-full bg-card border border-border rounded-xl px-3 py-2 text-sm">
                    {providers.map(p => <option key={p} value={p} className="bg-card">{p}</option>)}
                </select>
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground">Model</label>
                <select value={assistant.llmModel}
                    onChange={e => onPatch({ llmModel: e.target.value })}
                    className="mt-1 w-full bg-card border border-border rounded-xl px-3 py-2 text-sm font-mono">
                    {modelsForProvider.map(l => (
                        <option key={l.model} value={l.model} className="bg-card">
                            {l.label} · {l.latencyMs}ms · ${l.inCostPer1M}/M in / ${l.outCostPer1M}/M out{l.combinesSttTts ? ' · speech-to-speech' : ''}
                        </option>
                    ))}
                </select>
                {current && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                        {current.label} · Intelligence: <span className={tierColor(current.intelligence)}>{current.intelligence}</span>
                    </p>
                )}
            </div>
            <div>
                <div className="flex items-center justify-between text-xs">
                    <label className="font-medium text-muted-foreground">Temperature</label>
                    <span className="font-mono">{(assistant.llmTemperature ?? 0.5).toFixed(2)}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">Controls randomness. Lower values are more deterministic; higher values more creative.</p>
                <input type="range" min={0} max={2} step={0.05}
                    value={assistant.llmTemperature ?? 0.5}
                    onChange={e => onPatch({ llmTemperature: Number(e.target.value) })}
                    className="mt-2 w-full accent-primary" />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>Precise</span><span>Creative</span>
                </div>
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground">Max Tokens</label>
                <p className="text-[10px] text-muted-foreground mt-0.5">Max tokens the assistant can generate per turn. Keep replies short so they finish in a natural pause.</p>
                <input type="number" min={1} max={4000} value={assistant.llmMaxTokens || 250}
                    onChange={e => onPatch({ llmMaxTokens: Number(e.target.value) })}
                    className="mt-2 w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm" />
            </div>
        </div>
    );
}

// ─── Voice panel ───────────────────────────────────────────────────

function VoiceSettings({ catalog, assistant, onPatch }: {
    catalog: Catalog; assistant: Assistant; onPatch: (p: Partial<Assistant>) => void;
}) {
    const providers = Array.from(new Set(catalog.voices.map(v => v.provider)));
    const voicesForProvider = catalog.voices.filter(v => v.provider === assistant.ttsProvider);
    const voiceModelsForProvider = catalog.voiceModels.filter(m => m.provider === assistant.ttsProvider);
    const currentVoice = catalog.voices.find(v => v.provider === assistant.ttsProvider && v.voiceId === assistant.ttsVoiceId);

    return (
        <div className="space-y-5">
            <div>
                <label className="text-xs font-medium text-muted-foreground">Provider</label>
                <select value={assistant.ttsProvider}
                    onChange={e => {
                        const p = e.target.value;
                        const firstVoice = catalog.voices.find(v => v.provider === p);
                        const firstModel = catalog.voiceModels.find(m => m.provider === p && m.isDefault);
                        onPatch({
                            ttsProvider: p,
                            ttsVoiceId: firstVoice?.voiceId || assistant.ttsVoiceId,
                            ttsVoiceModel: firstModel?.id || null,
                        });
                    }}
                    className="mt-1 w-full bg-card border border-border rounded-xl px-3 py-2 text-sm">
                    {providers.map(p => <option key={p} value={p} className="bg-card">{p}</option>)}
                </select>
            </div>
            <div>
                <label className="text-xs font-medium text-muted-foreground">Voice</label>
                <select value={assistant.ttsVoiceId}
                    onChange={e => onPatch({ ttsVoiceId: e.target.value })}
                    className="mt-1 w-full bg-card border border-border rounded-xl px-3 py-2 text-sm font-mono">
                    {voicesForProvider.map(v => (
                        <option key={v.voiceId} value={v.voiceId} className="bg-card">{v.label}</option>
                    ))}
                </select>
                {currentVoice && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                        Humanness: <span className={tierColor(currentVoice.humanness)}>{currentVoice.humanness}</span> · ~{currentVoice.latencyMs}ms
                    </p>
                )}
            </div>
            {voiceModelsForProvider.length > 0 && (
                <div>
                    <label className="text-xs font-medium text-muted-foreground">Voice Model</label>
                    <select value={assistant.ttsVoiceModel || ''}
                        onChange={e => onPatch({ ttsVoiceModel: e.target.value || null })}
                        className="mt-1 w-full bg-card border border-border rounded-xl px-3 py-2 text-sm font-mono">
                        {voiceModelsForProvider.map(m => (
                            <option key={m.id} value={m.id} className="bg-card">
                                {m.label}{m.costPer1MChars ? ` · $${m.costPer1MChars}/M chars` : ''}
                            </option>
                        ))}
                    </select>
                </div>
            )}
            <div>
                <div className="flex items-center gap-2 mb-1">
                    <Rabbit className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Speed</span>
                    <span className="ml-auto font-mono text-xs">{(assistant.ttsSpeed ?? 1).toFixed(2)}</span>
                </div>
                <p className="text-[10px] text-muted-foreground mb-2">The speed of the voice output.</p>
                <input type="range" min={0.5} max={2} step={0.05}
                    value={assistant.ttsSpeed ?? 1}
                    onChange={e => onPatch({ ttsSpeed: Number(e.target.value) })}
                    className="w-full accent-primary" />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span className="flex items-center gap-1"><Turtle className="w-3 h-3" /> Slower</span>
                    <span className="flex items-center gap-1">Faster <Rabbit className="w-3 h-3" /></span>
                </div>
            </div>
            <div>
                <div className="flex items-center gap-2 mb-1">
                    <Music className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Background Sound</span>
                </div>
                <p className="text-[10px] text-muted-foreground mb-2">Ambient noise played under the call. Default for phone is 'office'; web calls default to 'off'.</p>
                <div className="grid grid-cols-3 gap-1 bg-secondary/40 rounded-xl p-1">
                    {(['off', 'office', 'cafe'] as const).map(sound => (
                        <button key={sound}
                            onClick={() => onPatch({ backgroundSound: sound })}
                            className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                                assistant.backgroundSound === sound
                                    ? 'bg-primary/15 text-primary'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}>
                            {sound}
                        </button>
                    ))}
                </div>
            </div>
            <FallbackList
                title="Fallback Voices"
                hint="Used when the primary voice model fails. Tried in order."
                autoOn={false}
                onAutoChange={() => {}}
                showAuto={false}
                fallbacks={assistant.ttsFallbacks.map(f => `${f.provider}/${f.voiceId}`)}
                onAdd={() => {
                    const first = catalog.voices.find(v => v.provider !== assistant.ttsProvider);
                    if (!first) return;
                    onPatch({ ttsFallbacks: [...assistant.ttsFallbacks, { provider: first.provider, voiceId: first.voiceId }] });
                }}
                onRemove={i => onPatch({ ttsFallbacks: assistant.ttsFallbacks.filter((_, idx) => idx !== i) })} />
        </div>
    );
}

// ─── Shared little widgets ─────────────────────────────────────────

function ToggleRow({ icon: Icon, label, hint, value, onChange }: {
    icon: any; label: string; hint: string; value: boolean; onChange: (v: boolean) => void;
}) {
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 flex-1">
                <Icon className="w-4 h-4 text-muted-foreground mt-0.5" />
                <div>
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-[10px] text-muted-foreground">{hint}</div>
                </div>
            </div>
            <button onClick={() => onChange(!value)}
                className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                    value ? 'bg-primary' : 'bg-secondary'
                }`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`} />
            </button>
        </div>
    );
}

function FallbackList({
    title, hint, autoLabel, autoOn, onAutoChange, showAuto = true,
    fallbacks, onAdd, onRemove,
}: {
    title: string;
    hint: string;
    autoLabel?: string;
    autoOn: boolean;
    onAutoChange: (v: boolean) => void;
    showAuto?: boolean;
    fallbacks: string[];
    onAdd: () => void;
    onRemove: (i: number) => void;
}) {
    return (
        <div>
            <div className="text-sm font-medium">{title}</div>
            <p className="text-[10px] text-muted-foreground mt-0.5 mb-2">{hint}</p>
            {showAuto && (
                <div className="mb-2">
                    <ToggleRow icon={Zap} label="Auto Fallback" hint={autoLabel || ''}
                        value={autoOn} onChange={onAutoChange} />
                </div>
            )}
            <div className="space-y-1">
                {fallbacks.map((f, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 bg-secondary/30 rounded-lg px-3 py-2 text-xs font-mono">
                        <span className="truncate">{i + 1}. {f}</span>
                        <button onClick={() => onRemove(i)} className="text-muted-foreground hover:text-red-400">
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </div>
                ))}
            </div>
            <button onClick={onAdd}
                className="mt-2 w-full bg-secondary/40 hover:bg-secondary/60 border border-dashed border-border rounded-lg px-3 py-2 text-xs font-medium flex items-center justify-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
                <Plus className="w-3.5 h-3.5" /> Add
            </button>
        </div>
    );
}

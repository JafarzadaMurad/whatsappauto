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
    Zap, Brain, DollarSign, Sparkles, Play, Radio, X,
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
type Preset = { key: string; label: string; hint: string; transcriber: string; llm: string; tts: string; estimate: Estimate };

type Assistant = {
    id: string;
    name: string;
    isPublished: boolean;
    transcriberProvider: string; transcriberModel: string; transcriberLanguage: string | null;
    llmProvider: string; llmModel: string; llmTemperature: number | null; llmMaxTokens: number | null;
    ttsProvider: string; ttsVoiceId: string; ttsSpeed: number | null;
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

type Catalog = { transcribers: Transcriber[]; llms: Llm[]; voices: Voice[]; presets: Preset[] };

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
    const [openPicker, setOpenPicker] = useState<null | 'transcriber' | 'llm' | 'tts'>(null);

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

            {/* Behaviour */}
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs text-muted-foreground">Background sound</label>
                        <select value={assistant.backgroundSound}
                            onChange={e => setAssistant({ ...assistant, backgroundSound: e.target.value as any })}
                            className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm">
                            <option value="off" className="bg-card">Off</option>
                            <option value="office" className="bg-card">Office</option>
                            <option value="cafe" className="bg-card">Cafe</option>
                        </select>
                    </div>
                    <label className="flex items-center gap-2 mt-6 cursor-pointer">
                        <input type="checkbox" checked={assistant.backgroundDenoise}
                            onChange={e => setAssistant({ ...assistant, backgroundDenoise: e.target.checked })}
                            className="w-4 h-4 accent-primary" />
                        <span className="text-sm">Background denoise (Krisp-style)</span>
                    </label>
                </div>
                <div>
                    <NumberField label="LLM max output tokens" value={assistant.llmMaxTokens || 250}
                        onChange={v => setAssistant({ ...assistant, llmMaxTokens: v })} min={1} max={4000}
                        hint="Keeps spoken replies short. 250 ≈ 20-second reply cap." />
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

            {/* Picker modal */}
            {openPicker && (
                <PickerModal
                    kind={openPicker}
                    catalog={catalog}
                    assistant={assistant}
                    onPick={(patch) => { setAssistant({ ...assistant, ...patch }); setOpenPicker(null); }}
                    onClose={() => setOpenPicker(null)}
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
        <button onClick={onClick}
            className="text-left bg-secondary/20 border border-border rounded-xl p-3 hover:border-primary/40 hover:bg-secondary/30 transition-all group">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                    <Icon className="w-3 h-3" />
                    {label}
                </div>
                <ChevronDown className="w-3 h-3 text-muted-foreground group-hover:text-foreground" />
            </div>
            <div className="mt-2 font-semibold text-sm truncate">{title}</div>
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

function PickerModal({ kind, catalog, assistant, onPick, onClose }: {
    kind: 'transcriber' | 'llm' | 'tts';
    catalog: Catalog;
    assistant: Assistant;
    onPick: (patch: Partial<Assistant>) => void;
    onClose: () => void;
}) {
    const title = kind === 'transcriber' ? 'Pick a transcriber' : kind === 'llm' ? 'Pick a model' : 'Pick a voice';
    const [query, setQuery] = useState('');

    const items: any[] =
        kind === 'transcriber' ? catalog.transcribers :
        kind === 'llm' ? catalog.llms :
        catalog.voices;

    const filtered = items.filter(it => {
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        return (it.label + it.provider + (it.model || it.voiceId || '')).toLowerCase().includes(q);
    });

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-border flex items-center justify-between">
                    <h3 className="font-semibold">{title}</h3>
                    <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="p-4 pb-2">
                    <input value={query} onChange={e => setQuery(e.target.value)}
                        placeholder="Search…"
                        className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                </div>
                <div className="flex-1 overflow-y-auto p-4 pt-2 space-y-1">
                    {filtered.map((it, i) => {
                        const active =
                            kind === 'transcriber' ? (assistant.transcriberProvider === it.provider && assistant.transcriberModel === it.model) :
                            kind === 'llm' ? (assistant.llmProvider === it.provider && assistant.llmModel === it.model) :
                            (assistant.ttsProvider === it.provider && assistant.ttsVoiceId === it.voiceId);
                        return (
                            <button key={i}
                                onClick={() => {
                                    if (kind === 'transcriber') onPick({ transcriberProvider: it.provider, transcriberModel: it.model });
                                    else if (kind === 'llm') onPick({ llmProvider: it.provider, llmModel: it.model });
                                    else onPick({ ttsProvider: it.provider, ttsVoiceId: it.voiceId });
                                }}
                                className={`w-full text-left rounded-xl p-3 flex items-start gap-3 transition-colors ${
                                    active ? 'bg-primary/10 border border-primary/40' : 'bg-secondary/20 hover:bg-secondary/40 border border-transparent'
                                }`}>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium truncate">{it.label}</span>
                                        <span className="text-[10px] font-mono text-muted-foreground">{it.provider}/{it.model || it.voiceId}</span>
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                                        {kind === 'transcriber' && (
                                            <>
                                                <span>~{it.latencyMs}ms</span>
                                                <span>${it.costPerMin.toFixed(4)}/min</span>
                                                <span className={tierColor(it.accuracy)}>{it.accuracy}</span>
                                            </>
                                        )}
                                        {kind === 'llm' && (
                                            <>
                                                <span>~{it.latencyMs}ms</span>
                                                <span>${it.inCostPer1M}/M in · ${it.outCostPer1M}/M out</span>
                                                <span className={tierColor(it.intelligence)}>{it.intelligence}</span>
                                                {it.combinesSttTts && <span className="text-primary">speech-to-speech</span>}
                                            </>
                                        )}
                                        {kind === 'tts' && (
                                            <>
                                                <span>~{it.latencyMs}ms</span>
                                                <span>${it.costPer1MChars}/M chars</span>
                                                <span className={tierColor(it.humanness)}>{it.humanness}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                {active && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary flex-shrink-0">Active</span>}
                            </button>
                        );
                    })}
                    {filtered.length === 0 && (
                        <div className="text-center py-8 text-sm text-muted-foreground">No matches.</div>
                    )}
                </div>
            </div>
        </div>
    );
}

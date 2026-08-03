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
    Phone, BookOpen, Wrench, LineChart, Settings2,
    PhoneCall as PhoneCallIcon, MicOff, Voicemail, FileText,
    CheckCircle2, PhoneOutgoing, AlertCircle,
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

type Transcriber = { provider: string; model: string; label: string; costPerMin: number; marginMultiplier?: number; latencyMs: number; accuracy: string; languages?: string[] };
type Llm = { provider: string; model: string; label: string; inCostPer1M: number; outCostPer1M: number; marginMultiplier?: number; latencyMs: number; intelligence: string; combinesSttTts?: boolean };
type Voice = { provider: string; voiceId: string; label: string; costPer1MChars: number; marginMultiplier?: number; latencyMs: number; humanness: string; languages?: string[] };
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
    // Advanced tab knobs
    waitSecondsBeforeStart: number;
    onPunctuationSeconds: number;
    onNoPunctuationSeconds: number;
    onNumberSeconds: number;
    stopVoiceSeconds: number;
    stopBackoffSeconds: number;
    voicemailDetectionEnabled: boolean;
    voicemailDetectionProvider: 'twilio' | 'google' | 'openai';
    recordingEnabled: boolean;
    transcriptLoggingEnabled: boolean;
    loggingEnabled: boolean;
    recordingFormat: 'wav' | 'mp3';
    backgroundSound: 'off' | 'office' | 'cafe';
    backgroundDenoise: boolean;
    linkedAgentId: string | null;
    mcpToolNames: string[];
    // Tools the assistant owns — no text agent involved.
    skills: string[];
    allowedTableIds: string[];
    httpTools: any[];
    skillPrompts: Record<string, string>;
    updatedAt?: string;
};

type Catalog = {
    transcribers: Transcriber[];
    llms: Llm[];
    voices: Voice[];
    voiceModels: VoiceModel[];
    languages: Language[];
    presets: Preset[];
};

// Provider dollars → credits (1 credit = $0.0001). Everything the
// operator sees is priced in credits, since that's the balance they
// hold. Guards against null/NaN so a missing catalogue entry renders
// "0" instead of "$NaN".
// Every price here is what the workspace is CHARGED, not what the
// provider bills us — raw cost times that model's margin, which the
// catalogue endpoint attaches as `marginMultiplier`. Showing raw cost
// made this page quote a number the operator never actually pays, and
// disagree with Admin → Providers & Pricing by exactly the margin.
const cr = (usd: number | null | undefined, margin: number = 1): string => {
    const n = Number(usd) * (Number(margin) > 0 ? Number(margin) : 1);
    if (!Number.isFinite(n) || n <= 0) return '0';
    const credits = n * 10_000;
    // Sub-credit rates would all collapse to 0 — keep two decimals so
    // the difference between models is still visible.
    return credits < 10 ? credits.toFixed(2) : Math.round(credits).toLocaleString();
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
    const [openDrawer, setOpenDrawer] = useState<null | 'transcriber' | 'llm' | 'tts'>(null);
    // Vapi-style tab bar under the assistant title. The old page was
    // essentially just the "assistant" tab; new tabs get progressively
    // richer as we ship them.
    const [tab, setTab] = useState<'assistant' | 'logs' | 'tools' | 'analysis' | 'advanced'>('assistant');
    // Live-test WebRTC widget state — opened by the header's Talk btn.
    const [talkOpen, setTalkOpen] = useState(false);
    const [testCallOpen, setTestCallOpen] = useState(false);

    // Set once by the load flow when it detects the saved
    // provider/model isn't in the filtered catalog anymore — e.g. the
    // plan admin removed access, or a provider's platform key was
    // cleared. Shown as a banner above the pipeline.
    const [migratedNotice, setMigratedNotice] = useState<string[]>([]);

    const load = useCallback(async () => {
        try {
            const [aRes, cRes] = await Promise.all([
                api.get(`/voice/assistants/${id}`),
                api.get('/voice/catalog'),
            ]);
            const cat = cRes.data.success ? {
                transcribers: cRes.data.transcribers,
                llms: cRes.data.llms,
                voices: cRes.data.voices,
                voiceModels: cRes.data.voiceModels || [],
                languages: cRes.data.languages || [],
                presets: cRes.data.presets,
            } : null;

            if (aRes.data.success && cat) {
                // Auto-migrate the saved pipeline off any provider/model
                // that vanished from the catalog (plan restriction change
                // or a platform key got cleared). Without this, the
                // Transcriber / Model / Voice drawer's Model dropdown
                // sits empty and users can't tell why.
                const saved = aRes.data.assistant as Assistant;
                const notices: string[] = [];
                const patched: Assistant = { ...saved };

                const hasTranscriber = cat.transcribers.some((t: any) =>
                    t.provider === saved.transcriberProvider && t.model === saved.transcriberModel);
                if (!hasTranscriber && cat.transcribers[0]) {
                    notices.push(`transcriber ${saved.transcriberProvider}/${saved.transcriberModel} → ${cat.transcribers[0].provider}/${cat.transcribers[0].model}`);
                    patched.transcriberProvider = cat.transcribers[0].provider;
                    patched.transcriberModel = cat.transcribers[0].model;
                }

                const hasLlm = cat.llms.some((l: any) =>
                    l.provider === saved.llmProvider && l.model === saved.llmModel);
                if (!hasLlm && cat.llms[0]) {
                    notices.push(`model ${saved.llmProvider}/${saved.llmModel} → ${cat.llms[0].provider}/${cat.llms[0].model}`);
                    patched.llmProvider = cat.llms[0].provider;
                    patched.llmModel = cat.llms[0].model;
                }

                const hasVoice = cat.voices.some((v: any) =>
                    v.provider === saved.ttsProvider && v.voiceId === saved.ttsVoiceId);
                if (!hasVoice && cat.voices[0]) {
                    notices.push(`voice ${saved.ttsProvider}/${saved.ttsVoiceId} → ${cat.voices[0].provider}/${cat.voices[0].voiceId}`);
                    patched.ttsProvider = cat.voices[0].provider;
                    patched.ttsVoiceId = cat.voices[0].voiceId;
                }

                setAssistant(patched);
                setEstimate(aRes.data.estimate);
                setMigratedNotice(notices);
            } else if (aRes.data.success) {
                setAssistant(aRes.data.assistant);
                setEstimate(aRes.data.estimate);
            }
            if (cat) setCatalog(cat);
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
                    <button onClick={() => setTalkOpen(true)}
                        title="Live test this assistant in your browser (mic required)"
                        className="bg-emerald-500 hover:bg-emerald-500/90 text-white font-medium rounded-xl px-4 py-2 flex items-center gap-2 text-sm">
                        <PhoneCallIcon className="w-4 h-4" /> Talk
                    </button>
                    <button onClick={() => setTestCallOpen(true)}
                        title="Dial a real phone number using this assistant"
                        className="bg-secondary/70 hover:bg-secondary border border-border font-medium rounded-xl px-4 py-2 flex items-center gap-2 text-sm">
                        <PhoneOutgoing className="w-4 h-4" /> Test call
                    </button>
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

            {/* Tab bar — Vapi-shaped Assistant / Logs / Tools / Analysis / Advanced */}
            <div className="border-b border-border flex items-center gap-1 -mt-1">
                {[
                    { key: 'assistant', label: 'Assistant', icon: Sparkles },
                    { key: 'logs', label: 'Logs', icon: BookOpen },
                    { key: 'tools', label: 'Tools', icon: Wrench },
                    { key: 'analysis', label: 'Analysis', icon: LineChart },
                    { key: 'advanced', label: 'Advanced', icon: Settings2 },
                ].map(t => (
                    <button key={t.key} onClick={() => setTab(t.key as any)}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                            tab === t.key
                                ? 'border-primary text-primary'
                                : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}>
                        <t.icon className="w-3.5 h-3.5" />
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Assistant tab — original Model Presets + Component cards + First message + System Prompt + Behaviour */}
            {tab === 'assistant' && <>

            {migratedNotice.length > 0 && (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-2xl px-4 py-3 flex items-start gap-3">
                    <div className="p-1 bg-amber-500/15 text-amber-400 rounded-md mt-0.5 flex-shrink-0">!</div>
                    <div className="flex-1 min-w-0 text-xs">
                        <div className="font-medium text-amber-400/90">Pipeline auto-updated</div>
                        <p className="text-muted-foreground mt-0.5">
                            Some previously-selected voice components are no longer available (plan removed access, or platform key was cleared). We snapped them to the first allowed option — <span className="font-mono">Save</span> to persist:
                        </p>
                        <ul className="text-muted-foreground/90 mt-1 space-y-0.5">
                            {migratedNotice.map((n, i) => (<li key={i} className="font-mono">· {n}</li>))}
                        </ul>
                    </div>
                    <button onClick={() => setMigratedNotice([])}
                        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/50 flex-shrink-0">
                        ×
                    </button>
                </div>
            )}

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
                        {/* Credits, not dollars — that's the unit the
                            workspace holds a balance of and is charged in. */}
                        <div className="mt-1 flex items-baseline gap-2">
                            <span className="text-2xl font-bold text-primary">
                                ~{Math.round((Number(estimate.totalUsd) || 0) * 10_000).toLocaleString()}
                            </span>
                            <span className="text-xs text-muted-foreground">credits/min</span>
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
                        onClick={() => setOpenDrawer('transcriber')}
                        metrics={[
                            { label: 'Latency', value: `${currentTranscriber?.latencyMs ?? '?'}ms` },
                            { label: 'Cost', value: `${cr(currentTranscriber?.costPerMin, currentTranscriber?.marginMultiplier)} cai/min` },
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
                        onClick={() => setOpenDrawer('llm')}
                        metrics={[
                            { label: 'Latency', value: `${currentLlm?.latencyMs ?? '?'}ms` },
                            { label: 'Cost', value: `${cr((currentLlm?.inCostPer1M ?? 0) / 1000, currentLlm?.marginMultiplier)} / ${cr((currentLlm?.outCostPer1M ?? 0) / 1000, currentLlm?.marginMultiplier)} cai per 1K in/out` },
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
                        onClick={() => setOpenDrawer('tts')}
                        metrics={[
                            { label: 'Latency', value: `${currentVoice?.latencyMs ?? '?'}ms` },
                            { label: 'Cost', value: `${cr((currentVoice?.costPer1MChars ?? 0) / 1000, currentVoice?.marginMultiplier)} cai/1K ch` },
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

            </>}
            {/* End of Assistant tab */}

            {tab === 'logs' && <LogsTab assistantId={id} />}
            {tab === 'tools' && <ToolsTab assistant={assistant} patch={p => setAssistant({ ...assistant, ...p })} />}
            {tab === 'analysis' && <AnalysisTab />}
            {tab === 'advanced' && <AdvancedTab assistant={assistant} onPatch={(patch) => setAssistant({ ...assistant, ...patch })} />}

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

            {/* Live Talk widget — browser WebRTC to OpenAI Realtime
                using this assistant's system prompt + voice + model.
                No Twilio, no phone number needed to sanity-check a
                prompt / voice combination. */}
            {talkOpen && <TalkWidget assistantId={id} assistantName={assistant.name} onClose={() => setTalkOpen(false)} />}
            {testCallOpen && <TestCallDialog assistantId={id} assistantName={assistant.name} onClose={() => setTestCallOpen(false)} />}
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
                            {t.label} · {t.latencyMs}ms · {cr(t.costPerMin, t.marginMultiplier)} cai/min · {t.accuracy}
                        </option>
                    ))}
                </select>
                {current && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                        {current.label} · ~{current.latencyMs}ms · {cr(current.costPerMin, current.marginMultiplier)} cai/min
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
                            {l.label} · {l.latencyMs}ms · {cr(l.inCostPer1M / 1000, l.marginMultiplier)}/{cr(l.outCostPer1M / 1000, l.marginMultiplier)} cai per 1K{l.combinesSttTts ? ' · speech-to-speech' : ''}
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
                <p className="text-[10px] text-muted-foreground mt-0.5">
                    Hard ceiling on one spoken reply. Leave empty — a cap doesn't shorten the answer,
                    it cuts the assistant off mid-word when the budget runs out. Ask for brevity in the
                    system prompt instead.
                </p>
                <input type="number" min={1} max={4000}
                    value={assistant.llmMaxTokens ?? ''}
                    placeholder="No limit"
                    onChange={e => onPatch({ llmMaxTokens: e.target.value === '' ? null : Number(e.target.value) })}
                    className="mt-2 w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm" />
                {assistant.llmMaxTokens != null && assistant.llmMaxTokens <= 250 && (
                    <p className="text-[10px] text-amber-400 mt-1">
                        At this value replies get truncated part-way through a sentence. Clear the field
                        unless you specifically need a ceiling.
                    </p>
                )}
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
                                {m.label}{m.costPer1MChars ? ` · ${cr(m.costPer1MChars / 1000)} cai/1K ch` : ''}
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

// ─── Logs tab (Vapi-shaped call log for this assistant) ────────────

type CallRow = {
    id: string;
    fromNumber: string | null;
    toNumber: string | null;
    direction: string;
    status: string;
    endedReason: string | null;
    durationSec: number | null;
    totalCostUsd: number;
    creditsUsed: number;
    startedAt: string;
    phoneNumber?: { number: string } | null;
};

function LogsTab({ assistantId }: { assistantId: string }) {
    const [calls, setCalls] = useState<CallRow[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        (async () => {
            try {
                const res = await api.get(`/voice/calls?assistantId=${encodeURIComponent(assistantId)}`);
                if (res.data.success) setCalls(res.data.calls);
            } finally { setLoading(false); }
        })();
    }, [assistantId]);

    if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
    return (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
            {calls.length === 0 ? (
                <div className="text-center py-16">
                    <BookOpen className="w-10 h-10 text-muted-foreground/40 mx-auto" />
                    <p className="mt-3 font-semibold">No call logs available</p>
                    <p className="text-sm text-muted-foreground mt-1">Calls answered by this assistant will appear here.</p>
                </div>
            ) : (
                <table className="w-full text-sm">
                    <thead className="bg-secondary/50 text-xs uppercase text-muted-foreground">
                        <tr>
                            <th className="px-4 py-3 text-left">Assistant Phone</th>
                            <th className="px-4 py-3 text-left">Customer Phone</th>
                            <th className="px-4 py-3 text-left">Type</th>
                            <th className="px-4 py-3 text-left">Ended Reason</th>
                            <th className="px-4 py-3 text-left">Start Time</th>
                            <th className="px-4 py-3 text-right">Duration</th>
                            <th className="px-4 py-3 text-right">Cost</th>
                        </tr>
                    </thead>
                    <tbody>
                        {calls.map(c => (
                            <tr key={c.id} className="border-t border-border/50 hover:bg-secondary/20">
                                <td className="px-4 py-3 font-mono text-xs">{c.phoneNumber?.number || c.toNumber || '?'}</td>
                                <td className="px-4 py-3 font-mono text-xs">{c.fromNumber || '?'}</td>
                                <td className="px-4 py-3 text-xs">{c.direction}</td>
                                <td className="px-4 py-3 text-xs text-muted-foreground">{c.endedReason || '—'}</td>
                                <td className="px-4 py-3 text-xs">{new Date(c.startedAt).toLocaleString()}</td>
                                <td className="px-4 py-3 text-right font-mono text-xs">
                                    {c.durationSec != null ? `${Math.floor(c.durationSec / 60)}:${String(c.durationSec % 60).padStart(2, '0')}` : '—'}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-xs text-amber-400">{Math.round(Number(c.creditsUsed) || 0).toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

function ToolsTab({ assistant, patch }: {
    assistant: Assistant;
    patch: (p: Partial<Assistant>) => void;
}) {
    const [skills, setSkills] = useState<{ id: string; name: string; desc: string }[]>([]);
    const [tables, setTables] = useState<{ id: string; name: string }[]>([]);
    const [toolNames, setToolNames] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    // The active list is read back from the server, so it reflects what
    // is stored rather than what is merely typed — the whole point of
    // showing it is that it can be trusted.
    useEffect(() => {
        let cancelled = false;
        api.get('/voice/assistants/tool-options', { params: { assistantId: assistant.id } })
            .then(r => {
                if (cancelled || !r.data?.success) return;
                setSkills(r.data.skills || []);
                setTables(r.data.tables || []);
                setToolNames(r.data.toolNames || []);
            })
            .catch(() => { /* the tab still renders without the extras */ })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [assistant.id, assistant.updatedAt]);

    const on = assistant.skills || [];
    const toggle = (id: string) =>
        patch({ skills: on.includes(id) ? on.filter(s => s !== id) : [...on, id] });

    const pickedTables = assistant.allowedTableIds || [];
    const toggleTable = (id: string) =>
        patch({
            allowedTableIds: pickedTables.includes(id)
                ? pickedTables.filter(t => t !== id)
                : [...pickedTables, id],
        });

    const httpTools: any[] = (assistant.httpTools as any[]) || [];

    if (loading) return (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
    );

    return (
        <div className="space-y-4">
            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                <div>
                    <h3 className="font-semibold flex items-center gap-2">
                        <Wrench className="w-4 h-4 text-primary" /> What this assistant can do on a call
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        Tick what it may use while talking to someone. Everything here belongs to the assistant — you
                        do not need a text agent for any of it.
                    </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-2">
                    {skills.map(s => {
                        const active = on.includes(s.id);
                        return (
                            <button key={s.id} onClick={() => toggle(s.id)}
                                className={`text-left rounded-xl border p-3 transition-all ${
                                    active ? 'border-primary/50 bg-primary/5' : 'border-border bg-secondary/20 hover:bg-secondary/40'
                                }`}>
                                <div className="flex items-center gap-2">
                                    <input type="checkbox" readOnly checked={active}
                                        className="w-4 h-4 accent-primary pointer-events-none" />
                                    <span className="font-medium text-sm">{s.name}</span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1 ml-6">{s.desc}</p>
                            </button>
                        );
                    })}
                </div>
            </div>

            {on.includes('tables') && (
                <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
                    <div>
                        <h3 className="font-semibold text-sm">Which tables it may read</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            None ticked means it can read none — pick at least one.
                        </p>
                    </div>
                    {tables.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            No tables in this workspace yet. Create one under AI Workspace &rarr; Data Tables.
                        </p>
                    ) : (
                        <div className="grid sm:grid-cols-2 gap-1.5">
                            {tables.map(t => (
                                <label key={t.id}
                                    className="flex items-center gap-2 bg-secondary/25 border border-border rounded-lg px-2.5 py-1.5 cursor-pointer hover:bg-secondary/40">
                                    <input type="checkbox" checked={pickedTables.includes(t.id)}
                                        onChange={() => toggleTable(t.id)} className="w-4 h-4 accent-primary" />
                                    <span className="text-xs truncate">{t.name}</span>
                                </label>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {on.includes('http') && (
                <HttpToolsEditor tools={httpTools} onChange={next => patch({ httpTools: next } as any)} />
            )}

            <div className="bg-card border border-border rounded-2xl p-5 space-y-2">
                <h3 className="font-semibold text-sm">Active on a call ({toolNames.length})</h3>
                {toolNames.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        Nothing yet. Tick a skill above and save — this list shows what the saved configuration exposes.
                    </p>
                ) : (
                    <div className="flex flex-wrap gap-1.5">
                        {toolNames.map(n => (
                            <span key={n} className="text-[11px] font-mono bg-secondary/40 border border-border rounded px-2 py-0.5">{n}</span>
                        ))}
                    </div>
                )}
                <p className="text-[11px] text-muted-foreground pt-1">
                    Lookups use the number on the call, so someone who has also written to you on WhatsApp resolves to
                    the same record. A tool that takes longer than 8 seconds is abandoned and the assistant is told,
                    rather than leaving the caller in silence.
                </p>
            </div>
        </div>
    );
}

// A phone assistant needs the same custom-endpoint tools an agent has,
// but not the whole form builder. Raw mode carries method, URL, headers
// and body in one block — the shape most people paste out of their own
// API docs anyway. Double braces mark a value the assistant fills in.
function HttpToolsEditor({ tools, onChange }: {
    tools: any[];
    onChange: (next: any[]) => void;
}) {
    const blank = { name: '', description: '', inputMode: 'raw', rawRequest: '', method: 'GET', url: '' };
    const [draft, setDraft] = useState<any>(blank);

    const ok = draft.name.trim() && draft.description.trim() && draft.rawRequest.trim();
    const add = () => {
        if (!ok) return;
        onChange([...tools, { ...draft, name: draft.name.trim(), description: draft.description.trim() }]);
        setDraft(blank);
    };

    return (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
            <div>
                <h3 className="font-semibold text-sm">Your API</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                    Endpoints the assistant may call mid-conversation.
                </p>
            </div>

            {tools.length > 0 && (
                <div className="space-y-1.5">
                    {tools.map((t, i) => (
                        <div key={i} className="flex items-start justify-between gap-3 bg-secondary/25 border border-border rounded-lg px-3 py-2">
                            <div className="min-w-0">
                                <div className="text-xs font-mono">{t.name}</div>
                                <div className="text-[11px] text-muted-foreground truncate">{t.description}</div>
                                {t.rawRequest && (
                                    <div className="text-[10px] font-mono text-muted-foreground/70 truncate mt-0.5">
                                        {String(t.rawRequest).split('\n')[0]}
                                    </div>
                                )}
                            </div>
                            <button onClick={() => onChange(tools.filter((_, j) => j !== i))}
                                className="p-1 rounded text-muted-foreground hover:text-red-400 flex-shrink-0">
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className="space-y-2 border-t border-border pt-3">
                <div className="grid sm:grid-cols-2 gap-2">
                    <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                        placeholder="tool name, e.g. checkOrder"
                        className="bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
                    <input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}
                        placeholder="when should the assistant use it?"
                        className="bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </div>
                <textarea value={draft.rawRequest} onChange={e => setDraft({ ...draft, rawRequest: e.target.value })}
                    rows={5}
                    placeholder={"GET https://api.example.com/orders/{{order number}}\nAuthorization: Bearer xxx"}
                    className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-[11px] text-muted-foreground">
                        First line is method and URL, then headers, then a blank line and the body. Anything in
                        double braces is filled in by the assistant.
                    </p>
                    <button onClick={add} disabled={!ok}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                        <Plus className="w-3.5 h-3.5" /> Add
                    </button>
                </div>
            </div>
        </div>
    );
}

function AnalysisTab() {
    return (
        <div className="bg-card border border-border rounded-2xl p-16 text-center space-y-3">
            <LineChart className="w-10 h-10 text-muted-foreground/40 mx-auto" />
            <p className="font-semibold">Analysis (structured outputs + scorecard)</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Extract structured fields from every call and grade against a rubric. Wiring in the next commit.
            </p>
        </div>
    );
}

// ─── Advanced tab — Speaking Plan / Stop Plan / Timeouts / Voicemail / Recording ─────
function AdvancedTab({ assistant, onPatch }: { assistant: Assistant; onPatch: (p: Partial<Assistant>) => void }) {
    return (
        <div className="space-y-5">
            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                <div>
                    <h3 className="font-semibold">Start Speaking Plan</h3>
                    <p className="text-xs text-muted-foreground mt-1">Plan for when the assistant should start talking.</p>
                </div>
                <SliderRow label="Wait seconds" hint="How long the assistant waits before speaking."
                    value={assistant.waitSecondsBeforeStart} min={0} max={4} step={0.1}
                    onChange={v => onPatch({ waitSecondsBeforeStart: v })} />
                <div>
                    <div className="text-sm font-medium mb-1">Smart Endpointing</div>
                    <p className="text-[10px] text-muted-foreground mb-2">Off · Built-in (Vapi-style) · LiveKit (accurate for English)</p>
                    <div className="grid grid-cols-3 gap-1 bg-secondary/40 rounded-xl p-1">
                        {(['off', 'vapi', 'livekit'] as const).map(mode => (
                            <button key={mode}
                                onClick={() => onPatch({ transcriberSmartEndpointing: mode })}
                                className={`px-2 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                                    assistant.transcriberSmartEndpointing === mode
                                        ? 'bg-primary/15 text-primary'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}>
                                {mode === 'off' ? 'Off' : mode === 'vapi' ? 'Built-in' : 'LiveKit'}
                            </button>
                        ))}
                    </div>
                </div>
                <SliderRow label="On Punctuation Seconds"
                    hint="Minimum seconds to wait after transcription ending with punctuation."
                    value={assistant.onPunctuationSeconds} min={0} max={3} step={0.05}
                    onChange={v => onPatch({ onPunctuationSeconds: v })} />
                <SliderRow label="On No Punctuation Seconds"
                    hint="Minimum seconds to wait after transcription ending without punctuation."
                    value={assistant.onNoPunctuationSeconds} min={0} max={3} step={0.05}
                    onChange={v => onPatch({ onNoPunctuationSeconds: v })} />
                <SliderRow label="On Number Seconds"
                    hint="Minimum seconds to wait after transcription ending with a number."
                    value={assistant.onNumberSeconds} min={0} max={3} step={0.05}
                    onChange={v => onPatch({ onNumberSeconds: v })} />
            </div>

            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                <div>
                    <h3 className="font-semibold">Stop Speaking Plan</h3>
                    <p className="text-xs text-muted-foreground mt-1">Plan for when the assistant should stop talking.</p>
                </div>
                <SliderRow label="Number of Words"
                    hint="How many words the customer must say before the assistant stops mid-sentence."
                    value={assistant.numWordsToInterrupt} min={0} max={10} step={1}
                    onChange={v => onPatch({ numWordsToInterrupt: v })} />
                <SliderRow label="Voice Seconds"
                    hint="Seconds the customer must speak before the assistant stops."
                    value={assistant.stopVoiceSeconds} min={0} max={0.5} step={0.01}
                    onChange={v => onPatch({ stopVoiceSeconds: v })} />
                <SliderRow label="Back Off Seconds"
                    hint="Seconds to wait before the assistant starts talking again after being interrupted."
                    value={assistant.stopBackoffSeconds} min={0} max={10} step={0.1}
                    onChange={v => onPatch({ stopBackoffSeconds: v })} />
            </div>

            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                <div className="flex items-start gap-3">
                    <Voicemail className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div className="flex-1">
                        <div className="flex items-center justify-between">
                            <h3 className="font-semibold">Voicemail Detection</h3>
                            <button onClick={() => onPatch({ voicemailDetectionEnabled: !assistant.voicemailDetectionEnabled })}
                                className={`relative w-9 h-5 rounded-full transition-colors ${assistant.voicemailDetectionEnabled ? 'bg-primary' : 'bg-secondary'}`}>
                                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${assistant.voicemailDetectionEnabled ? 'translate-x-4' : ''}`} />
                            </button>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Detect whether a human or an answering machine picked up.</p>
                    </div>
                </div>
                {assistant.voicemailDetectionEnabled && (
                    <div>
                        <label className="text-xs text-muted-foreground">Provider</label>
                        <select value={assistant.voicemailDetectionProvider}
                            onChange={e => onPatch({ voicemailDetectionProvider: e.target.value as any })}
                            className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm">
                            <option value="twilio" className="bg-card">Twilio AMD (fastest, no extra cost)</option>
                            <option value="google" className="bg-card">Google (better accuracy, extra cost)</option>
                            <option value="openai" className="bg-card">OpenAI (simple prompt-based)</option>
                        </select>
                    </div>
                )}
            </div>

            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                <div>
                    <h3 className="font-semibold">Call Timeout Settings</h3>
                    <p className="text-xs text-muted-foreground mt-1">Configure when the assistant should end a call based on silence or duration.</p>
                </div>
                <SliderRow label="Silence Timeout" hint="Auto-hang-up after this many seconds of silence."
                    value={assistant.silenceTimeoutSec} min={5} max={3600} step={5}
                    onChange={v => onPatch({ silenceTimeoutSec: v })} suffix="sec" />
                <SliderRow label="Maximum Duration" hint="Hard cap on any single call, in seconds."
                    value={assistant.maxDurationSec} min={30} max={43200} step={30}
                    onChange={v => onPatch({ maxDurationSec: v })} suffix="sec" />
            </div>

            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                <div>
                    <h3 className="font-semibold">Recording &amp; Artifacts</h3>
                    <p className="text-xs text-muted-foreground mt-1">Call recording, transcript, and artifact storing.</p>
                </div>
                <ToggleRow2 label="Audio Recording"
                    hint="Record the conversation. Disable to keep this assistant's portion of squad conversations private."
                    value={assistant.recordingEnabled}
                    onChange={v => onPatch({ recordingEnabled: v })} />
                <ToggleRow2 label="Logging"
                    hint="Enable or disable logging during a call."
                    value={assistant.loggingEnabled}
                    onChange={v => onPatch({ loggingEnabled: v })} />
                <ToggleRow2 label="Transcript"
                    hint="Enable or disable transcription during a call."
                    value={assistant.transcriptLoggingEnabled}
                    onChange={v => onPatch({ transcriptLoggingEnabled: v })} />
                <div>
                    <label className="text-xs text-muted-foreground">Audio Recording Format</label>
                    <select value={assistant.recordingFormat}
                        onChange={e => onPatch({ recordingFormat: e.target.value as any })}
                        className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm">
                        <option value="wav" className="bg-card">WAV (uncompressed, ~10 MB/min)</option>
                        <option value="mp3" className="bg-card">MP3 (compressed, ~1 MB/min)</option>
                    </select>
                </div>
            </div>
        </div>
    );
}

function SliderRow({ label, hint, value, min, max, step, onChange, suffix }: {
    label: string; hint: string; value: number; min: number; max: number; step: number;
    onChange: (v: number) => void; suffix?: string;
}) {
    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">{label}</span>
                <span className="font-mono text-xs">{value}{suffix ? ` ${suffix}` : ''}</span>
            </div>
            <p className="text-[10px] text-muted-foreground mb-2">{hint}</p>
            <input type="range" min={min} max={max} step={step} value={value}
                onChange={e => onChange(Number(e.target.value))}
                className="w-full accent-primary" />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>{min}{suffix ? ` ${suffix}` : ''}</span>
                <span>{max}{suffix ? ` ${suffix}` : ''}</span>
            </div>
        </div>
    );
}

function ToggleRow2({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
                <div className="text-sm font-medium">{label}</div>
                <div className="text-[10px] text-muted-foreground">{hint}</div>
            </div>
            <button onClick={() => onChange(!value)}
                className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${value ? 'bg-primary' : 'bg-secondary'}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`} />
            </button>
        </div>
    );
}

// ─── Talk widget — browser WebRTC to OpenAI Realtime ───────────────
function TalkWidget({ assistantId, assistantName, onClose }: {
    assistantId: string; assistantName: string; onClose: () => void;
}) {
    const [state, setState] = useState<'connecting' | 'live' | 'ending' | 'error'>('connecting');
    const [error, setError] = useState<string | null>(null);
    const [transcript, setTranscript] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
    const startedAtRef = useRef<number>(Date.now());
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const localRef = useRef<MediaStream | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const dcRef = useRef<RTCDataChannel | null>(null);

    const stop = useCallback(async () => {
        setState('ending');
        try { dcRef.current?.close(); } catch {}
        try { pcRef.current?.close(); } catch {}
        try { localRef.current?.getTracks().forEach(t => t.stop()); } catch {}
        try { if (audioRef.current) { audioRef.current.srcObject = null; audioRef.current.remove(); } } catch {}
        setTimeout(onClose, 200);
    }, [onClose]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const tokenRes = await api.post(`/voice/assistants/${assistantId}/test-session`);
                if (cancelled) return;
                if (!tokenRes.data.success) throw new Error(tokenRes.data.message || 'mint failed');

                const clientSecret = tokenRes.data.clientSecret;
                const sessionUpdate = tokenRes.data.sessionUpdate;

                const pc = new RTCPeerConnection();
                pcRef.current = pc;
                const audioEl = document.createElement('audio');
                audioEl.autoplay = true;
                document.body.appendChild(audioEl);
                audioRef.current = audioEl;
                pc.ontrack = ev => { audioEl.srcObject = ev.streams[0]; };

                const local = await navigator.mediaDevices.getUserMedia({ audio: true });
                localRef.current = local;
                local.getTracks().forEach(t => pc.addTrack(t, local));

                const dc = pc.createDataChannel('oai-events');
                dcRef.current = dc;
                dc.onmessage = evt => {
                    try {
                        const ev = JSON.parse(String(evt.data));
                        if (ev.type === 'conversation.item.input_audio_transcription.completed') {
                            const t = String(ev.transcript || '').trim();
                            if (t) setTranscript(prev => [...prev, { role: 'user', text: t }]);
                        } else if (ev.type === 'response.audio_transcript.done') {
                            const t = String(ev.transcript || '').trim();
                            if (t) setTranscript(prev => [...prev, { role: 'assistant', text: t }]);
                        } else if (ev.type === 'error') {
                            setError(ev.error?.message || 'OpenAI error');
                        }
                    } catch {}
                };
                dc.onopen = () => {
                    if (sessionUpdate) { try { dc.send(JSON.stringify(sessionUpdate)); } catch {} }
                };

                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
                    method: 'POST', body: offer.sdp,
                    headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
                });
                if (!sdpRes.ok) {
                    const body = await sdpRes.text().catch(() => '');
                    throw new Error(`OpenAI SDP handshake failed (${sdpRes.status}): ${body.slice(0, 200)}`);
                }
                const answer = { type: 'answer' as const, sdp: await sdpRes.text() };
                await pc.setRemoteDescription(answer);
                if (cancelled) return;
                setState('live');
                startedAtRef.current = Date.now();

                pc.oniceconnectionstatechange = () => {
                    if (['closed', 'failed', 'disconnected'].includes(pc.iceConnectionState)) void stop();
                };
            } catch (err: any) {
                if (cancelled) return;
                setError(err.message || 'Failed to start test call');
                setState('error');
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [assistantId]);

    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        if (state !== 'live') return;
        const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 500);
        return () => clearInterval(timer);
    }, [state]);

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={stop}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${state === 'live' ? 'bg-emerald-500/20 text-emerald-400 animate-pulse' : 'bg-secondary text-muted-foreground'}`}>
                            <PhoneCallIcon className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="font-semibold text-sm">Talk to {assistantName}</div>
                            <div className="text-[11px] text-muted-foreground">
                                {state === 'connecting' && 'Connecting…'}
                                {state === 'live' && `Live · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`}
                                {state === 'ending' && 'Ending…'}
                                {state === 'error' && 'Error'}
                            </div>
                        </div>
                    </div>
                    <button onClick={stop} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {state === 'connecting' && (
                    <div className="text-center py-4">
                        <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
                        <p className="text-xs text-muted-foreground mt-2">Opening WebRTC session to OpenAI Realtime…</p>
                    </div>
                )}

                {state === 'error' && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-xs">{error}</div>
                )}

                {state === 'live' && (
                    <>
                        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 text-center">
                            <Mic className="w-6 h-6 text-emerald-400 mx-auto animate-pulse" />
                            <p className="text-xs text-emerald-400 mt-1 font-medium">Listening — speak now</p>
                        </div>
                        <div className="bg-secondary/20 rounded-xl p-3 max-h-64 overflow-y-auto space-y-2">
                            {transcript.length === 0 ? (
                                <p className="text-[11px] text-muted-foreground text-center italic">Live transcript appears here as you speak…</p>
                            ) : transcript.map((t, i) => (
                                <div key={i} className={`text-xs ${t.role === 'assistant' ? 'text-foreground' : 'text-primary'}`}>
                                    <span className="font-semibold">{t.role === 'assistant' ? 'Assistant' : 'You'}:</span> {t.text}
                                </div>
                            ))}
                        </div>
                    </>
                )}

                <button onClick={stop}
                    className="w-full bg-red-500 hover:bg-red-500/90 text-white font-medium rounded-xl px-4 py-2.5 flex items-center justify-center gap-2 text-sm">
                    <MicOff className="w-4 h-4" /> End call
                </button>
            </div>
        </div>
    );
}

// ─── Test call dialog ─────────────────────────────────────────────
// Fires a real outbound Twilio call from any phone number bound to
// this assistant. Backend hunts for the number itself; we poll
// Twilio for live status so the operator sees geo-permission blocks,
// invalid destinations, unverified-trial rejections, etc. without
// digging through Twilio Console.
type TwilioStatus = {
    status: string;
    duration?: string;
    errorCode?: number | null;
    errorMessage?: string | null;
};

// Human-readable hint for the most common Twilio outbound error codes.
// Full list: https://www.twilio.com/docs/api/errors
function twilioErrorHint(code: number | null | undefined): string | null {
    if (!code) return null;
    switch (code) {
        case 13224: case 13225:
            return 'Twilio account has this destination country blocked. Enable it in Twilio Console → Voice → Geo Permissions.';
        case 13223:
            return 'Destination number is invalid or unreachable. Double-check the E.164 format (must start with +).';
        case 21215:
            return 'Twilio account has geographic permissions blocking this country. Enable it in Twilio Console → Voice → Geo Permissions.';
        case 21219:
            return "'To' number is not verified — Twilio trial accounts can only call verified numbers. Verify it in Twilio Console → Phone Numbers → Verified Caller IDs, or upgrade the account.";
        case 21606: case 21212:
            return "'From' number isn't voice-capable or not owned by this Twilio account.";
        case 32017: case 32403:
            return 'Twilio account balance too low to place the call.';
        default:
            return null;
    }
}

function TestCallDialog({ assistantId, assistantName, onClose }: {
    assistantId: string;
    assistantName: string;
    onClose: () => void;
}) {
    const [to, setTo] = useState('');
    const [dialing, setDialing] = useState(false);
    const [result, setResult] = useState<{ callSid: string; fromNumber: string } | null>(null);
    const [twStatus, setTwStatus] = useState<TwilioStatus | null>(null);
    const [error, setError] = useState<{ code?: string; message: string } | null>(null);

    const dial = async () => {
        if (!to.trim()) { setError({ message: 'Enter a destination number in E.164 format (e.g. +14155551234).' }); return; }
        setDialing(true);
        setError(null);
        try {
            const res = await api.post(`/voice/assistants/${assistantId}/test-call`, { toNumber: to.trim() });
            if (res.data?.success) setResult({ callSid: res.data.callSid, fromNumber: res.data.fromNumber });
        } catch (err: any) {
            setError({
                code: err.response?.data?.code,
                message: err.response?.data?.message || err.message,
            });
        } finally { setDialing(false); }
    };

    // Poll Twilio for real status every 2 s until the call reaches a
    // terminal state or 60 s elapses. Twilio only settles into
    // `failed` (with errorCode) a moment after we create the call —
    // that's what the operator actually needs to see.
    useEffect(() => {
        if (!result?.callSid) return;
        let cancelled = false;
        const startedAt = Date.now();
        const terminal = new Set(['completed', 'failed', 'busy', 'no-answer', 'canceled']);
        (async () => {
            while (!cancelled && Date.now() - startedAt < 60_000) {
                try {
                    const s = await api.get(`/voice/calls/${result.callSid}/status`);
                    if (s.data?.success) {
                        setTwStatus({
                            status: s.data.status,
                            duration: s.data.duration,
                            errorCode: s.data.errorCode,
                            errorMessage: s.data.errorMessage,
                        });
                        if (terminal.has(s.data.status)) return;
                    }
                } catch { /* keep polling */ }
                await new Promise(r => setTimeout(r, 2000));
            }
        })();
        return () => { cancelled = true; };
    }, [result?.callSid]);

    const statusColor = (s?: string) => {
        if (!s) return 'text-muted-foreground';
        if (s === 'in-progress' || s === 'completed') return 'text-emerald-400';
        if (s === 'ringing' || s === 'queued') return 'text-primary';
        return 'text-red-400';
    };
    const hint = twilioErrorHint(twStatus?.errorCode);

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h3 className="font-semibold flex items-center gap-2">
                        <PhoneOutgoing className="w-4 h-4 text-primary" /> Test call
                    </h3>
                    <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <p className="text-xs text-muted-foreground">
                    <em>{assistantName}</em> will place a real Twilio call. Charges land on your Twilio account.
                </p>
                <div>
                    <label className="text-xs font-medium text-muted-foreground">Destination (E.164)</label>
                    <input value={to} onChange={e => setTo(e.target.value)}
                        placeholder="+14155551234"
                        disabled={!!result}
                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm font-mono disabled:opacity-60" />
                </div>

                {error && (
                    <div className="bg-red-500/10 border border-red-500/25 rounded-lg p-3 text-xs space-y-1.5">
                        <div className="flex items-start gap-2 text-red-400">
                            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                            <span>{error.message}</span>
                        </div>
                        {(error.code === 'no_phone_number' || error.code === 'twilio_not_configured') && (
                            <Link href="/dashboard/voice/numbers"
                                className="text-primary hover:underline inline-flex items-center gap-1">
                                Open Phone Numbers →
                            </Link>
                        )}
                    </div>
                )}

                {result && (
                    <div className="bg-secondary/30 border border-border rounded-lg p-3 text-xs space-y-1.5">
                        <div className="font-medium flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Call created
                        </div>
                        <div className="text-muted-foreground">
                            Dialling <span className="font-mono text-foreground">{to}</span> from <span className="font-mono text-foreground">{result.fromNumber}</span>.
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono break-all">{result.callSid}</div>
                        <div className="pt-1 border-t border-border flex items-center gap-1.5">
                            <span className="text-muted-foreground">Twilio status:</span>
                            {twStatus ? (
                                <span className={`font-mono font-medium ${statusColor(twStatus.status)}`}>{twStatus.status}</span>
                            ) : (
                                <span className="text-muted-foreground inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> checking…</span>
                            )}
                            {twStatus?.duration && Number(twStatus.duration) > 0 && (
                                <span className="text-muted-foreground">· {twStatus.duration}s</span>
                            )}
                        </div>
                        {twStatus?.errorMessage && (
                            <div className="bg-red-500/10 border border-red-500/25 rounded-md px-2 py-1.5 text-red-400 space-y-1">
                                <div className="font-medium">
                                    Twilio error {twStatus.errorCode ? `#${twStatus.errorCode}` : ''}
                                </div>
                                <div className="text-muted-foreground text-[11px]">{twStatus.errorMessage}</div>
                                {hint && <div className="text-amber-400 text-[11px]">{hint}</div>}
                            </div>
                        )}
                    </div>
                )}

                {!result && (
                    <button onClick={dial} disabled={dialing || !to.trim()}
                        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                        {dialing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneOutgoing className="w-4 h-4" />}
                        Dial now
                    </button>
                )}
            </div>
        </div>
    );
}

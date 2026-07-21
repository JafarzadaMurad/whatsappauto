"use client";

// Platform-owned API keys. Every workspace on a plan without
// `allowCustomApiKeys` runs its LLM calls through THESE keys and
// gets billed in credits. Keys stored in SystemConfig; the mailer
// pattern (per-key `updatedAt` display) is reused verbatim.

import { useEffect, useState } from "react";
import { KeyRound, Loader2, Save, MessageSquare, Phone } from "lucide-react";
import api from "@/lib/api";

// Grouped so the admin sees text-LLM keys separately from the Voice
// provider fleet (which is much longer). Every entry with a set value
// unlocks the corresponding provider's models in the Voice catalog.
type KeyDef = { key: string; label: string; placeholder: string; hint: string };
type KeyGroup = { title: string; icon: any; hint: string; keys: KeyDef[] };

const KEY_GROUPS: KeyGroup[] = [
    {
        title: 'Text LLMs',
        icon: MessageSquare,
        hint: 'The three master keys the credit system uses for every text LLM call.',
        keys: [
            { key: 'PLATFORM_ANTHROPIC_KEY', label: 'Anthropic (Claude)', placeholder: 'sk-ant-…',
                hint: 'Used for every Claude call by workspaces on Free/Starter plans.' },
            { key: 'PLATFORM_OPENAI_KEY', label: 'OpenAI (GPT / Whisper / Realtime)', placeholder: 'sk-…',
                hint: 'Used for every OpenAI call — including the voice-call bridge (OpenAI Realtime API).' },
            { key: 'PLATFORM_GOOGLE_KEY', label: 'Google (Gemini)', placeholder: 'AIza…',
                hint: 'Used for every Gemini call.' },
            { key: 'PLATFORM_GROQ_KEY', label: 'Groq (Llama)', placeholder: 'gsk_…',
                hint: 'Ultra-low-latency Llama inference. Optional — only needed if the Voice catalogue lists Groq LLMs.' },
        ],
    },
    {
        title: 'Voice — Transcribers (STT)',
        icon: Phone,
        hint: 'Speech-to-text engines used by Voice Assistants. Every configured key makes its provider show up in the pipeline picker.',
        keys: [
            { key: 'PLATFORM_DEEPGRAM_KEY', label: 'Deepgram', placeholder: 'dg-…',
                hint: 'Unlocks Nova 3 / Nova 2 transcribers AND Aura TTS voices.' },
            { key: 'PLATFORM_ASSEMBLYAI_KEY', label: 'AssemblyAI', placeholder: 'aa-…',
                hint: 'Universal streaming STT.' },
            { key: 'PLATFORM_GLADIA_KEY', label: 'Gladia', placeholder: 'gld-…', hint: 'Solaria STT.' },
            { key: 'PLATFORM_SPEECHMATICS_KEY', label: 'Speechmatics', placeholder: 'sm-…', hint: 'Ursa STT.' },
            { key: 'PLATFORM_SONIOX_KEY', label: 'Soniox', placeholder: 'sx-…', hint: 'Soniox v5 real-time STT.' },
        ],
    },
    {
        title: 'Voice — Text-to-Speech (TTS)',
        icon: Phone,
        hint: 'TTS engines used to speak assistant replies. Not needed when the assistant uses a speech-to-speech LLM (OpenAI Realtime).',
        keys: [
            { key: 'PLATFORM_ELEVENLABS_KEY', label: 'ElevenLabs', placeholder: 'el-…',
                hint: 'Rachel / Adam / Antoni / Bella etc. Top-tier human voices, ~$90 per 1M chars.' },
            { key: 'PLATFORM_CARTESIA_KEY', label: 'Cartesia', placeholder: 'crt-…',
                hint: 'Sonic 2 (~90 ms voice-to-voice latency).' },
            { key: 'PLATFORM_PLAYHT_KEY', label: 'PlayHT', placeholder: 'user_id|api_key',
                hint: 'Format the value as "userId|apiKey" (pipe-separated) — PlayHT requires both.' },
            { key: 'PLATFORM_AZURE_SPEECH_KEY', label: 'Azure Speech', placeholder: 'key|region  (e.g. …|eastus)',
                hint: 'Azure Neural voices. Format the value as "apiKey|region" (pipe-separated) — Azure needs both.' },
        ],
    },
];
const PLATFORM_KEYS: KeyDef[] = KEY_GROUPS.flatMap(g => g.keys);

export default function AdminPlatformKeysPage() {
    const [values, setValues] = useState<Record<string, string>>({});
    const [updatedAt, setUpdatedAt] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const load = async () => {
        try {
            const res = await api.get('/admin/config');
            if (res.data.success) {
                const cfg = res.data.config;
                const v: Record<string, string> = {};
                const u: Record<string, string> = {};
                for (const k of PLATFORM_KEYS) {
                    v[k.key] = cfg[k.key]?.value || '';
                    u[k.key] = cfg[k.key]?.updatedAt || '';
                }
                setValues(v);
                setUpdatedAt(u);
            }
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const save = async () => {
        setSaving(true);
        setSaved(false);
        try {
            const entries: Record<string, string> = {};
            for (const k of PLATFORM_KEYS) {
                if (values[k.key] && values[k.key].trim()) entries[k.key] = values[k.key].trim();
            }
            await api.put('/admin/config', { entries });
            setSaved(true);
            load();
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        } finally { setSaving(false); }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-xl"><KeyRound className="w-6 h-6" /></div>
                        Platform API Keys
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        These are the master keys the credit system uses. When a workspace's plan doesn't allow bring-your-own keys, its LLM / voice calls go through the appropriate key here and are billed against its credit pool.
                    </p>
                </div>
                <button onClick={save} disabled={saving}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-5 py-2.5 flex items-center gap-2 text-sm transition-all disabled:opacity-60">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save all
                </button>
            </div>
            {saved && <div className="text-xs text-emerald-400 -mt-4">Saved.</div>}

            {KEY_GROUPS.map(group => {
                const Icon = group.icon;
                const filledInGroup = group.keys.filter(k => (values[k.key] || '').trim()).length;
                return (
                    <div key={group.title} className="bg-card border border-border rounded-2xl p-5 space-y-4">
                        <div className="flex items-start justify-between gap-3 pb-3 border-b border-border">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-primary/10 text-primary rounded-lg"><Icon className="w-4 h-4" /></div>
                                <div>
                                    <h2 className="font-semibold">{group.title}</h2>
                                    <p className="text-xs text-muted-foreground mt-0.5">{group.hint}</p>
                                </div>
                            </div>
                            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0 ${
                                filledInGroup === group.keys.length ? 'bg-emerald-500/15 text-emerald-400'
                                    : filledInGroup > 0 ? 'bg-amber-500/15 text-amber-400'
                                    : 'bg-secondary text-muted-foreground'
                            }`}>{filledInGroup}/{group.keys.length} set</span>
                        </div>
                        {group.keys.map(k => {
                            const isSet = !!(values[k.key] || '').trim();
                            return (
                                <div key={k.key}>
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium">{k.label}</label>
                                        {isSet && <span className="text-[10px] text-emerald-400">● installed</span>}
                                    </div>
                                    <input type="password"
                                        value={values[k.key] || ''}
                                        onChange={e => setValues({ ...values, [k.key]: e.target.value })}
                                        placeholder={k.placeholder}
                                        className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" />
                                    <p className="text-xs text-muted-foreground mt-1">{k.hint}</p>
                                    {updatedAt[k.key] && (
                                        <p className="text-[10px] text-muted-foreground mt-0.5">last updated: {new Date(updatedAt[k.key]).toLocaleString()}</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                );
            })}

            <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5 text-sm">
                <h2 className="font-semibold text-amber-400 mb-2">Notes</h2>
                <ul className="list-disc pl-5 space-y-1 text-muted-foreground text-xs">
                    <li>Only providers with a key set here appear in the user's Voice Assistant pipeline picker and in the Plan editor's voice allow-lists.</li>
                    <li>Keys are stored in the SystemConfig table. Only admins can read/write. The backend caches them in memory for 60 s.</li>
                    <li>PlayHT + Azure Speech: paste as <code className="bg-secondary px-1 rounded">value|extra</code> — PlayHT needs <code className="bg-secondary px-1 rounded">userId|apiKey</code>, Azure needs <code className="bg-secondary px-1 rounded">apiKey|region</code>.</li>
                    <li>Rotating: paste a new value, click Save. All backend workers pick up the new key within ~60s without a restart.</li>
                </ul>
            </div>
        </div>
    );
}

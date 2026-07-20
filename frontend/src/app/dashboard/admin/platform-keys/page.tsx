"use client";

// Platform-owned API keys. Every workspace on a plan without
// `allowCustomApiKeys` runs its LLM calls through THESE keys and
// gets billed in credits. Keys stored in SystemConfig; the mailer
// pattern (per-key `updatedAt` display) is reused verbatim.

import { useEffect, useState } from "react";
import { KeyRound, Loader2, Save } from "lucide-react";
import api from "@/lib/api";

const PLATFORM_KEYS = [
    { key: 'PLATFORM_ANTHROPIC_KEY', label: 'Anthropic (Claude)', placeholder: 'sk-ant-…',
        hint: 'Used for every Claude call by workspaces on Free/Starter plans.' },
    { key: 'PLATFORM_OPENAI_KEY', label: 'OpenAI (GPT / Whisper / Realtime)', placeholder: 'sk-…',
        hint: 'Used for every OpenAI call — including the voice-call bridge (OpenAI Realtime API).' },
    { key: 'PLATFORM_GOOGLE_KEY', label: 'Google (Gemini)', placeholder: 'AIza…',
        hint: 'Used for every Gemini call.' },
    { key: 'TWILIO_ACCOUNT_SID', label: 'Twilio Account SID', placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        hint: 'Used to provision + route phone numbers for the Voice product.' },
    { key: 'TWILIO_AUTH_TOKEN', label: 'Twilio Auth Token', placeholder: '(32-char hex from twilio.com/console)',
        hint: 'Used to sign API requests to Twilio + verify inbound webhook signatures.' },
];

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
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-3">
                    <div className="p-2 bg-primary/10 text-primary rounded-xl"><KeyRound className="w-6 h-6" /></div>
                    Platform LLM Keys
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    These are the master keys the credit system uses. When a workspace's plan doesn't allow bring-your-own keys, its LLM calls go through the appropriate key here and are billed against its credit pool.
                </p>
            </div>

            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                {PLATFORM_KEYS.map(k => (
                    <div key={k.key}>
                        <label className="text-sm font-medium">{k.label}</label>
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
                ))}

                <div className="flex items-center justify-between pt-2">
                    {saved && <span className="text-xs text-emerald-400">Saved.</span>}
                    <div className="flex-1" />
                    <button onClick={save} disabled={saving}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-5 py-2.5 flex items-center gap-2 text-sm transition-all disabled:opacity-60">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save
                    </button>
                </div>
            </div>

            <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5 text-sm">
                <h2 className="font-semibold text-amber-400 mb-2">Security</h2>
                <ul className="list-disc pl-5 space-y-1 text-muted-foreground text-xs">
                    <li>Keys are stored in the SystemConfig table. Only admins can read/write. The backend loads them once and caches in memory for 60 seconds.</li>
                    <li>Setting up rate limits and monthly caps at the provider's dashboard (Anthropic / OpenAI / Google) is strongly recommended in case a plan misconfig leaks calls.</li>
                    <li>Rotating: paste a new value, Save. All backend workers pick up the new key within ~60s without a restart.</li>
                </ul>
            </div>
        </div>
    );
}

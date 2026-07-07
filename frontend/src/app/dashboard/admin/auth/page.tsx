"use client";

import { useEffect, useState } from "react";
import { LogIn, Loader2, Save, ExternalLink } from "lucide-react";
import api from "@/lib/api";

type Provider = {
    id: string;
    label: string;
    description: string;
    keys: { key: string; label: string; placeholder: string; isSecret: boolean; hint: string }[];
    helpUrl?: string;
};

const PROVIDERS: Provider[] = [
    {
        id: 'google',
        label: 'Google',
        description: 'Let users sign in with their Google account using Google Identity Services.',
        helpUrl: 'https://console.cloud.google.com/apis/credentials',
        keys: [
            { key: 'GOOGLE_CLIENT_ID', label: 'Client ID', placeholder: '....apps.googleusercontent.com', isSecret: false,
                hint: 'Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs. Public — exposed to the frontend so the button can render.' },
            { key: 'GOOGLE_CLIENT_SECRET', label: 'Client Secret', placeholder: '', isSecret: true,
                hint: 'Same OAuth client. Required for the Google Calendar connector (server-side token exchange). Not needed for the sign-in button alone.' },
        ]
    },
    {
        id: 'meta',
        label: 'Meta (Facebook + Instagram)',
        description: 'Powers Instagram Business Login + Facebook Ads connect. Both share the same Meta Developer App.',
        helpUrl: 'https://developers.facebook.com/apps',
        keys: [
            { key: 'META_APP_ID', label: 'App ID', placeholder: '14XXXXXXXXXXX', isSecret: false,
                hint: 'Meta Developer Console → App settings → Basic → App ID. Same value used for FB Login and IG Login.' },
            { key: 'META_APP_SECRET', label: 'App Secret', placeholder: '', isSecret: true,
                hint: 'Meta Developer Console → App settings → Basic → App Secret. Server-only; never sent to the browser.' },
            { key: 'META_IG_APP_ID', label: 'Instagram App ID', placeholder: '', isSecret: false,
                hint: 'Required only when the app uses a separate Instagram product app. Leave blank to fall back to META_APP_ID.' },
            { key: 'META_IG_APP_SECRET', label: 'Instagram App Secret', placeholder: '', isSecret: true,
                hint: 'Same situation as META_IG_APP_ID — leave blank when there is no dedicated IG app.' },
            { key: 'META_ADS_CONFIG_ID', label: 'Facebook Login for Business — Configuration ID', placeholder: '27555078400775474', isSecret: false,
                hint: 'Required for the Facebook Ads connect button. Created in Meta console → Facebook Login for Business → Configurations. Without this, the Ads OAuth URL falls back to classic scope= and Meta will reject it on the new product.' },
        ]
    },
];

const ALL_KEYS = PROVIDERS.flatMap(p => p.keys);

export default function AdminAuthPage() {
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
                for (const k of ALL_KEYS) {
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
            for (const k of ALL_KEYS) {
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
                    <div className="p-2 bg-primary/10 text-primary rounded-xl"><LogIn className="w-6 h-6" /></div>
                    Sign-in Providers
                </h1>
                <p className="text-sm text-muted-foreground mt-1">Configure third-party sign-in methods users can log in with.</p>
            </div>

            {PROVIDERS.map(provider => (
                <div key={provider.id} className="bg-card border border-border rounded-2xl p-5 space-y-4">
                    <div>
                        <div className="flex items-center justify-between">
                            <h2 className="font-semibold">{provider.label}</h2>
                            {provider.helpUrl && (
                                <a href={provider.helpUrl} target="_blank" rel="noreferrer"
                                    className="text-xs text-primary hover:underline flex items-center gap-1">
                                    Open dashboard <ExternalLink className="w-3 h-3" />
                                </a>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{provider.description}</p>
                    </div>

                    {provider.keys.map(k => (
                        <div key={k.key}>
                            <label className="text-sm font-medium">{k.label}</label>
                            <input
                                type={k.isSecret ? 'password' : 'text'}
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
                </div>
            ))}

            <div className="flex items-center justify-end gap-3">
                {saved && <span className="text-xs text-emerald-400">Saved.</span>}
                <button onClick={save} disabled={saving}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-5 py-2.5 flex items-center gap-2 text-sm transition-all disabled:opacity-60">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save
                </button>
            </div>
        </div>
    );
}

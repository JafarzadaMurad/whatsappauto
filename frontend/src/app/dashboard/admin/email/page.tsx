"use client";

import { useEffect, useState } from "react";
import { Mail, Loader2, Save } from "lucide-react";
import api from "@/lib/api";

const SMTP_KEYS = [
    { key: 'SMTP_HOST', label: 'SMTP Host', placeholder: 'smtp.gmail.com / smtp.resend.com / ...', isSecret: false,
        hint: 'The SMTP server hostname from your mail provider.' },
    { key: 'SMTP_PORT', label: 'SMTP Port', placeholder: '587', isSecret: false,
        hint: '587 for STARTTLS (most providers), 465 for SSL.' },
    { key: 'SMTP_SECURE', label: 'SMTP Secure (true/false)', placeholder: 'false', isSecret: false,
        hint: 'true if port 465, false if 587. Leave blank — auto-detected from port.' },
    { key: 'SMTP_USER', label: 'SMTP Username', placeholder: 'user@example.com', isSecret: false,
        hint: 'Usually the email address you authenticate with.' },
    { key: 'SMTP_PASS', label: 'SMTP Password', placeholder: 'app password or api key', isSecret: true,
        hint: 'For Gmail use an App Password, not your real password. For Resend/Postmark use the API key.' },
    { key: 'SMTP_FROM', label: 'From Address', placeholder: '"alChatBot" <noreply@yourdomain.com>', isSecret: false,
        hint: 'The sender address users will see. Falls back to SMTP_USER if blank.' },
];

export default function AdminEmailPage() {
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
                for (const k of SMTP_KEYS) {
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
            for (const k of SMTP_KEYS) {
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
                    <div className="p-2 bg-primary/10 text-primary rounded-xl"><Mail className="w-6 h-6" /></div>
                    Email (SMTP)
                </h1>
                <p className="text-sm text-muted-foreground mt-1">Outgoing email — used for verification, password resets and notifications.</p>
            </div>

            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                {SMTP_KEYS.map(k => (
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

            <div className="bg-card border border-border rounded-2xl p-5 text-sm space-y-2 text-muted-foreground">
                <h2 className="font-semibold text-foreground">Provider tips</h2>
                <ul className="list-disc pl-5 space-y-1">
                    <li><span className="text-foreground">Gmail:</span> host <code className="bg-secondary px-1 rounded">smtp.gmail.com</code>, port <code className="bg-secondary px-1 rounded">587</code>, user = your Gmail, password = a 16-character <a className="text-primary hover:underline" target="_blank" href="https://myaccount.google.com/apppasswords" rel="noreferrer">App Password</a> (2FA must be on).</li>
                    <li><span className="text-foreground">Resend:</span> host <code className="bg-secondary px-1 rounded">smtp.resend.com</code>, port <code className="bg-secondary px-1 rounded">465</code>, user <code className="bg-secondary px-1 rounded">resend</code>, password = your API key.</li>
                    <li><span className="text-foreground">Postmark:</span> host <code className="bg-secondary px-1 rounded">smtp.postmarkapp.com</code>, port <code className="bg-secondary px-1 rounded">587</code>, user = server token, password = same token.</li>
                </ul>
            </div>
        </div>
    );
}

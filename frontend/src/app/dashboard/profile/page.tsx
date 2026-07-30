"use client";

// Profile — the user's own account settings.
//
// Password section handles two distinct cases:
//   - Account created with email + password → change it (current
//     password required).
//   - Account created via Google → no password exists yet. Setting one
//     is what lets the profile be handed to a colleague who signs in
//     with email + password instead of the Google button.

import { useEffect, useState } from "react";
import {
    User as UserIcon, Loader2, KeyRound, Mail, ShieldCheck,
    Eye, EyeOff, CheckCircle2, AlertCircle,
} from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

type PasswordState = { hasPassword: boolean; isGoogleAccount: boolean };

export default function ProfilePage() {
    const user = useAuthStore(s => s.user);
    const [state, setState] = useState<PasswordState | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const r = await api.get('/auth/password-state');
                if (r.data?.success) setState({ hasPassword: r.data.hasPassword, isGoogleAccount: r.data.isGoogleAccount });
            } catch (err) { console.error(err); }
            finally { setLoading(false); }
        })();
    }, []);

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-3">
                    <div className="p-2 bg-primary/10 text-primary rounded-xl"><UserIcon className="w-6 h-6" /></div>
                    Profile
                </h1>
                <p className="text-sm text-muted-foreground mt-1">Your account details and sign-in security.</p>
            </div>

            {/* Account */}
            <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account</h2>
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center text-lg font-bold text-muted-foreground">
                        {(user?.name || user?.email || '?')[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                        <div className="font-semibold truncate">{user?.name || 'User'}</div>
                        <div className="text-sm text-muted-foreground flex items-center gap-1.5 truncate">
                            <Mail className="w-3.5 h-3.5 flex-shrink-0" /> {user?.email}
                        </div>
                    </div>
                </div>
                {state?.isGoogleAccount && (
                    <div className="text-[11px] text-muted-foreground bg-secondary/30 border border-border rounded-lg px-3 py-2">
                        Signed up with Google.
                        {state.hasPassword
                            ? ' A password is also set, so you can sign in either way.'
                            : ' Set a password below if you want to sign in with email + password too, or hand this profile to someone else.'}
                    </div>
                )}
            </div>

            <PasswordCard
                hasPassword={!!state?.hasPassword}
                onChanged={() => setState(s => s ? { ...s, hasPassword: true } : s)}
            />
        </div>
    );
}

function PasswordCard({ hasPassword, onChanged }: {
    hasPassword: boolean;
    onChanged: () => void;
}) {
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [show, setShow] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

    const mismatch = confirm.length > 0 && next !== confirm;
    const tooShort = next.length > 0 && next.length < 6;
    const disabled = saving
        || next.length < 6
        || next !== confirm
        || (hasPassword && current.length === 0);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMsg(null);
        try {
            const r = await api.post('/auth/change-password', {
                newPassword: next,
                ...(hasPassword ? { currentPassword: current } : {}),
            });
            setMsg({ ok: true, text: r.data?.message || 'Password updated' });
            setCurrent(''); setNext(''); setConfirm('');
            onChanged();
        } catch (err: any) {
            setMsg({
                ok: false,
                text: err.response?.data?.errors?.[0]?.message
                    || err.response?.data?.message
                    || err.message,
            });
        } finally { setSaving(false); }
    };

    return (
        <form onSubmit={submit} className="bg-card border border-border rounded-2xl p-5 space-y-4">
            <div>
                <h2 className="font-semibold flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-primary" />
                    {hasPassword ? 'Change password' : 'Set a password'}
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                    {hasPassword
                        ? 'Enter your current password, then the new one.'
                        : 'Your account has no password yet. Setting one adds email + password as a second way to sign in.'}
                </p>
            </div>

            {msg && (
                <div className={`text-xs rounded-lg px-3 py-2 flex items-start gap-2 ${
                    msg.ok
                        ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400'
                        : 'bg-red-500/10 border border-red-500/25 text-red-400'
                }`}>
                    {msg.ok ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
                    <span>{msg.text}</span>
                </div>
            )}

            {hasPassword && (
                <Field label="Current password">
                    <input type={show ? 'text' : 'password'} value={current}
                        onChange={e => setCurrent(e.target.value)}
                        autoComplete="current-password"
                        className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                </Field>
            )}

            <Field label={hasPassword ? 'New password' : 'Password'}
                hint={tooShort ? 'At least 6 characters.' : undefined}
                hintTone="warn">
                <div className="relative">
                    <input type={show ? 'text' : 'password'} value={next}
                        onChange={e => setNext(e.target.value)}
                        autoComplete="new-password"
                        className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 pr-10 text-sm" />
                    <button type="button" onClick={() => setShow(v => !v)}
                        title={show ? 'Hide' : 'Show'}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
                        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                </div>
            </Field>

            <Field label="Confirm password"
                hint={mismatch ? "Passwords don't match." : undefined}
                hintTone="warn">
                <input type={show ? 'text' : 'password'} value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
            </Field>

            <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" /> Other sessions stay signed in.
                </span>
                <button type="submit" disabled={disabled}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-5 py-2 text-sm font-medium flex items-center gap-2 disabled:opacity-60">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                    {hasPassword ? 'Update password' : 'Set password'}
                </button>
            </div>
        </form>
    );
}

function Field({ label, hint, hintTone, children }: {
    label: string;
    hint?: string;
    hintTone?: 'warn' | 'muted';
    children: React.ReactNode;
}) {
    return (
        <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
            {children}
            {hint && (
                <p className={`text-[11px] mt-1 ${hintTone === 'warn' ? 'text-amber-400' : 'text-muted-foreground'}`}>
                    {hint}
                </p>
            )}
        </div>
    );
}

"use client";

import { useEffect, useState } from "react";
import { Mail, Loader2, X } from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

export default function VerifyEmailBanner() {
    const user = useAuthStore(s => s.user);
    const [verified, setVerified] = useState<boolean | null>(null);
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (!user) return;
        // Trust stored value first; refresh from /me in case it's stale after verifying in another tab
        setVerified(user.emailVerified ?? null);
        api.get('/auth/me').then(r => {
            if (r.data?.success && r.data.user) setVerified(!!r.data.user.emailVerified);
        }).catch(() => {});
    }, [user]);

    const resend = async () => {
        setSending(true);
        try {
            const r = await api.post('/auth/resend-verification', {});
            if (r.data.success) setSent(true);
            else alert(r.data.message || 'Failed to send');
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        } finally { setSending(false); }
    };

    if (!user || verified !== false || dismissed) return null;

    return (
        <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-400 text-sm">
            <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-3">
                <Mail className="w-4 h-4 flex-shrink-0" />
                {sent ? (
                    <span className="flex-1">Verification email re-sent to <strong>{user.email}</strong>. Check your inbox (and spam).</span>
                ) : (
                    <>
                        <span className="flex-1">
                            Please verify your email — we sent a link to <strong>{user.email}</strong>.
                        </span>
                        <button onClick={resend} disabled={sending}
                            className="bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 font-medium rounded-lg px-3 py-1 text-xs flex items-center gap-1.5 disabled:opacity-60">
                            {sending && <Loader2 className="w-3 h-3 animate-spin" />}
                            Resend email
                        </button>
                    </>
                )}
                <button onClick={() => setDismissed(true)} className="text-amber-400/60 hover:text-amber-400">
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

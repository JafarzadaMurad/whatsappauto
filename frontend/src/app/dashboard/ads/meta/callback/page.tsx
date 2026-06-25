"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import api from "@/lib/api";

// Lands here after Facebook redirects with ?code=...
// Exchanges the code through the backend (server-side has the
// app secret), receives the long-lived token + the user's
// ad-account list, and stashes both in sessionStorage so the
// /dashboard/ads/meta page can render the picker without
// re-running OAuth.
export default function MetaCallbackPage() {
    const router = useRouter();
    const params = useSearchParams();
    const [stage, setStage] = useState<'exchanging' | 'success' | 'error'>('exchanging');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    useEffect(() => {
        const code = params?.get('code');
        const err = params?.get('error') || params?.get('error_description');
        if (err) { setStage('error'); setErrorMsg(err); return; }
        if (!code) { setStage('error'); setErrorMsg('No code returned by Facebook'); return; }

        (async () => {
            try {
                const r = await api.post('/meta/exchange', { code });
                if (!r.data?.success) {
                    setStage('error');
                    setErrorMsg(r.data?.message || 'Exchange failed');
                    return;
                }
                sessionStorage.setItem('meta:connect:payload', JSON.stringify(r.data));
                setStage('success');
                setTimeout(() => router.replace('/dashboard/ads/meta?picker=1'), 800);
            } catch (e: any) {
                setStage('error');
                setErrorMsg(e?.response?.data?.message || e.message);
            }
        })();
    }, [params, router]);

    return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
            <div className="bg-card border border-border rounded-2xl px-8 py-10 max-w-md w-full text-center">
                {stage === 'exchanging' && (
                    <>
                        <Loader2 className="w-7 h-7 text-primary animate-spin mx-auto mb-3" />
                        <h2 className="font-semibold">Facebook hesabı qoşulur…</h2>
                        <p className="text-xs text-muted-foreground mt-1">Reklam hesabların yüklənir.</p>
                    </>
                )}
                {stage === 'success' && (
                    <>
                        <CheckCircle2 className="w-7 h-7 text-emerald-400 mx-auto mb-3" />
                        <h2 className="font-semibold">Uğurlu</h2>
                        <p className="text-xs text-muted-foreground mt-1">Reklam hesabı seçiminə yönləndirilirsən…</p>
                    </>
                )}
                {stage === 'error' && (
                    <>
                        <XCircle className="w-7 h-7 text-red-400 mx-auto mb-3" />
                        <h2 className="font-semibold">Qoşulma alınmadı</h2>
                        <p className="text-xs text-muted-foreground mt-2 break-words">{errorMsg}</p>
                        <button onClick={() => router.replace('/dashboard/ads/meta')}
                            className="mt-4 text-xs px-3 py-2 rounded-lg bg-secondary/60 hover:bg-secondary border border-border">
                            Geri qayıt
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

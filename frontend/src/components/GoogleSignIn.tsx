"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GoogleOAuthProvider, GoogleLogin } from "@react-oauth/google";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

export default function GoogleSignIn({ onError }: { onError?: (msg: string) => void }) {
    const router = useRouter();
    const setAuth = useAuthStore(s => s.login);
    const [clientId, setClientId] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        api.get('/auth/google/config')
            .then(r => setClientId(r.data?.clientId || null))
            .catch(() => setClientId(null))
            .finally(() => setLoaded(true));
    }, []);

    if (!loaded) return null;
    if (!clientId) return null; // Google not configured — hide silently

    const handleCredential = async (credential: string | undefined) => {
        if (!credential) { onError?.('Google did not return a credential'); return; }
        try {
            const res = await api.post('/auth/google', { credential });
            if (res.data.success) {
                setAuth(res.data.user, res.data.token);
                router.push('/dashboard');
            } else {
                onError?.(res.data.message || 'Google sign-in failed');
            }
        } catch (e: any) {
            onError?.(e.response?.data?.message || e.message || 'Google sign-in failed');
        }
    };

    return (
        <GoogleOAuthProvider clientId={clientId}>
            <div className="flex flex-col items-center gap-4 w-full">
                <div className="flex items-center w-full gap-3">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">or continue with</span>
                    <div className="flex-1 h-px bg-border" />
                </div>
                <div className="w-full rounded-xl overflow-hidden ring-1 ring-border hover:ring-primary/40 transition-all">
                    <GoogleLogin
                        onSuccess={(resp) => handleCredential(resp.credential)}
                        onError={() => onError?.('Google sign-in failed')}
                        theme="filled_black"
                        shape="pill"
                        size="large"
                        text="continue_with"
                        logo_alignment="center"
                        width="320"
                    />
                </div>
            </div>
        </GoogleOAuthProvider>
    );
}

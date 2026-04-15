"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import api from "@/lib/api";

function CallbackContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [error, setError] = useState("");

    useEffect(() => {
        const process = async () => {
            const code = searchParams.get('code');
            const errorParam = searchParams.get('error');

            if (errorParam) {
                setError(errorParam);
                setStatus('error');
                return;
            }

            if (!code) {
                setError('No authorization code received');
                setStatus('error');
                return;
            }

            try {
                // Exchange code for token via backend
                const exchangeRes = await api.post('/instagram/exchange-code', { code });
                if (!exchangeRes.data.success) {
                    setError(exchangeRes.data.message || 'Token exchange failed');
                    setStatus('error');
                    return;
                }

                // Save account
                await api.post('/instagram/accounts', {
                    igUserId: exchangeRes.data.igUserId,
                    username: exchangeRes.data.username,
                    accessToken: exchangeRes.data.accessToken,
                });

                setStatus('success');
                setTimeout(() => router.push('/dashboard/instagram'), 2000);
            } catch (err: any) {
                setError(err.response?.data?.message || err.message);
                setStatus('error');
            }
        };

        process();
    }, []);

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
            {status === 'loading' && (
                <>
                    <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
                    <h2 className="text-xl font-semibold">Connecting Instagram...</h2>
                    <p className="text-muted-foreground mt-2">Please wait</p>
                </>
            )}
            {status === 'success' && (
                <>
                    <CheckCircle className="w-12 h-12 text-emerald-500 mb-4" />
                    <h2 className="text-xl font-semibold">Instagram Connected!</h2>
                    <p className="text-muted-foreground mt-2">Redirecting...</p>
                </>
            )}
            {status === 'error' && (
                <>
                    <XCircle className="w-12 h-12 text-destructive mb-4" />
                    <h2 className="text-xl font-semibold">Connection Failed</h2>
                    <p className="text-muted-foreground mt-2 max-w-md">{error}</p>
                    <button onClick={() => router.push('/dashboard/instagram')}
                        className="mt-4 px-6 py-2.5 bg-secondary rounded-xl text-sm font-medium hover:bg-secondary/80 transition-colors">
                        Back to Instagram
                    </button>
                </>
            )}
        </div>
    );
}

export default function InstagramCallbackPage() {
    return (
        <Suspense fallback={<div className="flex justify-center items-center min-h-[60vh]"><Loader2 className="w-8 h-8 animate-spin" /></div>}>
            <CallbackContent />
        </Suspense>
    );
}

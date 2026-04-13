"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import api from "@/lib/api";

export default function InstagramCallbackPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [error, setError] = useState("");

    useEffect(() => {
        const save = async () => {
            const igUserId = searchParams.get('igUserId');
            const username = searchParams.get('username');
            const token = searchParams.get('token');
            const errorParam = searchParams.get('error');

            if (errorParam) {
                setError(errorParam);
                setStatus('error');
                return;
            }

            if (!igUserId || !token) {
                setError('Missing parameters');
                setStatus('error');
                return;
            }

            try {
                await api.post('/instagram/accounts', {
                    igUserId,
                    username,
                    accessToken: token,
                });
                setStatus('success');
                setTimeout(() => router.push('/dashboard/instagram'), 2000);
            } catch (err: any) {
                setError(err.response?.data?.message || err.message);
                setStatus('error');
            }
        };

        save();
    }, [searchParams, router]);

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
                    <p className="text-muted-foreground mt-2">{error}</p>
                    <button onClick={() => router.push('/dashboard/instagram')}
                        className="mt-4 px-6 py-2.5 bg-secondary rounded-xl text-sm font-medium hover:bg-secondary/80 transition-colors">
                        Back to Instagram
                    </button>
                </>
            )}
        </div>
    );
}

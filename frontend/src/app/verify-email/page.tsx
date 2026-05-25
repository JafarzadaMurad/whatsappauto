"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { MessageSquare, Loader2, Check, X } from "lucide-react";
import api from "@/lib/api";

function VerifyEmailInner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get('token') || '';
    const [status, setStatus] = useState<'pending' | 'ok' | 'error'>('pending');
    const [message, setMessage] = useState("");

    useEffect(() => {
        if (!token) { setStatus('error'); setMessage('Missing token in URL.'); return; }
        api.post('/auth/verify-email', { token })
            .then(() => { setStatus('ok'); setMessage('Email verified successfully.'); })
            .catch(err => { setStatus('error'); setMessage(err.response?.data?.message || err.message); });
    }, [token]);

    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md z-10">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-secondary mb-6 border border-border shadow-xl">
                        <MessageSquare className="w-8 h-8 text-primary" />
                    </div>
                    <h1 className="text-3xl font-bold mb-2">Email verification</h1>
                </div>
                <div className="bg-card/50 backdrop-blur-xl border border-border rounded-3xl p-8 shadow-2xl text-center space-y-5">
                    {status === 'pending' && (
                        <>
                            <Loader2 className="w-10 h-10 animate-spin text-muted-foreground mx-auto" />
                            <p className="text-sm text-muted-foreground">Verifying your email…</p>
                        </>
                    )}
                    {status === 'ok' && (
                        <>
                            <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto">
                                <Check className="w-7 h-7 text-emerald-400" />
                            </div>
                            <p className="text-base">{message}</p>
                            <button onClick={() => router.push('/dashboard')}
                                className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-5 py-2.5 text-sm font-semibold">
                                Go to dashboard
                            </button>
                        </>
                    )}
                    {status === 'error' && (
                        <>
                            <div className="w-14 h-14 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center mx-auto">
                                <X className="w-7 h-7 text-destructive" />
                            </div>
                            <p className="text-sm text-destructive">{message}</p>
                            <button onClick={() => router.push('/login')} className="text-sm text-primary hover:underline">Back to login</button>
                        </>
                    )}
                </div>
            </motion.div>
        </div>
    );
}

export default function VerifyEmailPage() {
    return (
        <Suspense fallback={null}>
            <VerifyEmailInner />
        </Suspense>
    );
}

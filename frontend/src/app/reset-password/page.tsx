"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { MessageSquare, ArrowRight, Loader2 } from "lucide-react";
import api from "@/lib/api";

function ResetPasswordInner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get('token') || '';
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState("");

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
        if (password !== confirm) { setError("Passwords don't match."); return; }
        if (!token) { setError("Missing reset token. Use the link from your email."); return; }
        setLoading(true);
        try {
            await api.post('/auth/reset-password', { token, password });
            setDone(true);
        } catch (err: any) {
            setError(err.response?.data?.message || err.message);
        } finally { setLoading(false); }
    };

    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md z-10">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-secondary mb-6 border border-border shadow-xl">
                        <MessageSquare className="w-8 h-8 text-primary" />
                    </div>
                    <h1 className="text-3xl font-bold mb-2">Set a new password</h1>
                </div>

                <div className="bg-card/50 backdrop-blur-xl border border-border rounded-3xl p-8 shadow-2xl">
                    {done ? (
                        <div className="text-center space-y-4">
                            <p className="text-sm text-emerald-400">Password updated. You can sign in now.</p>
                            <button onClick={() => router.push('/login')} className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-5 py-2.5 text-sm font-semibold">Go to login</button>
                        </div>
                    ) : (
                        <form onSubmit={submit} className="space-y-6">
                            {error && (
                                <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center">{error}</div>
                            )}
                            <div className="space-y-2">
                                <label className="text-sm font-medium ml-1">New password</label>
                                <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                                    placeholder="••••••••" minLength={6}
                                    className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium ml-1">Confirm password</label>
                                <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)}
                                    placeholder="••••••••" minLength={6}
                                    className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50" />
                            </div>
                            <button type="submit" disabled={loading}
                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl px-4 py-3 flex items-center justify-center gap-2 disabled:opacity-70">
                                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Update password <ArrowRight className="w-5 h-5" /></>}
                            </button>
                        </form>
                    )}
                </div>
            </motion.div>
        </div>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={null}>
            <ResetPasswordInner />
        </Suspense>
    );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { MessageSquare, ArrowRight, Loader2, ArrowLeft } from "lucide-react";
import api from "@/lib/api";

export default function ForgotPasswordPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        try {
            await api.post('/auth/forgot-password', { email });
            setSent(true);
        } catch (err: any) {
            setError(err.response?.data?.message || err.message);
        } finally { setLoading(false); }
    };

    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full max-w-md z-10">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-secondary mb-6 border border-border shadow-xl">
                        <MessageSquare className="w-8 h-8 text-primary" />
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2">Reset your password</h1>
                    <p className="text-muted-foreground">Enter your email and we'll send you a reset link</p>
                </div>

                <div className="bg-card/50 backdrop-blur-xl border border-border rounded-3xl p-8 shadow-2xl">
                    {sent ? (
                        <div className="text-center space-y-4">
                            <p className="text-sm text-emerald-400">If an account exists for <span className="font-semibold">{email}</span>, a reset link has been sent. Check your inbox.</p>
                            <button onClick={() => router.push('/login')} className="text-sm text-primary hover:underline">Back to login</button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-6">
                            {error && (
                                <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center">{error}</div>
                            )}
                            <div className="space-y-2">
                                <label className="text-sm font-medium ml-1">Email</label>
                                <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                                    placeholder="you@example.com"
                                    className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground" />
                            </div>
                            <button type="submit" disabled={loading}
                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl px-4 py-3 flex items-center justify-center gap-2 disabled:opacity-70">
                                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Send reset link <ArrowRight className="w-5 h-5" /></>}
                            </button>
                            <button type="button" onClick={() => router.push('/login')}
                                className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                                <ArrowLeft className="w-4 h-4" /> Back to login
                            </button>
                        </form>
                    )}
                </div>
            </motion.div>
        </div>
    );
}

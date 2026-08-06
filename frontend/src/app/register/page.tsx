"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { MessageSquare, ArrowRight, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { captureReferral, storedReferralCode } from "@/lib/referral";
import { useAuthStore } from "@/store/authStore";
import GoogleSignIn from "@/components/GoogleSignIn";

function RegisterInner() {
    const router = useRouter();
    const params = useSearchParams();
    const setAuth = useAuthStore((state) => state.login);
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [form, setForm] = useState({ name: "", email: "", password: "", referralCode: "" });
    // Whether the code came from ?ref= or was typed. Worth recording:
    // a clicked link and a code someone remembered convert differently.
    const [refSource, setRefSource] = useState<"code" | "link">("code");
    const [refCheck, setRefCheck] = useState<{ valid: boolean; referrerName: string | null } | null>(null);

    // Skip the register form for users who already have a session —
    // honour ?next= so accept-invite links deep-return correctly.
    useEffect(() => {
        if (isAuthenticated) {
            const next = params.get('next');
            router.replace(next && next.startsWith('/') ? next : '/dashboard');
        }
    }, [isAuthenticated, params, router]);

    // The code may be in this URL, or it may be in a cookie from a click
    // that happened days ago on a different page. Either way it lands in
    // the field pre-filled, and the person can still overwrite it.
    useEffect(() => {
        const fromUrl = params.get('ref');
        const code = captureReferral() || storedReferralCode();
        if (code) {
            setForm(f => (f.referralCode ? f : { ...f, referralCode: code.toUpperCase() }));
            setRefSource(fromUrl ? 'link' : 'code');
        }
    }, [params]);

    // Confirm the code belongs to someone BEFORE they commit. A typo
    // found after paying is a support ticket; found here it's a
    // keystroke. Debounced so it doesn't fire on every character.
    useEffect(() => {
        const code = form.referralCode.trim();
        if (!code) { setRefCheck(null); return; }
        const t = setTimeout(() => {
            api.get(`/referrals/check/${encodeURIComponent(code)}`)
                .then(r => {
                    if (!r.data?.success || !r.data.enabled) { setRefCheck(null); return; }
                    setRefCheck({ valid: !!r.data.valid, referrerName: r.data.referrerName || null });
                })
                .catch(() => setRefCheck(null));
        }, 400);
        return () => clearTimeout(t);
    }, [form.referralCode]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const res = await api.post('/auth/register', {
                name: form.name,
                email: form.email,
                password: form.password,
                // Sent only when there's something to send — an empty
                // string would look like an attempted-and-failed code.
                ...(form.referralCode.trim()
                    ? { referralCode: form.referralCode.trim().toUpperCase(), referralSource: refSource }
                    : {}),
            });
            if (res.data.success) {
                setAuth(res.data.user, res.data.token);
                const next = params.get('next');
                router.push(next && next.startsWith('/') ? next : '/dashboard');
            }
        } catch (err: any) {
            setError(err.response?.data?.message || err.message || "Failed to register");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 relative overflow-hidden">
            {/* Dynamic Background Glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[100px] pointer-events-none" />

            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-md z-10"
            >
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-secondary mb-6 border border-border shadow-xl">
                        <MessageSquare className="w-8 h-8 text-primary" />
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">Create Account</h1>
                    <p className="text-muted-foreground">Start automating your WhatsApp workflows</p>
                </div>

                <div className="bg-card/50 backdrop-blur-xl border border-border rounded-3xl p-8 shadow-2xl">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {error && (
                            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center">
                                {error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground ml-1">Full Name</label>
                            <input
                                type="text"
                                required
                                className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all placeholder:text-muted-foreground"
                                placeholder="John Doe"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground ml-1">Email</label>
                            <input
                                type="email"
                                required
                                className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all placeholder:text-muted-foreground"
                                placeholder="you@example.com"
                                value={form.email}
                                onChange={(e) => setForm({ ...form, email: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground ml-1">Password</label>
                            <input
                                type="password"
                                required
                                minLength={6}
                                className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all placeholder:text-muted-foreground"
                                placeholder="••••••••"
                                value={form.password}
                                onChange={(e) => setForm({ ...form, password: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-foreground ml-1">
                                Referral code <span className="text-muted-foreground font-normal">(optional)</span>
                            </label>
                            <input
                                type="text"
                                className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 text-foreground font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all placeholder:text-muted-foreground placeholder:tracking-normal placeholder:font-sans"
                                placeholder="If someone invited you"
                                value={form.referralCode}
                                onChange={(e) => { setForm({ ...form, referralCode: e.target.value.toUpperCase() }); setRefSource("code"); }}
                            />
                            {refCheck && (
                                <p className={`text-xs ml-1 ${refCheck.valid ? 'text-emerald-400' : 'text-amber-400'}`}>
                                    {refCheck.valid
                                        ? `Invited by ${refCheck.referrerName}`
                                        : "We don't recognise that code — you can still sign up without it."}
                                </p>
                            )}
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl px-4 py-3 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-70"
                        >
                            {loading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>Sign Up <ArrowRight className="w-5 h-5" /></>
                            )}
                        </button>
                    </form>

                    <div className="mt-6">
                        <GoogleSignIn onError={setError} />
                    </div>

                    <div className="mt-8 text-center">
                        <p className="text-sm text-muted-foreground">
                            Already have an account?{" "}
                            <button onClick={() => {
                                const next = params.get('next');
                                router.push(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
                            }} className="text-primary hover:underline font-medium">
                                Log in
                            </button>
                        </p>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

export default function RegisterPage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}>
            <RegisterInner />
        </Suspense>
    );
}

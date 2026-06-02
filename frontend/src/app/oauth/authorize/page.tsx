"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageSquare, Shield, Loader2, X } from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

function ConsentInner() {
    const router = useRouter();
    const params = useSearchParams();
    const { isAuthenticated, hasHydrated, user } = useAuthStore();
    const [working, setWorking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const clientId = params.get('client_id') || '';
    const redirectUri = params.get('redirect_uri') || '';
    const codeChallenge = params.get('code_challenge') || '';
    const codeChallengeMethod = params.get('code_challenge_method') || 'S256';
    const scope = params.get('scope') || 'full';
    const state = params.get('state') || '';

    useEffect(() => {
        if (hasHydrated && !isAuthenticated) {
            const next = encodeURIComponent(window.location.pathname + window.location.search);
            router.replace(`/login?next=${next}`);
        }
    }, [hasHydrated, isAuthenticated, router]);

    if (!hasHydrated) return null;

    if (!clientId || !redirectUri || !codeChallenge) {
        return (
            <Page>
                <div className="text-center space-y-2">
                    <X className="w-10 h-10 text-red-400 mx-auto" />
                    <h2 className="font-semibold">Invalid authorization request</h2>
                    <p className="text-sm text-muted-foreground">Required OAuth parameters are missing.</p>
                </div>
            </Page>
        );
    }

    const allow = async () => {
        setWorking(true);
        setError(null);
        try {
            const r = await api.post('/mcp/oauth/authorize/consent', {
                client_id: clientId,
                redirect_uri: redirectUri,
                code_challenge: codeChallenge,
                code_challenge_method: codeChallengeMethod,
                scope,
                state,
            });
            if (r.data?.success && r.data.redirectTo) {
                window.location.href = r.data.redirectTo;
            } else {
                setError(r.data?.message || 'Authorization failed');
            }
        } catch (e: any) {
            setError(e.response?.data?.message || e.message);
        } finally {
            setWorking(false);
        }
    };

    const deny = async () => {
        setWorking(true);
        try {
            await api.post('/mcp/oauth/authorize/deny', { client_id: clientId });
        } catch { /* ignore */ }
        try {
            const u = new URL(redirectUri);
            u.searchParams.set('error', 'access_denied');
            if (state) u.searchParams.set('state', state);
            window.location.href = u.toString();
        } catch {
            router.replace('/dashboard');
        }
    };

    const scopes = scope.split(/[,\s]+/).filter(Boolean);

    return (
        <Page>
            <div className="space-y-6">
                <div className="text-center space-y-2">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary">
                        <Shield className="w-7 h-7" />
                    </div>
                    <h1 className="text-xl font-semibold">Authorize MCP client</h1>
                    <p className="text-sm text-muted-foreground">
                        An external AI client wants to access your alChatBot account on your behalf.
                    </p>
                </div>

                <div className="rounded-xl border border-border bg-secondary/30 p-4 space-y-2">
                    <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Client</p>
                        <p className="text-sm font-mono">{clientId}</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Redirect</p>
                        <p className="text-xs font-mono break-all">{redirectUri}</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Signed in as</p>
                        <p className="text-sm">{user?.email}</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Scope</p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                            {scopes.map(s => (
                                <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">{s}</span>
                            ))}
                        </div>
                    </div>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                    The client will be able to operate on your data through the MCP tools you have enabled.
                    You can review every action under Settings → MCP → Activity and limit per-tool permissions there.
                </p>

                {error && (
                    <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-red-300 text-xs">
                        {error}
                    </div>
                )}

                <div className="flex gap-3">
                    <button onClick={deny} disabled={working}
                        className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-secondary/40 hover:bg-secondary/70 text-sm font-medium transition-colors disabled:opacity-60">
                        Deny
                    </button>
                    <button onClick={allow} disabled={working}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                        {working && <Loader2 className="w-4 h-4 animate-spin" />}
                        Allow
                    </button>
                </div>
            </div>
        </Page>
    );
}

function Page({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
            <div className="w-full max-w-md z-10">
                <div className="flex items-center gap-2 mb-6 justify-center text-primary font-bold text-lg">
                    <MessageSquare className="w-5 h-5" />
                    alChatBot
                </div>
                <div className="bg-card/60 backdrop-blur-xl border border-border rounded-3xl p-7 shadow-2xl">
                    {children}
                </div>
            </div>
        </div>
    );
}

export default function OAuthAuthorizePage() {
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}>
            <ConsentInner />
        </Suspense>
    );
}

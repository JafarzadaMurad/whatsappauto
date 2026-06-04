"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageSquare, Loader2, X, Check, ChevronDown, ChevronUp } from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

// What we tell the user the AI client will be able to do once authorized.
// Stays in plain English so it reads like the Notion / Linear / GitHub
// consent screens — no client_id / redirect_uri noise.
const CAPABILITIES = [
    "Read your automations, AI agents, contacts, and message history",
    "Create or update automations, agents, and CRM contacts on your behalf",
    "Send WhatsApp and Instagram messages from your connected channels",
    "Reply to comments and DMs in your unified inbox",
    "Manage data tables, webhooks, and API keys",
];

function ConsentInner() {
    const router = useRouter();
    const params = useSearchParams();
    const { isAuthenticated, hasHydrated, user } = useAuthStore();
    const [working, setWorking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showDetails, setShowDetails] = useState(false);

    const clientId = params.get('client_id') || '';
    const redirectUri = params.get('redirect_uri') || '';
    const codeChallenge = params.get('code_challenge') || '';
    const codeChallengeMethod = params.get('code_challenge_method') || 'S256';
    const scope = params.get('scope') || 'full';
    const state = params.get('state') || '';

    // Friendly client name — we recognise the popular MCP clients by
    // redirect URI, so the screen says "Claude" instead of a UUID.
    const clientName = (() => {
        try {
            const u = new URL(redirectUri);
            if (u.hostname === 'claude.ai' || u.hostname.endsWith('.claude.ai')) return 'Claude';
            if (u.hostname === 'cursor.sh' || u.hostname.endsWith('.cursor.sh')) return 'Cursor';
            if (u.hostname === 'zed.dev' || u.hostname.endsWith('.zed.dev')) return 'Zed';
            return u.hostname;
        } catch {
            return 'an MCP client';
        }
    })();

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
        try { await api.post('/mcp/oauth/authorize/deny', { client_id: clientId }); } catch { /* ignore */ }
        try {
            const u = new URL(redirectUri);
            u.searchParams.set('error', 'access_denied');
            if (state) u.searchParams.set('state', state);
            window.location.href = u.toString();
        } catch {
            router.replace('/dashboard');
        }
    };

    return (
        <Page>
            <div className="space-y-6">
                <div className="text-center space-y-3">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20">
                        <MessageSquare className="w-8 h-8 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">Connect with alChatBot</h1>
                        <p className="text-sm text-muted-foreground mt-1">Grant <span className="font-medium text-foreground">{clientName}</span> access to alChatBot</p>
                    </div>
                </div>

                <div className="rounded-2xl border border-border bg-secondary/30 p-4">
                    <p className="text-xs text-muted-foreground mb-3">Signed in as</p>
                    <p className="text-sm font-medium">{user?.email}</p>
                </div>

                <div>
                    <p className="text-sm font-medium mb-3">Through alChatBot, {clientName} will be able to:</p>
                    <ul className="space-y-2.5">
                        {CAPABILITIES.map((c, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-sm">
                                <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                                <span className="text-muted-foreground">{c}</span>
                            </li>
                        ))}
                    </ul>
                    <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                        You can review every action and limit per-tool permissions under
                        Settings → MCP after connecting.
                    </p>
                </div>

                {error && (
                    <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-red-300 text-xs">
                        {error}
                    </div>
                )}

                <div className="space-y-2">
                    <button onClick={allow} disabled={working}
                        className="w-full px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
                        {working && <Loader2 className="w-4 h-4 animate-spin" />}
                        Allow
                    </button>
                    <button onClick={deny} disabled={working}
                        className="w-full px-4 py-3 rounded-xl border border-border bg-secondary/40 hover:bg-secondary/70 text-sm font-medium transition-colors disabled:opacity-60">
                        Cancel
                    </button>
                </div>

                <button onClick={() => setShowDetails(s => !s)}
                    className="w-full text-[11px] text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5">
                    {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    Technical details
                </button>

                {showDetails && (
                    <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-2 text-[11px]">
                        <div>
                            <p className="text-muted-foreground">Client ID</p>
                            <p className="font-mono break-all">{clientId}</p>
                        </div>
                        <div>
                            <p className="text-muted-foreground">Redirect URI</p>
                            <p className="font-mono break-all">{redirectUri}</p>
                        </div>
                        <div>
                            <p className="text-muted-foreground">Scope</p>
                            <p className="font-mono">{scope}</p>
                        </div>
                    </div>
                )}
            </div>
        </Page>
    );
}

function Page({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
            <div className="w-full max-w-md z-10">
                <div className="bg-card/70 backdrop-blur-xl border border-border rounded-3xl p-8 shadow-2xl">
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

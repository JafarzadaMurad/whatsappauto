"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, X, Check, MessageSquare } from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { useWorkspaceStore } from "@/store/workspaceStore";

interface PeekResult {
    workspaceName: string;
    email: string;
    role: string;
}

export default function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = use(params);
    const router = useRouter();
    const { user, hasHydrated, isAuthenticated } = useAuthStore();
    const setActiveWorkspace = useWorkspaceStore(s => s.setActiveWorkspace);
    const setWorkspaces = useWorkspaceStore(s => s.setWorkspaces);

    const [info, setInfo] = useState<PeekResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [accepting, setAccepting] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const r = await api.get(`/workspaces/invitations/${token}`);
                if (r.data?.success) setInfo({
                    workspaceName: r.data.workspaceName,
                    email: r.data.email,
                    role: r.data.role,
                });
            } catch (e: any) {
                setError(e.response?.data?.message || e.message || 'Invalid invitation');
            } finally { setLoading(false); }
        })();
    }, [token]);

    useEffect(() => {
        if (hasHydrated && !isAuthenticated) {
            router.replace(`/login?next=${encodeURIComponent(`/accept-invite/${token}`)}`);
        }
    }, [hasHydrated, isAuthenticated, router, token]);

    const accept = async () => {
        setAccepting(true);
        try {
            const r = await api.post(`/workspaces/invitations/${token}/accept`);
            if (r.data?.success) {
                // Refresh workspaces and switch into the new one.
                const ws = await api.get('/workspaces');
                if (ws.data?.success) setWorkspaces(ws.data.workspaces);
                setActiveWorkspace(r.data.workspaceId);
                router.replace('/dashboard');
            }
        } catch (e: any) {
            setError(e.response?.data?.message || e.message);
        } finally { setAccepting(false); }
    };

    const emailMismatch = info && user && info.email.toLowerCase() !== user.email.toLowerCase();

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
            <div className="w-full max-w-md z-10">
                <div className="flex items-center gap-2 mb-6 justify-center text-primary font-bold text-lg">
                    <MessageSquare className="w-5 h-5" />
                    alChatBot
                </div>
                <div className="bg-card/60 backdrop-blur-xl border border-border rounded-3xl p-7 shadow-2xl">
                    {loading ? (
                        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                    ) : error ? (
                        <div className="text-center space-y-2">
                            <X className="w-10 h-10 text-red-400 mx-auto" />
                            <h2 className="font-semibold">Invitation problem</h2>
                            <p className="text-sm text-muted-foreground">{error}</p>
                        </div>
                    ) : info ? (
                        <div className="space-y-5">
                            <div className="text-center space-y-3">
                                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary">
                                    <Building2 className="w-7 h-7" />
                                </div>
                                <div>
                                    <h1 className="text-xl font-semibold tracking-tight">You're invited</h1>
                                    <p className="text-sm text-muted-foreground mt-1">to join <span className="font-medium text-foreground">{info.workspaceName}</span></p>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-border bg-secondary/30 p-4 space-y-2 text-sm">
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Role</span>
                                    <span className="font-medium capitalize">{info.role.toLowerCase()}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">For</span>
                                    <span className="font-medium">{info.email}</span>
                                </div>
                            </div>

                            {emailMismatch ? (
                                <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-300 text-xs">
                                    This invitation is addressed to <strong>{info.email}</strong>, but you are signed in as <strong>{user?.email}</strong>. Sign out and sign in with the right account to accept.
                                </div>
                            ) : (
                                <button onClick={accept} disabled={accepting}
                                    className="w-full px-4 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
                                    {accepting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                    Accept invitation
                                </button>
                            )}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

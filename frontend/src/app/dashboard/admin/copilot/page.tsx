"use client";

// Admin control for the in-app copilot: the base system prompt,
// which model powers text mode, and which Realtime model powers
// voice mode. Model dropdowns are populated from the AiPricing
// table so admins can only pick models the platform is already
// wired to bill correctly.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Loader2, Save, RotateCcw, Cpu, KeyRound, Check } from "lucide-react";
import api from "@/lib/api";
import UnsavedChangesBar from "@/components/UnsavedChangesBar";

type TextModelRow = { provider: "CLAUDE" | "OPENAI"; model: string };

type Settings = {
    systemPrompt: string;
    defaultSystemPrompt: string;
    provider: "CLAUDE" | "OPENAI";
    model: string;
    voiceModel: string;
    textModels: TextModelRow[];
    voiceModels: string[];
};

type SubAccount = { id: string; label: string; configKey: string; tokenSet: boolean };
type SubUser = { id: string; name: string | null; email: string };
type SubCfg = {
    enabled: boolean;
    model: string | null;
    accounts: SubAccount[];
    userMap: Record<string, string>;
    users: SubUser[];
};

export default function AdminCopilotPage() {
    const [cfg, setCfg] = useState<Settings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    // Only the editable fields are compared — the catalogues that come
    // down with the config never change locally, and folding them in
    // would make the bar appear on load.
    const [baseline, setBaseline] = useState<string>('');
    // Seats live in their own card with their own save button: tokens are
    // write-only, so folding them into the shared dirty-check would mean
    // re-sending blank token fields on every unrelated save.
    const [sub, setSub] = useState<SubCfg | null>(null);
    const [tokens, setTokens] = useState<Record<string, string>>({});
    const [subSaving, setSubSaving] = useState(false);
    const [subSaved, setSubSaved] = useState(false);
    const fingerprint = (c: Settings | null) => c ? JSON.stringify({
        systemPrompt: c.systemPrompt, provider: c.provider, model: c.model, voiceModel: c.voiceModel,
    }) : '';
    const dirty = !!cfg && fingerprint(cfg) !== baseline;

    const load = async () => {
        try {
            const res = await api.get('/admin/copilot');
            if (res.data.success) setCfg({
                systemPrompt: res.data.systemPrompt,
                defaultSystemPrompt: res.data.defaultSystemPrompt,
                provider: res.data.provider,
                model: res.data.model,
                voiceModel: res.data.voiceModel,
                textModels: res.data.textModels || [],
                voiceModels: res.data.voiceModels || [],
            });
            if (res.data.success) setBaseline(fingerprint({
                systemPrompt: res.data.systemPrompt,
                provider: res.data.provider,
                model: res.data.model,
                voiceModel: res.data.voiceModel,
            } as Settings));
        } finally { setLoading(false); }
    };
    const loadSub = async () => {
        try {
            const res = await api.get('/admin/copilot/subscription');
            if (res.data.success) setSub({
                enabled: res.data.enabled,
                model: res.data.model,
                accounts: res.data.accounts || [],
                userMap: res.data.userMap || {},
                users: res.data.users || [],
            });
        } catch { /* seats are optional — the API path still works without them */ }
    };
    useEffect(() => { load(); loadSub(); }, []);

    const saveSub = async () => {
        if (!sub) return;
        setSubSaving(true);
        setSubSaved(false);
        try {
            const res = await api.put('/admin/copilot/subscription', {
                enabled: sub.enabled,
                model: sub.model || null,
                userMap: sub.userMap,
                tokens,
            });
            if (res.data.success) {
                setSub({ ...sub, accounts: res.data.accounts, userMap: res.data.userMap });
                // Clear the inputs so a stored token is never sitting in
                // the DOM after it has been saved.
                setTokens({});
                setSubSaved(true);
            }
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        } finally { setSubSaving(false); }
    };

    const save = async () => {
        if (!cfg) return;
        setSaving(true);
        setSaved(false);
        try {
            // Text provider/model stay in the payload as a fallback
            // when a workspace hasn't picked yet; admin doesn't edit
            // them here anymore, but the backend still uses the stored
            // COPILOT_PROVIDER / COPILOT_MODEL when body.provider is
            // undefined on a chat call.
            await api.put('/admin/copilot', {
                systemPrompt: cfg.systemPrompt,
                provider: cfg.provider,
                model: cfg.model,
                voiceModel: cfg.voiceModel,
            });
            setBaseline(fingerprint(cfg));
            setSaved(true);
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        } finally { setSaving(false); }
    };

    if (loading || !cfg) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    const hasVoiceModels = cfg.voiceModels.length > 0;
    const currentVoiceListed = cfg.voiceModels.includes(cfg.voiceModel);

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-3">
                    <div className="p-2 bg-primary/10 text-primary rounded-xl"><Bot className="w-6 h-6" /></div>
                    In-app Copilot
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    The chat bubble on every dashboard page. Set the base personality here; each workspace can
                    then append their own rules on top.
                </p>
            </div>

            <div className="bg-secondary/10 border border-border rounded-2xl p-5 space-y-3 text-sm">
                <div className="flex items-start gap-3">
                    <div className="p-2 bg-primary/10 text-primary rounded-lg"><Cpu className="w-4 h-4" /></div>
                    <div className="flex-1">
                        <h3 className="font-semibold text-sm">Text model selection moved</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                            Users now pick the copilot's text model per session from a dropdown on the chat panel.
                            Which models each user can pick is controlled by their plan — set
                            {" "}<Link href="/dashboard/admin/plans" className="text-primary hover:underline">Admin → Plans → Allowed AI models</Link>{" "}
                            to tick which ones each plan unlocks. Models come from the
                            {" "}<Link href="/dashboard/admin/ai-models" className="text-primary hover:underline">AI Models Catalogue</Link>.
                        </p>
                    </div>
                </div>
            </div>

            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                <h2 className="font-semibold">Voice model</h2>
                <div>
                    <label className="text-xs font-medium text-muted-foreground">OpenAI Realtime model (voice mode only)</label>
                    {hasVoiceModels ? (
                        <select value={cfg.voiceModel}
                            onChange={e => setCfg({ ...cfg, voiceModel: e.target.value })}
                            className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm font-mono">
                            {!currentVoiceListed && (
                                <option value={cfg.voiceModel} className="bg-card">{cfg.voiceModel} (not in pricing table)</option>
                            )}
                            {cfg.voiceModels.map(m => (
                                <option key={m} value={m} className="bg-card">{m}</option>
                            ))}
                        </select>
                    ) : (
                        <div className="mt-1 text-xs text-amber-400">
                            No OpenAI Realtime models in the pricing table. Add one under Admin → AI Pricing first
                            (model id contains "realtime").
                        </div>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                        Voice mode uses the Realtime API; users cannot pick this per-session. Text mode is per-user.
                    </p>
                </div>
            </div>

            {sub && (
                <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                    <div className="flex items-start gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-lg"><KeyRound className="w-4 h-4" /></div>
                        <div className="flex-1">
                            <h2 className="font-semibold">Claude subscription seats</h2>
                            <p className="text-xs text-muted-foreground mt-1">
                                Run the copilot on a Claude subscription instead of the platform API key. A user with a
                                seat costs nothing per token and no cai is deducted for their turns. Anyone without a
                                seat — and any turn a seat fails to serve — falls back to the API key automatically.
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-1">
                                Copilot only. WhatsApp and voice agents stay on the API: a subscription's rate limit is
                                sized for one person's day, not for round-the-clock traffic.
                            </p>
                        </div>
                    </div>

                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={sub.enabled}
                            onChange={e => setSub({ ...sub, enabled: e.target.checked })}
                            className="rounded border-border" />
                        Use subscription seats when available
                    </label>

                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Model override (optional)</label>
                        <input value={sub.model || ''} onChange={e => setSub({ ...sub, model: e.target.value })}
                            placeholder="leave blank for the subscription's default"
                            className="mt-1 w-full bg-secondary/30 border border-border rounded-lg px-3 py-1.5 text-sm font-mono" />
                    </div>

                    <div className="space-y-2">
                        <h3 className="text-xs font-medium text-muted-foreground">OAuth tokens</h3>
                        <p className="text-[10px] text-muted-foreground">
                            Run <code className="font-mono">claude setup-token</code> while logged into each
                            subscription and paste the token here. Tokens are stored server-side and never sent back
                            to the browser — leave a field blank to keep the one already saved.
                        </p>
                        {sub.accounts.map(a => (
                            <div key={a.id} className="flex items-center gap-2">
                                <span className="text-xs w-20 shrink-0">{a.label}</span>
                                <input type="password" autoComplete="new-password"
                                    value={tokens[a.id] ?? ''}
                                    onChange={e => setTokens({ ...tokens, [a.id]: e.target.value })}
                                    placeholder={a.tokenSet ? '•••••••• saved' : 'not set'}
                                    className="flex-1 bg-secondary/30 border border-border rounded-lg px-3 py-1.5 text-xs font-mono" />
                                {a.tokenSet && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
                            </div>
                        ))}
                    </div>

                    <div className="space-y-2">
                        <h3 className="text-xs font-medium text-muted-foreground">Who uses which seat</h3>
                        {sub.users.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No admin users found.</p>
                        ) : sub.users.map(u => (
                            <div key={u.id} className="flex items-center gap-2">
                                <span className="text-xs flex-1 truncate">{u.name || u.email}</span>
                                <select value={sub.userMap[u.id] || ''}
                                    onChange={e => {
                                        const next = { ...sub.userMap };
                                        if (e.target.value) next[u.id] = e.target.value; else delete next[u.id];
                                        setSub({ ...sub, userMap: next });
                                    }}
                                    className="bg-card border border-border rounded-lg px-2 py-1 text-xs">
                                    <option value="" className="bg-card">API key</option>
                                    {sub.accounts.map(a => (
                                        <option key={a.id} value={a.id} className="bg-card">{a.label}</option>
                                    ))}
                                </select>
                            </div>
                        ))}
                    </div>

                    <div className="flex items-center justify-end gap-3">
                        {subSaved && <span className="text-xs text-emerald-400">Saved.</span>}
                        <button onClick={saveSub} disabled={subSaving}
                            className="bg-secondary hover:bg-secondary/80 border border-border font-medium rounded-xl px-4 py-2 flex items-center gap-2 text-sm disabled:opacity-60">
                            {subSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save seats
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="font-semibold">Base system prompt</h2>
                    <button onClick={() => setCfg({ ...cfg, systemPrompt: cfg.defaultSystemPrompt })}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                        <RotateCcw className="w-3 h-3" /> Reset to default
                    </button>
                </div>
                <p className="text-xs text-muted-foreground">
                    Defines the copilot's personality, tool-use rules, and language behaviour. Each workspace
                    can append their own additional rules from Settings.
                </p>
                <textarea value={cfg.systemPrompt} onChange={e => setCfg({ ...cfg, systemPrompt: e.target.value })}
                    rows={20}
                    placeholder={cfg.defaultSystemPrompt}
                    className="w-full bg-secondary/30 border border-border rounded-xl px-4 py-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y" />
                <p className="text-[10px] text-muted-foreground">
                    Leave blank to use the built-in default (visible as the placeholder above).
                </p>
            </div>

            <div className="flex items-center justify-end gap-3">
                {saved && <span className="text-xs text-emerald-400">Saved.</span>}
                <button onClick={save} disabled={saving}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-5 py-2.5 flex items-center gap-2 text-sm transition-all disabled:opacity-60">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save
                </button>
            </div>

            <UnsavedChangesBar
                dirty={dirty}
                saving={saving}
                onSave={save}
                label="Unsaved copilot settings"
            />
        </div>
    );
}

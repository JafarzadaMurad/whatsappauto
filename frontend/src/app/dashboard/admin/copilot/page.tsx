"use client";

// Admin control for the in-app copilot: the base system prompt,
// which model powers text mode, and which Realtime model powers
// voice mode. Model dropdowns are populated from the AiPricing
// table so admins can only pick models the platform is already
// wired to bill correctly.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Loader2, Save, RotateCcw, Cpu, KeyRound, Plus, Trash2, AlertTriangle } from "lucide-react";
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

type SubToken = {
    id: string;
    label: string;
    tokenSet: boolean;
    /** Epoch ms until which the pool is skipping this token, if any. */
    cooldownUntil: number | null;
};
type SubCfg = { enabled: boolean; model: string | null; tokens: SubToken[] };
/** A row being edited. `token` is only ever filled in by the admin. */
type TokenDraft = { id?: string; label: string; token: string; tokenSet: boolean; cooldownUntil: number | null };

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
    const [drafts, setDrafts] = useState<TokenDraft[]>([]);
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
            if (res.data.success) {
                const list: SubToken[] = res.data.tokens || [];
                setSub({ enabled: res.data.enabled, model: res.data.model, tokens: list });
                setDrafts(list.map(t => ({
                    id: t.id, label: t.label, token: '', tokenSet: t.tokenSet, cooldownUntil: t.cooldownUntil,
                })));
            }
        } catch { /* the pool is optional — the API key path works without it */ }
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
                tokens: drafts.map(d => ({ id: d.id, label: d.label, token: d.token })),
            });
            if (res.data.success) {
                const list: SubToken[] = res.data.tokens || [];
                setSub({ ...sub, tokens: list });
                // Rebuild from the server so a saved token is never left
                // sitting in the DOM.
                setDrafts(list.map(t => ({
                    id: t.id, label: t.label, token: '', tokenSet: t.tokenSet, cooldownUntil: t.cooldownUntil,
                })));
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
                            <h2 className="font-semibold">Claude subscription pool</h2>
                            <p className="text-xs text-muted-foreground mt-1">
                                One shared pool of subscription tokens, used platform-wide — copilot, WhatsApp agents,
                                Instagram, campaign openers and oversight. Turns served from the pool cost nothing per
                                token and no cai is deducted for them.
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-1">
                                A workspace on its own Anthropic key is never diverted here — they are paying their own
                                provider bill. Everyone else uses the pool when it is on, and the platform API key when
                                it is off or exhausted.
                            </p>
                        </div>
                    </div>

                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={sub.enabled}
                            onChange={e => setSub({ ...sub, enabled: e.target.checked })}
                            className="rounded border-border" />
                        Use the subscription pool instead of the platform API key
                    </label>

                    <div className="flex items-start gap-2 text-[11px] text-amber-400 bg-amber-400/5 border border-amber-400/20 rounded-lg p-3">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                        <span>
                            A subscription's rate limit is sized for one person's day of work, and the agents answer
                            around the clock. Expect the pool to run out under real traffic — when it does, a token is
                            benched for a while and everything falls back to the API key on its own. Nothing breaks;
                            it just costs money again until the limit resets.
                        </span>
                    </div>

                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Model override (optional)</label>
                        <input value={sub.model || ''} onChange={e => setSub({ ...sub, model: e.target.value })}
                            placeholder="leave blank for the subscription's default"
                            className="mt-1 w-full bg-secondary/30 border border-border rounded-lg px-3 py-1.5 text-sm font-mono" />
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-medium text-muted-foreground">Tokens</h3>
                            <button type="button"
                                onClick={() => setDrafts([...drafts, {
                                    label: `Token ${drafts.length + 1}`, token: '', tokenSet: false, cooldownUntil: null,
                                }])}
                                className="text-xs text-primary hover:underline flex items-center gap-1">
                                <Plus className="w-3 h-3" /> Add token
                            </button>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                            Run <code className="font-mono">claude setup-token</code> while logged into each Claude
                            subscription and paste the token here. Tokens are stored server-side and never sent back to
                            the browser — leave a field blank to keep the one already saved.
                        </p>
                        {drafts.length === 0 && (
                            <p className="text-xs text-muted-foreground">No tokens yet — the API key is being used.</p>
                        )}
                        {drafts.map((d, i) => {
                            const benched = d.cooldownUntil && d.cooldownUntil > Date.now();
                            return (
                                <div key={d.id || `new-${i}`} className="flex items-center gap-2">
                                    <input value={d.label}
                                        onChange={e => setDrafts(drafts.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                                        placeholder="label"
                                        className="w-32 shrink-0 bg-secondary/30 border border-border rounded-lg px-2 py-1.5 text-xs" />
                                    <input type="password" autoComplete="new-password"
                                        value={d.token}
                                        onChange={e => setDrafts(drafts.map((x, j) => j === i ? { ...x, token: e.target.value } : x))}
                                        placeholder={d.tokenSet ? '•••••••• saved' : 'sk-ant-oat01-...'}
                                        className="flex-1 bg-secondary/30 border border-border rounded-lg px-3 py-1.5 text-xs font-mono" />
                                    {benched && (
                                        <span className="text-[10px] text-amber-400 shrink-0" title="Skipped until the limit resets">
                                            benched
                                        </span>
                                    )}
                                    <button type="button" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}
                                        className="text-muted-foreground hover:text-red-400 shrink-0" title="Remove">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    <div className="flex items-center justify-end gap-3">
                        {subSaved && <span className="text-xs text-emerald-400">Saved.</span>}
                        <button onClick={saveSub} disabled={subSaving}
                            className="bg-secondary hover:bg-secondary/80 border border-border font-medium rounded-xl px-4 py-2 flex items-center gap-2 text-sm disabled:opacity-60">
                            {subSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save pool
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

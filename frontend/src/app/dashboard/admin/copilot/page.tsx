"use client";

// Admin control for the in-app copilot: the base system prompt,
// which model powers text mode, and which Realtime model powers
// voice mode. Model dropdowns are populated from the AiPricing
// table so admins can only pick models the platform is already
// wired to bill correctly.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Loader2, Save, RotateCcw, Cpu } from "lucide-react";
import api from "@/lib/api";

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

export default function AdminCopilotPage() {
    const [cfg, setCfg] = useState<Settings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

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
        } finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

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
        </div>
    );
}

"use client";

// Admin control for the in-app copilot: the base system prompt,
// which model powers text mode, and which Realtime model powers
// voice mode. Everything is stored in SystemConfig and picked up
// by the /api/copilot/chat handler within seconds (no restart).

import { useEffect, useState } from "react";
import { Bot, Loader2, Save, RotateCcw } from "lucide-react";
import api from "@/lib/api";

type Settings = {
    systemPrompt: string;
    defaultSystemPrompt: string;
    provider: string;
    model: string;
    voiceModel: string;
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
            });
        } finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const save = async () => {
        if (!cfg) return;
        setSaving(true);
        setSaved(false);
        try {
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

            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                <h2 className="font-semibold">Model</h2>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Text provider</label>
                        <select value={cfg.provider} onChange={e => setCfg({ ...cfg, provider: e.target.value })}
                            className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm">
                            <option value="CLAUDE" className="bg-card">Anthropic (Claude)</option>
                            <option value="OPENAI" className="bg-card">OpenAI (GPT)</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Text model</label>
                        <input type="text" value={cfg.model} onChange={e => setCfg({ ...cfg, model: e.target.value })}
                            className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-mono"
                            placeholder="claude-sonnet-5" />
                    </div>
                </div>
                <div>
                    <label className="text-xs font-medium text-muted-foreground">Voice model (OpenAI Realtime)</label>
                    <input type="text" value={cfg.voiceModel} onChange={e => setCfg({ ...cfg, voiceModel: e.target.value })}
                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-mono"
                        placeholder="gpt-4o-realtime-preview-2024-12-17" />
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                        Voice mode uses OpenAI's Realtime API regardless of the text provider above.
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

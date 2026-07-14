"use client";

// Workspace-scoped copilot prompt extension. Appended AFTER the
// admin's base prompt on every request. Owners write brand-specific
// or workspace-specific rules here ("always answer in Russian",
// "never delete campaigns without asking").

import { useEffect, useState } from "react";
import { Bot, Loader2, Save, Info } from "lucide-react";
import api from "@/lib/api";

export default function CopilotSettingsPage() {
    const [enabled, setEnabled] = useState<boolean>(false);
    const [customPrompt, setCustomPrompt] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const res = await api.get('/copilot/config');
                if (res.data.success) {
                    setEnabled(res.data.enabled);
                    setCustomPrompt(res.data.customPrompt || '');
                }
            } finally { setLoading(false); }
        })();
    }, []);

    const save = async () => {
        setSaving(true);
        setSaved(false);
        try {
            await api.post('/copilot/config', { customPrompt });
            setSaved(true);
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        } finally { setSaving(false); }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-3">
                    <div className="p-2 bg-primary/10 text-primary rounded-xl"><Bot className="w-6 h-6" /></div>
                    Copilot Settings
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Tune the in-app copilot for your workspace.
                </p>
            </div>

            {!enabled && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3 text-sm">
                    <Info className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                        <span className="font-semibold text-amber-400">Copilot is not enabled on your plan. </span>
                        <span className="text-muted-foreground">
                            Upgrade to a plan that includes the in-app copilot to use this feature.
                            Your custom prompt is saved and will kick in as soon as the plan allows it.
                        </span>
                    </div>
                </div>
            )}

            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                <div>
                    <h2 className="font-semibold">Workspace-specific rules</h2>
                    <p className="text-xs text-muted-foreground mt-1">
                        Appended after the platform base prompt. Use this to steer tone, language, or hard "never" rules.
                    </p>
                </div>
                <textarea value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
                    rows={12}
                    placeholder={"Examples:\n- Always answer in Russian.\n- Never delete a campaign — ask me first.\n- When creating agents, default the model to Claude Haiku for cost."}
                    className="w-full bg-secondary/30 border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y" />
                <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">Max 8,000 characters.</span>
                    <div className="flex items-center gap-3">
                        {saved && <span className="text-xs text-emerald-400">Saved.</span>}
                        <button onClick={save} disabled={saving}
                            className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-5 py-2 flex items-center gap-2 text-sm transition-all disabled:opacity-60">
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

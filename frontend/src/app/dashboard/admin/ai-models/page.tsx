"use client";

import { useEffect, useState } from "react";
import { Bot, Loader2, Plus, Trash2, Save, RotateCcw } from "lucide-react";
import api from "@/lib/api";
import UnsavedChangesBar from "@/components/UnsavedChangesBar";

type ProviderKey = "OPENAI" | "CLAUDE" | "GEMINI" | "GLM";
type ModelMap = Record<ProviderKey, string[]>;

const PROVIDERS: { key: ProviderKey; label: string; color: string }[] = [
    { key: "OPENAI", label: "OpenAI", color: "text-green-400 bg-green-500/10 border-green-500/30" },
    { key: "CLAUDE", label: "Anthropic Claude", color: "text-orange-400 bg-orange-500/10 border-orange-500/30" },
    { key: "GEMINI", label: "Google Gemini", color: "text-blue-400 bg-blue-500/10 border-blue-500/30" },
    { key: "GLM", label: "Z.ai (GLM)", color: "text-violet-400 bg-violet-500/10 border-violet-500/30" },
];

const EMPTY: ModelMap = { OPENAI: [], CLAUDE: [], GEMINI: [], GLM: [] };

export default function AdminAiModelsPage() {
    const [models, setModels] = useState<ModelMap>(EMPTY);
    const [original, setOriginal] = useState<ModelMap>(EMPTY);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [savedAt, setSavedAt] = useState<Date | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const r = await api.get('/ai-providers/models');
            if (r.data?.success) {
                const m: ModelMap = {
                    OPENAI: r.data.models?.OPENAI || [],
                    CLAUDE: r.data.models?.CLAUDE || [],
                    GEMINI: r.data.models?.GEMINI || [],
                    GLM: r.data.models?.GLM || [],
                };
                setModels(m);
                setOriginal(m);
            }
        } catch (e: any) {
            setError(e.response?.data?.message || e.message);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    const dirty = JSON.stringify(models) !== JSON.stringify(original);

    const addModel = (provider: ProviderKey, value: string) => {
        const v = value.trim();
        if (!v) return;
        if (models[provider].includes(v)) return;
        setModels({ ...models, [provider]: [...models[provider], v] });
    };

    const removeModel = (provider: ProviderKey, value: string) => {
        setModels({ ...models, [provider]: models[provider].filter(m => m !== value) });
    };

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            const r = await api.put('/admin/ai-models', { models });
            if (r.data?.success) {
                const next: ModelMap = {
                    OPENAI: r.data.models?.OPENAI || [],
                    CLAUDE: r.data.models?.CLAUDE || [],
                    GEMINI: r.data.models?.GEMINI || [],
                    GLM: r.data.models?.GLM || [],
                };
                setModels(next);
                setOriginal(next);
                setSavedAt(new Date());
            } else {
                setError(r.data?.message || 'Unknown error');
            }
        } catch (e: any) {
            setError(e.response?.data?.message || e.message);
        } finally {
            setSaving(false);
        }
    };

    const reset = () => setModels(original);

    if (loading) return (
        <div className="flex justify-center items-center h-96">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
    );

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-xl"><Bot className="w-6 h-6" /></div>
                        AI Models Catalogue
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Manages the model ids users can pick from when configuring an agent. Add or remove ids here — the agent settings dropdown updates for everyone on next load.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {dirty && (
                        <button onClick={reset} disabled={saving}
                            className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border hover:bg-secondary/40 transition-colors disabled:opacity-50">
                            <RotateCcw className="w-3.5 h-3.5" /> Reset
                        </button>
                    )}
                    <button onClick={save} disabled={!dirty || saving}
                        className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save changes
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-2 rounded-lg">
                    {error}
                </div>
            )}
            {savedAt && !dirty && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm px-4 py-2 rounded-lg">
                    Saved at {savedAt.toLocaleTimeString()}.
                </div>
            )}

            <div className="grid gap-4">
                {PROVIDERS.map(p => (
                    <ProviderCard
                        key={p.key}
                        providerKey={p.key}
                        label={p.label}
                        colorCls={p.color}
                        models={models[p.key]}
                        onAdd={v => addModel(p.key, v)}
                        onRemove={v => removeModel(p.key, v)} />
                ))}
            </div>

            <UnsavedChangesBar
                dirty={dirty}
                saving={saving}
                onSave={save}
                onDiscard={reset}
                label="Unsaved catalogue changes"
            />
        </div>
    );
}

function ProviderCard({ providerKey, label, colorCls, models, onAdd, onRemove }: {
    providerKey: ProviderKey;
    label: string;
    colorCls: string;
    models: string[];
    onAdd: (v: string) => void;
    onRemove: (v: string) => void;
}) {
    const [input, setInput] = useState("");

    const commit = () => {
        if (input.trim()) {
            onAdd(input.trim());
            setInput("");
        }
    };

    return (
        <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${colorCls}`}>
                    {label}
                </span>
                <span className="text-xs text-muted-foreground">{models.length} model{models.length === 1 ? '' : 's'}</span>
            </div>

            {/* Existing chips */}
            {models.length === 0 ? (
                <div className="text-sm text-muted-foreground italic mb-3">
                    No models yet — add at least one so users can pick this provider.
                </div>
            ) : (
                <div className="flex flex-wrap gap-1.5 mb-3">
                    {models.map(m => (
                        <span key={m} className="inline-flex items-center gap-1.5 text-xs font-mono bg-secondary/40 border border-border rounded-lg pl-2.5 pr-1 py-1">
                            {m}
                            <button onClick={() => onRemove(m)}
                                title={`Remove ${m}`}
                                className="text-muted-foreground hover:text-red-400 transition-colors p-0.5 rounded">
                                <Trash2 className="w-3 h-3" />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {/* Add new */}
            <div className="flex gap-2">
                <input type="text" value={input} onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
                    placeholder={
                        providerKey === 'OPENAI' ? 'e.g. gpt-5 / gpt-4o' :
                        providerKey === 'CLAUDE' ? 'e.g. claude-opus-4-7' :
                        'e.g. gemini-2.5-pro'
                    }
                    className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" />
                <button onClick={commit} disabled={!input.trim()}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-secondary/60 border border-border hover:bg-secondary transition-colors disabled:opacity-50">
                    <Plus className="w-3.5 h-3.5" /> Add
                </button>
            </div>
        </div>
    );
}

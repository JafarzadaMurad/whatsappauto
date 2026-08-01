"use client";

// Dedicated plan editor page. Left rail = section nav; right column =
// active section's fields. Replaces the old modal that tried to cram
// every field into one narrow scroll. Used by both /new and /[id]/edit
// route wrappers.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
    Info, Gauge, Coins, MessageSquare, Cpu, Phone,
    ChevronLeft, Loader2, CheckCircle2, Save, AlertCircle, Star,
} from "lucide-react";
import api from "@/lib/api";
import UnsavedChangesBar from "@/components/UnsavedChangesBar";

export type Plan = {
    id?: string;
    name: string;
    description?: string;
    price: number;
    currency: string;
    interval: "month" | "year";
    maxAgents: number;
    maxWhatsappAccounts: number;
    maxInstagramAccounts: number;
    maxAutomations: number;
    monthlyMessageLimit: number;
    monthlyCredits: number;
    allowCustomApiKeys: boolean;
    overageBehavior: "hard_block" | "top_up";
    copilotEnabled: boolean;
    copilotVoiceEnabled: boolean;
    copilotVoiceMultiplier: number;
    allowedModels: string[];
    allowedVoiceTranscribers: string[];
    allowedVoiceLlms: string[];
    allowedVoiceVoices: string[];
    isActive: boolean;
    isDefault?: boolean;
    trialDays?: number | null;
    stripePriceId?: string;
};

type ModelEntry = { provider: string; model: string; key: string };
type VoiceCatalog = {
    transcribers: { key: string; provider: string; model: string; label: string; costPerMin: number }[];
    llms: { key: string; provider: string; model: string; label: string; combinesSttTts: boolean; inCostPer1M: number; outCostPer1M: number }[];
    voices: { key: string; provider: string; voiceId: string; label: string; costPer1MChars: number }[];
    installedProviders: string[];
};

const SECTIONS = [
    { key: 'basics',   label: 'Basics',              icon: Info,           hint: 'Name, price, billing cadence, visibility.' },
    { key: 'limits',   label: 'Usage limits',        icon: Gauge,          hint: 'Max agents, accounts, automations, messages.' },
    { key: 'credits',  label: 'Credits & overage',   icon: Coins,          hint: 'Monthly cai pool, hard block vs top-up, BYOK.' },
    { key: 'copilot',  label: 'In-app copilot',      icon: MessageSquare,  hint: 'Chat / voice mode, credit multiplier.' },
    { key: 'ai',       label: 'AI models',           icon: Cpu,            hint: 'Text-LLM allow-list for agents + copilot.' },
    { key: 'voice',    label: 'Voice pipeline',      icon: Phone,          hint: 'Transcriber, Realtime LLM, TTS voice allow-lists.' },
] as const;
type SectionKey = typeof SECTIONS[number]['key'];

export const emptyPlan = (): Plan => ({
    name: "", description: "", price: 0, currency: "USD", interval: "month",
    maxAgents: 1, maxWhatsappAccounts: 1, maxInstagramAccounts: 1, maxAutomations: 1,
    monthlyMessageLimit: 1000,
    monthlyCredits: 10000, allowCustomApiKeys: false, overageBehavior: "hard_block",
    copilotEnabled: false, copilotVoiceEnabled: false, copilotVoiceMultiplier: 5.0,
    allowedModels: [],
    allowedVoiceTranscribers: [], allowedVoiceLlms: [], allowedVoiceVoices: [],
    isActive: true, isDefault: false, trialDays: 14, stripePriceId: "",
});

export function PlanEditor({ initial }: { initial: Plan }) {
    const router = useRouter();
    const [plan, setPlan] = useState<Plan>({
        // Ensure every array field is defined so `.includes` never blows up.
        ...emptyPlan(),
        ...initial,
        allowedModels: initial.allowedModels || [],
        allowedVoiceTranscribers: initial.allowedVoiceTranscribers || [],
        allowedVoiceLlms: initial.allowedVoiceLlms || [],
        allowedVoiceVoices: initial.allowedVoiceVoices || [],
    });
    const [section, setSection] = useState<SectionKey>('basics');
    const [saving, setSaving] = useState(false);
    const [savedAt, setSavedAt] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Snapshot of what's on the server, so "dirty" means genuinely
    // different rather than merely touched — clicking a toggle twice
    // shouldn't leave the save bar hanging around.
    const [baseline, setBaseline] = useState(() => JSON.stringify({
        ...emptyPlan(), ...initial,
        allowedModels: initial.allowedModels || [],
        allowedVoiceTranscribers: initial.allowedVoiceTranscribers || [],
        allowedVoiceLlms: initial.allowedVoiceLlms || [],
        allowedVoiceVoices: initial.allowedVoiceVoices || [],
    }));
    const dirty = JSON.stringify(plan) !== baseline;

    const [aiCatalog, setAiCatalog] = useState<ModelEntry[]>([]);
    const [voiceCatalog, setVoiceCatalog] = useState<VoiceCatalog>({ transcribers: [], llms: [], voices: [], installedProviders: [] });

    useEffect(() => {
        (async () => {
            try {
                const [m, v] = await Promise.all([
                    api.get('/plans/model-catalog').catch(() => null),
                    api.get('/plans/voice-catalog').catch(() => null),
                ]);
                if (m?.data?.success) setAiCatalog(m.data.flat || []);
                if (v?.data?.success) setVoiceCatalog({
                    transcribers: v.data.transcribers || [],
                    llms: v.data.llms || [],
                    voices: v.data.voices || [],
                    installedProviders: v.data.installedProviders || [],
                });
            } catch (e) { console.error(e); }
        })();
    }, []);

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            const payload = { ...plan };
            delete (payload as any)._count;
            if (plan.id) {
                await api.put(`/plans/${plan.id}`, payload);
            } else {
                const res = await api.post('/plans', payload);
                if (res.data.success && res.data.plan?.id) {
                    router.replace(`/dashboard/admin/plans/${res.data.plan.id}/edit`);
                }
            }
            setBaseline(JSON.stringify(plan));
            setSavedAt(Date.now());
        } catch (err: any) {
            setError(err.response?.data?.errors?.[0]?.message || err.response?.data?.message || err.message);
        } finally { setSaving(false); }
    };

    const discard = () => {
        if (!confirm('Discard your unsaved changes to this plan?')) return;
        setPlan(JSON.parse(baseline));
        setError(null);
    };

    return (
        <div className="max-w-6xl mx-auto space-y-4">
            {/* ─── Header ─── */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <button onClick={() => router.push('/dashboard/admin/plans')}
                        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div className="min-w-0">
                        <h1 className="text-xl sm:text-2xl font-bold truncate">
                            {plan.id ? plan.name || 'Untitled plan' : 'New plan'}
                        </h1>
                        <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                            {plan.id && <span>{plan.price} {plan.currency}/{plan.interval}</span>}
                            {plan.isDefault && (
                                <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-400 inline-flex items-center gap-1">
                                    <Star className="w-3 h-3 fill-current" /> Default
                                </span>
                            )}
                            {!plan.isActive && (
                                <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">Hidden</span>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {savedAt && !dirty && (
                        <span className="text-xs text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                        </span>
                    )}
                    <button onClick={save} disabled={saving || !plan.name.trim() || !dirty}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-5 py-2.5 flex items-center gap-2 text-sm transition-all disabled:opacity-60">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-500/5 border border-red-500/25 rounded-xl px-4 py-3 flex items-start gap-3 text-sm">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <span className="text-red-400/90">{error}</span>
                </div>
            )}

            {/* ─── Layout: left tabs / right content ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4 items-start">
                <nav className="bg-card border border-border rounded-2xl p-2 space-y-0.5 sticky top-4">
                    {SECTIONS.map(s => {
                        const Icon = s.icon;
                        const active = section === s.key;
                        return (
                            <button key={s.key} onClick={() => setSection(s.key)}
                                className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 text-sm transition-colors ${
                                    active ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                                }`}>
                                <Icon className="w-4 h-4 flex-shrink-0" />
                                <span className="truncate">{s.label}</span>
                            </button>
                        );
                    })}
                </nav>

                <div className="bg-card border border-border rounded-2xl p-5">
                    {section === 'basics' && <BasicsSection plan={plan} set={setPlan} />}
                    {section === 'limits' && <LimitsSection plan={plan} set={setPlan} />}
                    {section === 'credits' && <CreditsSection plan={plan} set={setPlan} />}
                    {section === 'copilot' && <CopilotSection plan={plan} set={setPlan} />}
                    {section === 'ai' && <AiModelsSection plan={plan} set={setPlan} catalog={aiCatalog} />}
                    {section === 'voice' && <VoiceSection plan={plan} set={setPlan} catalog={voiceCatalog} />}
                </div>
            </div>

            <UnsavedChangesBar
                dirty={dirty}
                saving={saving}
                onSave={save}
                onDiscard={discard}
                disabled={!plan.name.trim()}
                disabledReason={!plan.name.trim() ? 'Name is required' : undefined}
            />
        </div>
    );
}

// ─── Reusable field primitives ─────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="text-xs font-medium text-muted-foreground">{label}</label>
            <div className="mt-1">{children}</div>
            {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
        </div>
    );
}
function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
    return <input {...props}
        className={`w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 ${props.className || ''}`} />;
}
function NumInput({ value, onChange, ...rest }: { value: number; onChange: (n: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
    return <TextInput type="number" value={value}
        onChange={e => onChange(Number(e.target.value))} {...rest} />;
}
function Toggle({ checked, onChange, label, hint, disabled }: {
    checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean;
}) {
    return (
        <label className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
            disabled ? 'border-border opacity-50 cursor-not-allowed'
                : checked ? 'border-primary/40 bg-primary/5 cursor-pointer'
                : 'border-border cursor-pointer hover:bg-secondary/40'
        }`}>
            <input type="checkbox" checked={checked} disabled={disabled}
                onChange={e => onChange(e.target.checked)}
                className="w-4 h-4 accent-primary rounded mt-0.5" />
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{label}</div>
                {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
            </div>
        </label>
    );
}
function SectionHeader({ icon: Icon, title, hint }: { icon: any; title: string; hint: string }) {
    return (
        <div className="pb-3 mb-4 border-b border-border">
            <h2 className="font-semibold flex items-center gap-2">
                <Icon className="w-4 h-4 text-primary" /> {title}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">{hint}</p>
        </div>
    );
}

// ─── Sections ──────────────────────────────────────────────────────
function BasicsSection({ plan, set }: { plan: Plan; set: (p: Plan) => void }) {
    return (
        <div className="space-y-4">
            <SectionHeader icon={Info} title="Basics" hint="What subscribers see on the pricing page." />
            <Field label="Plan name">
                <TextInput value={plan.name} onChange={e => set({ ...plan, name: e.target.value })} placeholder="Pro" />
            </Field>
            <Field label="Description" hint="One-liner shown under the plan name on billing / pricing pages.">
                <textarea value={plan.description || ''} rows={2}
                    onChange={e => set({ ...plan, description: e.target.value })}
                    className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </Field>
            <div className="grid grid-cols-3 gap-3">
                <Field label="Price"><NumInput value={plan.price} onChange={n => set({ ...plan, price: n })} /></Field>
                <Field label="Currency"><TextInput value={plan.currency} onChange={e => set({ ...plan, currency: e.target.value })} /></Field>
                <Field label="Interval">
                    <select value={plan.interval} onChange={e => set({ ...plan, interval: e.target.value as any })}
                        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm">
                        <option value="month" className="bg-card">month</option>
                        <option value="year" className="bg-card">year</option>
                    </select>
                </Field>
            </div>

            {plan.price === 0 && (
                <Field label="Trial / free-period length (days, blank = no expiry)">
                    <TextInput type="number" min={0} value={plan.trialDays ?? ''}
                        onChange={e => set({ ...plan, trialDays: e.target.value === '' ? null : Number(e.target.value) })} />
                </Field>
            )}
            <Field label="Stripe Price ID (optional)"
                hint="Only fill when the plan is billed via Stripe subscription. Blank plans get free-tier treatment.">
                <TextInput value={plan.stripePriceId || ''}
                    onChange={e => set({ ...plan, stripePriceId: e.target.value })}
                    placeholder="price_..." />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <Toggle checked={plan.isActive} onChange={v => set({ ...plan, isActive: v })}
                    label="Active" hint="When off, hidden from the pricing page (existing subscribers keep it)." />
                <Toggle checked={!!plan.isDefault} disabled={plan.price > 0}
                    onChange={v => set({ ...plan, isDefault: v })}
                    label="Default plan"
                    hint={plan.price > 0 ? 'Only free plans (price 0) can be default.' : 'Auto-assigned to new sign-ups.'} />
            </div>
        </div>
    );
}

function LimitsSection({ plan, set }: { plan: Plan; set: (p: Plan) => void }) {
    const num = (label: string, key: keyof Plan) => (
        <Field label={label} hint="Use -1 for unlimited">
            <NumInput value={plan[key] as number} onChange={n => set({ ...plan, [key]: n })} />
        </Field>
    );
    return (
        <div className="space-y-4">
            <SectionHeader icon={Gauge} title="Usage limits" hint="Hard caps enforced on the create paths for each object." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {num('Max agents', 'maxAgents')}
                {num('Max automations', 'maxAutomations')}
                {num('Max WhatsApp accounts', 'maxWhatsappAccounts')}
                {num('Max Instagram accounts', 'maxInstagramAccounts')}
            </div>
            {num('Monthly message limit', 'monthlyMessageLimit')}
        </div>
    );
}

function CreditsSection({ plan, set }: { plan: Plan; set: (p: Plan) => void }) {
    const cost3x = (plan.monthlyCredits || 0) * 0.0001 / 3;
    const cost2x = (plan.monthlyCredits || 0) * 0.0001 / 2;
    const retail = (plan.monthlyCredits || 0) * 0.0001;
    const fmt = (n: number) => n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`;
    const profitable = plan.price > 0 && plan.price >= cost3x;
    const marginPct = plan.price > 0 ? Math.round(((plan.price - cost3x) / plan.price) * 100) : null;

    return (
        <div className="space-y-4">
            <SectionHeader icon={Coins} title="Credits & overage" hint="1 credit = $0.0001 retail. All AI calls draw from this monthly pool." />
            <Field label="Monthly credits" hint="Provisioned at the start of each billing cycle. Unspent credits do NOT roll over.">
                <NumInput value={plan.monthlyCredits} onChange={n => set({ ...plan, monthlyCredits: n })} />
            </Field>
            {plan.monthlyCredits > 0 && (
                <div className={`rounded-xl border p-3 text-xs space-y-2 ${
                    plan.price > 0 && !profitable ? 'bg-red-500/5 border-red-500/30' : 'bg-amber-500/5 border-amber-500/20'
                }`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-semibold flex items-center gap-1.5">
                            <Coins className="w-3.5 h-3.5 text-amber-400" />
                            {plan.monthlyCredits.toLocaleString()} credits = <span className="text-amber-400">{fmt(retail)}</span> retail value
                        </span>
                        {marginPct !== null && (
                            <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                                profitable ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                            }`}>{profitable ? `~${marginPct}% margin` : 'loss-making'}</span>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                        <div>
                            <div className="text-[10px] uppercase tracking-wide">Est. provider cost / {plan.interval}</div>
                            <div className="font-mono text-foreground">{fmt(cost3x)} <span className="text-[10px] text-muted-foreground">@ 3× margin</span></div>
                            <div className="font-mono text-muted-foreground text-[10px]">{fmt(cost2x)} @ 2× margin</div>
                        </div>
                        <div>
                            <div className="text-[10px] uppercase tracking-wide">Plan price</div>
                            <div className="font-mono text-foreground">{plan.price > 0 ? `${plan.price.toFixed(2)} ${plan.currency}` : 'free'}</div>
                            {plan.price > 0 && (
                                <div className="text-[10px] text-muted-foreground">
                                    {profitable ? `Covers real cost + ${fmt(plan.price - cost3x)} margin` : `Under real cost by ${fmt(cost3x - plan.price)}`}
                                </div>
                            )}
                        </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground pt-1 border-t border-border">
                        Tune per-model margin under <span className="text-primary">Admin → AI Pricing</span>.
                    </p>
                </div>
            )}
            <Field label="When credits run out">
                <select value={plan.overageBehavior}
                    onChange={e => set({ ...plan, overageBehavior: e.target.value as any })}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm">
                    <option value="hard_block" className="bg-card">Hard block (return 402)</option>
                    <option value="top_up" className="bg-card">Allow past zero (admin tops up manually)</option>
                </select>
            </Field>
            <Toggle checked={plan.allowCustomApiKeys}
                onChange={v => set({ ...plan, allowCustomApiKeys: v })}
                label="Allow bring-your-own API keys (BYOK)"
                hint="When on, workspaces can save their own provider keys — usage bypasses the credit meter." />
        </div>
    );
}

function CopilotSection({ plan, set }: { plan: Plan; set: (p: Plan) => void }) {
    return (
        <div className="space-y-4">
            <SectionHeader icon={MessageSquare} title="In-app copilot" hint="Chat bubble on every dashboard page. Voice mode uses the OpenAI Realtime API — expensive." />
            <Toggle checked={plan.copilotEnabled}
                onChange={v => set({ ...plan, copilotEnabled: v, copilotVoiceEnabled: v ? plan.copilotVoiceEnabled : false })}
                label="Enable chat copilot (text)"
                hint="Adds the assistant bubble on every dashboard page." />
            <Toggle checked={plan.copilotVoiceEnabled} disabled={!plan.copilotEnabled}
                onChange={v => set({ ...plan, copilotVoiceEnabled: v })}
                label="Enable voice mode (OpenAI Realtime)"
                hint="Adds hold-to-talk. Realtime API is ~10× the cost of text; guard with the multiplier below." />
            {plan.copilotVoiceEnabled && (
                <Field label="Voice credit multiplier" hint="Applied on top of the Realtime model rate. 5× default protects margin.">
                    <NumInput value={plan.copilotVoiceMultiplier} min={1} step={0.1}
                        onChange={n => set({ ...plan, copilotVoiceMultiplier: n })} />
                </Field>
            )}
        </div>
    );
}

function AiModelsSection({ plan, set, catalog }: { plan: Plan; set: (p: Plan) => void; catalog: ModelEntry[] }) {
    const grouped = useMemo(() => {
        const g: Record<string, ModelEntry[]> = {};
        for (const c of catalog) (g[c.provider] = g[c.provider] || []).push(c);
        return g;
    }, [catalog]);

    const toggle = (key: string) => {
        const on = plan.allowedModels.includes(key);
        set({ ...plan, allowedModels: on ? plan.allowedModels.filter(k => k !== key) : [...plan.allowedModels, key] });
    };

    return (
        <div className="space-y-4">
            <SectionHeader icon={Cpu} title="Allowed AI models"
                hint="Empty = allow every model in the AI Models Catalogue. Otherwise, only ticked models can be picked on this plan." />
            <div className="flex items-center gap-2">
                <button type="button" onClick={() => set({ ...plan, allowedModels: catalog.map(c => c.key) })}
                    className="text-[11px] px-2 py-1 rounded bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground">
                    Select all
                </button>
                <button type="button" onClick={() => set({ ...plan, allowedModels: [] })}
                    className="text-[11px] px-2 py-1 rounded bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground">
                    Clear (allow all)
                </button>
                <span className="text-[11px] text-muted-foreground ml-2">{plan.allowedModels.length}/{catalog.length} ticked</span>
            </div>
            {catalog.length === 0 ? (
                <div className="text-[11px] text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                    AI Models Catalogue is empty. Add models under Admin → AI Models first.
                </div>
            ) : (
                <div className="space-y-3">
                    {Object.entries(grouped).map(([provider, entries]) => (
                        <ProviderBucket key={provider} label={provider}
                            picked={entries.filter(e => plan.allowedModels.includes(e.key)).length}
                            total={entries.length}
                            entries={entries.map(e => ({ key: e.key, label: e.model, active: plan.allowedModels.includes(e.key) }))}
                            onToggle={toggle}
                            onSelectAll={() => set({ ...plan, allowedModels: Array.from(new Set([...plan.allowedModels, ...entries.map(e => e.key)])) })}
                            onClear={() => set({ ...plan, allowedModels: plan.allowedModels.filter(k => !entries.some(e => e.key === k)) })}
                        />
                    ))}
                </div>
            )}
            {plan.allowedModels.length === 0 && (
                <p className="text-[11px] text-muted-foreground italic">No models ticked — this plan currently allows every model in the catalogue.</p>
            )}
        </div>
    );
}

function VoiceSection({ plan, set, catalog }: { plan: Plan; set: (p: Plan) => void; catalog: VoiceCatalog }) {
    const installedSet = useMemo(() => new Set(catalog.installedProviders || []), [catalog.installedProviders]);
    const isInstalled = (p: string) => {
        // openai-realtime piggy-backs on openai's key; the backend
        // reports both when the key is set, but be defensive.
        if (p === 'openai-realtime') return installedSet.has('openai-realtime') || installedSet.has('openai');
        return installedSet.has(p);
    };

    // Only show entries whose provider has a platform key installed.
    // Grey pill at the top summarises what's hidden so the admin
    // isn't confused about missing providers.
    const filterInstalled = <T extends { provider: string }>(list: T[]) => list.filter(l => isInstalled(l.provider));
    const bucketize = <T extends { provider: string; key: string; label: string }>(list: T[]) => {
        const g: Record<string, T[]> = {};
        for (const c of list) (g[c.provider] = g[c.provider] || []).push(c);
        return g;
    };
    const transcriberGroups = useMemo(() => bucketize(filterInstalled(catalog.transcribers)), [catalog.transcribers, installedSet]);
    const llmGroups = useMemo(() => bucketize(filterInstalled(catalog.llms)), [catalog.llms, installedSet]);
    const voiceGroups = useMemo(() => bucketize(filterInstalled(catalog.voices)), [catalog.voices, installedSet]);

    const hiddenProviders = useMemo(() => {
        const all = new Set<string>();
        for (const t of catalog.transcribers) all.add(t.provider);
        for (const l of catalog.llms) all.add(l.provider);
        for (const v of catalog.voices) all.add(v.provider);
        return Array.from(all).filter(p => !isInstalled(p));
    }, [catalog, installedSet]);

    const totalPicked = plan.allowedVoiceTranscribers.length + plan.allowedVoiceLlms.length + plan.allowedVoiceVoices.length;

    const toggle = (field: 'allowedVoiceTranscribers' | 'allowedVoiceLlms' | 'allowedVoiceVoices', key: string) => {
        const on = plan[field].includes(key);
        set({ ...plan, [field]: on ? plan[field].filter(k => k !== key) : [...plan[field], key] });
    };

    const renderGroup = (
        title: string,
        subtitle: string,
        field: 'allowedVoiceTranscribers' | 'allowedVoiceLlms' | 'allowedVoiceVoices',
        groups: Record<string, { key: string; label: string; provider: string }[]>,
        available: number,
    ) => (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                    <div className="text-sm font-medium">{title}</div>
                    <div className="text-[11px] text-muted-foreground">{subtitle}</div>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-muted-foreground">{plan[field].length}/{available}</span>
                    <button type="button" onClick={() => set({ ...plan, [field]: Object.values(groups).flat().map(e => e.key) })}
                        className="px-2 py-1 rounded bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground">Select all</button>
                    <button type="button" onClick={() => set({ ...plan, [field]: [] })}
                        className="px-2 py-1 rounded bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground">Clear</button>
                </div>
            </div>
            {Object.keys(groups).length === 0 ? (
                <div className="text-[11px] text-muted-foreground italic px-1">No installed provider ships items in this category yet.</div>
            ) : (
                <div className="space-y-2">
                    {Object.entries(groups).map(([provider, entries]) => (
                        <ProviderBucket key={provider} label={provider}
                            picked={entries.filter(e => plan[field].includes(e.key)).length}
                            total={entries.length}
                            entries={entries.map(e => ({ key: e.key, label: e.label, active: plan[field].includes(e.key) }))}
                            onToggle={k => toggle(field, k)}
                            onSelectAll={() => set({ ...plan, [field]: Array.from(new Set([...plan[field], ...entries.map(e => e.key)])) })}
                            onClear={() => set({ ...plan, [field]: plan[field].filter(k => !entries.some(e => e.key === k)) })}
                        />
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <div className="space-y-6">
            <SectionHeader icon={Phone} title="Voice pipeline"
                hint="Restrict which STT / Realtime-LLM / TTS choices the workspace's Voice Assistants can pick. Empty list = allow every installed entry." />
            {hiddenProviders.length > 0 && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-[11px] text-muted-foreground">
                    <div className="font-medium text-amber-400/90 mb-0.5">Some voice providers are not installed yet</div>
                    Hidden until their key is set under <span className="text-primary">Admin → Platform Keys</span>:
                    <span className="ml-1 font-mono text-amber-400/80">{hiddenProviders.join(', ')}</span>.
                </div>
            )}
            {totalPicked === 0 && (
                <p className="text-[11px] text-muted-foreground italic bg-secondary/30 border border-border rounded-lg p-2">
                    All three lists are empty — the plan currently allows every installed voice-catalogue entry.
                </p>
            )}
            {renderGroup('Transcribers (STT)', 'Speech-to-text engine. Ignored when the LLM combines STT + TTS.',
                'allowedVoiceTranscribers', transcriberGroups, filterInstalled(catalog.transcribers).length)}
            <div className="h-px bg-border" />
            {renderGroup('Voice LLMs', 'Speech-to-speech models (Realtime) or discrete LLMs that pair with a transcriber + TTS.',
                'allowedVoiceLlms', llmGroups, filterInstalled(catalog.llms).length)}
            <div className="h-px bg-border" />
            {renderGroup('TTS voices', 'Voice used to speak assistant replies. Ignored for speech-to-speech LLMs.',
                'allowedVoiceVoices', voiceGroups, filterInstalled(catalog.voices).length)}
        </div>
    );
}

// Small reusable provider-bucket picker used by both AI + Voice sections.
function ProviderBucket({ label, entries, picked, total, onToggle, onSelectAll, onClear }: {
    label: string;
    entries: { key: string; label: string; active: boolean }[];
    picked: number; total: number;
    onToggle: (key: string) => void;
    onSelectAll: () => void;
    onClear: () => void;
}) {
    return (
        <div className="border border-border rounded-lg p-2.5 bg-secondary/20">
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
                <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-muted-foreground">{picked}/{total}</span>
                    <button type="button" onClick={onSelectAll} className="text-muted-foreground hover:text-foreground">all</button>
                    <span className="text-muted-foreground/50">·</span>
                    <button type="button" onClick={onClear} className="text-muted-foreground hover:text-foreground">none</button>
                </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {entries.map(e => (
                    <button key={e.key} type="button" onClick={() => onToggle(e.key)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono border transition-colors ${
                            e.active
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border text-muted-foreground hover:text-foreground hover:border-border/80'
                        }`}>
                        {e.active && <CheckCircle2 className="w-3 h-3" />}
                        {e.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

"use client";

// Admin plans — list view.
// Editing lives on a dedicated page per plan (`/admin/plans/[id]/edit`)
// with a tabbed sidebar. The list page just does at-a-glance browsing +
// quick actions (star = default, trash = delete, click card = edit).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    CreditCard, Loader2, Plus, Trash2, Pencil, Star, Coins,
    Phone, Bot, Users,
} from "lucide-react";
import api from "@/lib/api";

type Plan = {
    id: string;
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
    allowedVoiceTranscribers?: string[];
    allowedVoiceLlms?: string[];
    allowedVoiceVoices?: string[];
    isActive: boolean;
    isDefault?: boolean;
    trialDays?: number | null;
    stripePriceId?: string;
    _count?: { users: number };
};

export default function AdminPlansPage() {
    const router = useRouter();
    const [plans, setPlans] = useState<Plan[]>([]);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        try {
            const res = await api.get('/plans');
            if (res.data.success) setPlans(res.data.plans);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const toggleDefault = async (p: Plan, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!p.isDefault && p.price > 0) {
            alert(`"${p.name}" has a price of ${p.price} ${p.currency}. Only free plans (price 0) can be set as default.`);
            return;
        }
        try {
            if (p.isDefault) await api.delete(`/plans/${p.id}/default`);
            else await api.post(`/plans/${p.id}/default`, {});
            load();
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        }
    };

    const remove = async (p: Plan, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm(`Delete plan "${p.name}"?`)) return;
        try {
            await api.delete(`/plans/${p.id}`);
            load();
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-xl"><CreditCard className="w-6 h-6" /></div>
                        Subscription Plans
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">Create and manage the plans users can subscribe to. Click a plan to open the editor.</p>
                </div>
                <button onClick={() => router.push('/dashboard/admin/plans/new')}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-4 py-2.5 flex items-center gap-2 transition-all">
                    <Plus className="w-5 h-5" /> New Plan
                </button>
            </div>

            {plans.length === 0 ? (
                <div className="bg-card border border-dashed border-border rounded-2xl p-12 text-center text-muted-foreground">
                    No plans yet. Create your first plan.
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {plans.map(p => (
                        <Link key={p.id} href={`/dashboard/admin/plans/${p.id}/edit`}
                            className={`bg-card border rounded-2xl p-5 space-y-3 hover:border-primary/50 transition-colors block ${p.isDefault ? 'border-amber-400/60' : 'border-border'}`}>
                            <div className="flex items-start justify-between">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="font-semibold">{p.name}</h3>
                                        {p.isDefault && (
                                            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-400 border border-amber-400/30">Default</span>
                                        )}
                                    </div>
                                    <div className="text-2xl font-bold mt-1">
                                        {p.price} <span className="text-sm font-normal text-muted-foreground">{p.currency}/{p.interval}</span>
                                    </div>
                                    {p.price === 0 && p.trialDays != null && p.trialDays > 0 && (
                                        <div className="text-xs text-muted-foreground mt-0.5">expires after {p.trialDays} days</div>
                                    )}
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${p.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-secondary text-muted-foreground'}`}>
                                        {p.isActive ? 'Active' : 'Hidden'}
                                    </span>
                                    <button
                                        onClick={(e) => toggleDefault(p, e)}
                                        title={p.isDefault ? 'Default plan — click to remove' : (p.price > 0 ? 'Only free plans can be default' : 'Set as default for new sign-ups')}
                                        className={`p-1.5 rounded-lg transition-colors ${p.isDefault ? 'text-amber-400 bg-amber-400/10' : p.price > 0 ? 'text-muted-foreground/40 cursor-not-allowed' : 'text-muted-foreground hover:text-amber-400 hover:bg-amber-400/10'}`}>
                                        <Star className={`w-4 h-4 ${p.isDefault ? 'fill-current' : ''}`} />
                                    </button>
                                </div>
                            </div>
                            {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                            <ul className="text-xs text-muted-foreground space-y-1">
                                <li className="flex items-center gap-1.5">
                                    <Bot className="w-3 h-3" />
                                    Agents: {p.maxAgents < 0 ? '∞' : p.maxAgents} · Automations: {p.maxAutomations < 0 ? '∞' : p.maxAutomations}
                                </li>
                                <li>WhatsApp: {p.maxWhatsappAccounts < 0 ? '∞' : p.maxWhatsappAccounts} · Instagram: {p.maxInstagramAccounts < 0 ? '∞' : p.maxInstagramAccounts}</li>
                                <li className="flex items-center gap-1.5 font-semibold text-foreground">
                                    <Coins className="w-3.5 h-3.5 text-amber-400" />
                                    {(p.monthlyCredits || 0).toLocaleString()} credits / month
                                    {p.allowCustomApiKeys && <span className="text-emerald-400 font-normal text-xs"> · own-key OK</span>}
                                </li>
                                {p.copilotEnabled && <li className="text-blue-400 font-semibold">In-app copilot{p.copilotVoiceEnabled && <span> · voice ({p.copilotVoiceMultiplier}×)</span>}</li>}
                                {((p.allowedVoiceTranscribers?.length || 0) + (p.allowedVoiceLlms?.length || 0) + (p.allowedVoiceVoices?.length || 0)) > 0 && (
                                    <li className="flex items-center gap-1.5 text-purple-400">
                                        <Phone className="w-3 h-3" /> Voice pipeline restricted
                                    </li>
                                )}
                            </ul>
                            <div className="flex items-center justify-between pt-2 border-t border-border">
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Users className="w-3 h-3" /> {p._count?.users || 0} subscriber(s)
                                </span>
                                <div className="flex gap-1">
                                    <span className="p-1.5 rounded-lg text-muted-foreground group-hover:text-primary">
                                        <Pencil className="w-4 h-4" />
                                    </span>
                                    <button onClick={(e) => remove(p, e)}
                                        className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import {
    Send, Plus, Loader2, Trash2, X, Play, Pause,
    Sparkles, FileText, Image as ImageIcon, Users as UsersIcon, Timer,
    Calendar, Info, Bot, Phone,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";

const statusColors: Record<string, string> = {
    PENDING: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    RUNNING: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    PAUSED: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    COMPLETED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    FAILED: 'bg-red-500/10 text-red-400 border-red-500/20',
};

export default function CampaignsPage() {
    const router = useRouter();
    const [campaigns, setCampaigns] = useState<any[]>([]);
    const [agents, setAgents] = useState<any[]>([]);
    const [instances, setInstances] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const [formOpen, setFormOpen] = useState(false);

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        try {
            const [campRes, agentRes, instRes] = await Promise.all([
                api.get('/campaigns'),
                api.get('/agents'),
                api.get('/instances')
            ]);
            if (campRes.data.success) setCampaigns(campRes.data.campaigns);
            if (agentRes.data.success) setAgents(agentRes.data.agents.filter((a: any) => a.isActive !== false));
            if (instRes.data.success) setInstances(instRes.data.instances.filter((i: any) => i.status === 'CONNECTED'));
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this campaign?')) return;
        try { await api.delete(`/campaigns/${id}`); loadData(); } catch (err) { console.error(err); }
    };

    const handlePause = async (id: string) => {
        try { await api.post(`/campaigns/${id}/pause`); loadData(); } catch (err) { console.error(err); }
    };

    const handleResume = async (id: string) => {
        try { await api.post(`/campaigns/${id}/resume`); loadData(); } catch (err) { console.error(err); }
    };

    return (
        <div className="max-w-6xl mx-auto space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold">Campaigns</h1>
                    <p className="text-muted-foreground mt-1">Send outbound messages via AI agents</p>
                </div>
                <button onClick={() => setFormOpen(true)}
                    className="bg-primary text-primary-foreground px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 hover:bg-primary/90 transition-all active:scale-[0.98]">
                    <Plus className="w-5 h-5" /> New Campaign
                </button>
            </div>

            {/* Create Modal */}
            <AnimatePresence>
                {formOpen && (
                    <NewCampaignModal
                        agents={agents} instances={instances}
                        onClose={() => setFormOpen(false)}
                        onLaunched={() => { setFormOpen(false); loadData(); }} />
                )}
            </AnimatePresence>

            {/* Campaign List */}
            {loading ? (
                <div className="flex justify-center items-center h-48 border border-border border-dashed rounded-2xl">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
            ) : campaigns.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 border border-border border-dashed rounded-2xl bg-card/50 text-center">
                    <Send className="w-12 h-12 text-muted-foreground mb-3 opacity-50" />
                    <h3 className="text-lg font-medium">No Campaigns</h3>
                    <p className="text-muted-foreground text-sm mt-1">Create your first outbound campaign</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {campaigns.map(c => (
                        <div key={c.id} className="bg-card border border-border rounded-2xl p-5 hover:border-primary/30 transition-colors cursor-pointer"
                            onClick={() => router.push(`/dashboard/campaigns/${c.id}`)}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="p-2.5 bg-primary/10 text-primary rounded-xl"><Send className="w-5 h-5" /></div>
                                    <div>
                                        <h3 className="font-bold text-lg">{c.name}</h3>
                                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                            <span className={c.agent?.name ? '' : 'italic text-red-400/70'}>{c.agent?.name || '(agent deleted)'}</span>
                                            <span>&bull;</span>
                                            <span className={c.instance?.name ? '' : 'italic text-red-400/70'}>{c.instance?.name || '(number deleted)'}</span>
                                            <span>&bull;</span>
                                            <span>{c._count?.recipients || 0} recipients</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    {/* Status counts */}
                                    <div className="flex items-center gap-2 text-xs">
                                        {c.statusCounts?.SENT > 0 && <span className="text-emerald-400">{c.statusCounts.SENT} sent</span>}
                                        {c.statusCounts?.REPLIED > 0 && <span className="text-purple-400">{c.statusCounts.REPLIED} replied</span>}
                                        {c.statusCounts?.PENDING > 0 && <span className="text-yellow-400">{c.statusCounts.PENDING} pending</span>}
                                        {c.statusCounts?.FAILED > 0 && <span className="text-red-400">{c.statusCounts.FAILED} failed</span>}
                                    </div>

                                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${statusColors[c.status] || ''}`}>
                                        {c.status}
                                    </span>

                                    {c.status === 'RUNNING' && (
                                        <button onClick={e => { e.stopPropagation(); handlePause(c.id); }} className="p-2 hover:bg-secondary rounded-lg text-muted-foreground" title="Pause">
                                            <Pause className="w-4 h-4" />
                                        </button>
                                    )}
                                    {c.status === 'PAUSED' && (
                                        <button onClick={e => { e.stopPropagation(); handleResume(c.id); }} className="p-2 hover:bg-secondary rounded-lg text-muted-foreground" title="Resume">
                                            <Play className="w-4 h-4" />
                                        </button>
                                    )}
                                    <button onClick={e => { e.stopPropagation(); handleDelete(c.id); }} className="p-2 hover:bg-destructive/10 rounded-lg text-destructive" title="Delete">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── New Campaign Modal ────────────────────────────────────────────
type Agent = { id: string; name: string };
type Instance = { id: string; name: string };

function NewCampaignModal({ agents, instances, onClose, onLaunched }: {
    agents: Agent[];
    instances: Instance[];
    onClose: () => void;
    onLaunched: () => void;
}) {
    // Form state
    const [name, setName] = useState("");
    const [agentId, setAgentId] = useState("");
    const [instanceId, setInstanceId] = useState(instances[0]?.id || "");
    const [phones, setPhones] = useState("");

    const [mode, setMode] = useState<'ai_compose' | 'fixed_template'>('ai_compose');
    const [messageTemplate, setMessageTemplate] = useState("");
    const [mediaUrl, setMediaUrl] = useState("");
    const [mediaType, setMediaType] = useState<'' | 'image' | 'video' | 'document' | 'audio'>('');

    const [minDelaySec, setMinDelaySec] = useState(10);
    const [maxDelaySec, setMaxDelaySec] = useState(15);
    const [skipExisting, setSkipExisting] = useState(false);
    const [scheduleLater, setScheduleLater] = useState(false);
    const [scheduledFor, setScheduledFor] = useState("");

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const phoneList = useMemo(
        () => phones.split(/[\n,]+/).map(p => p.trim()).filter(Boolean),
        [phones]
    );

    const disabled = submitting
        || !name.trim()
        || !agentId
        || !instanceId
        || phoneList.length === 0
        || (mode === 'fixed_template' && !messageTemplate.trim())
        || (!!mediaUrl && !mediaType);

    const launch = async () => {
        setSubmitting(true);
        setError(null);
        try {
            const payload: any = {
                name: name.trim(),
                agentId, instanceId,
                phoneNumbers: phoneList,
                mode,
                minDelaySec, maxDelaySec,
                skipExisting,
            };
            if (mode === 'fixed_template') payload.messageTemplate = messageTemplate.trim();
            if (mediaUrl.trim()) {
                payload.mediaUrl = mediaUrl.trim();
                payload.mediaType = mediaType || undefined;
            }
            if (scheduleLater && scheduledFor) payload.scheduledFor = new Date(scheduledFor).toISOString();

            await api.post('/campaigns', payload);
            onLaunched();
        } catch (err: any) {
            setError(err.response?.data?.errors?.[0]?.message || err.response?.data?.message || err.message);
        } finally { setSubmitting(false); }
    };

    // Estimated total time to send the whole batch.
    const avgDelay = (minDelaySec + maxDelaySec) / 2;
    const totalSec = phoneList.length > 1 ? Math.round((phoneList.length - 1) * avgDelay) : 0;
    const totalHuman = totalSec >= 3600
        ? `${(totalSec / 3600).toFixed(1)} h`
        : totalSec >= 60 ? `${Math.round(totalSec / 60)} min` : `${totalSec} s`;

    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={e => e.target === e.currentTarget && onClose()}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <div>
                        <h2 className="text-lg font-semibold flex items-center gap-2"><Send className="w-4 h-4 text-primary" /> New Campaign</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">Outbound WhatsApp blast — pick the sender, the message, the pace.</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-secondary rounded-lg"><X className="w-4 h-4" /></button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-5">
                    {error && (
                        <div className="text-xs bg-red-500/10 border border-red-500/25 text-red-400 rounded-lg px-3 py-2">{error}</div>
                    )}

                    {/* ─── Basics ─── */}
                    <Section icon={Send} title="Basics">
                        <Field label="Campaign name">
                            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Product Launch"
                                className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                        </Field>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Field label={<span className="flex items-center gap-1.5"><Bot className="w-3 h-3" /> AI Agent</span>}>
                                {agents.length === 0 ? (
                                    <div className="bg-amber-500/5 border border-amber-500/25 rounded-lg px-3 py-2 text-xs text-amber-400 flex items-center justify-between gap-2">
                                        <span>No agents yet</span>
                                        <Link href="/dashboard/agents" className="text-primary hover:underline">Create →</Link>
                                    </div>
                                ) : (
                                    <select value={agentId} onChange={e => setAgentId(e.target.value)}
                                        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm">
                                        <option value="" disabled className="bg-card">Select agent</option>
                                        {agents.map(a => <option key={a.id} value={a.id} className="bg-card">{a.name}</option>)}
                                    </select>
                                )}
                            </Field>
                            <Field label={<span className="flex items-center gap-1.5"><Phone className="w-3 h-3" /> WhatsApp instance</span>}>
                                {instances.length === 0 ? (
                                    <div className="bg-amber-500/5 border border-amber-500/25 rounded-lg px-3 py-2 text-xs text-amber-400 flex items-center justify-between gap-2">
                                        <span>No connected instance</span>
                                        <Link href="/dashboard/whatsapp" className="text-primary hover:underline">Link →</Link>
                                    </div>
                                ) : (
                                    <select value={instanceId} onChange={e => setInstanceId(e.target.value)}
                                        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm">
                                        <option value="" disabled className="bg-card">Select instance</option>
                                        {instances.map(i => <option key={i.id} value={i.id} className="bg-card">{i.name}</option>)}
                                    </select>
                                )}
                            </Field>
                        </div>
                    </Section>

                    {/* ─── Message ─── */}
                    <Section icon={FileText} title="Message">
                        <div className="grid grid-cols-2 gap-2">
                            <button type="button" onClick={() => setMode('ai_compose')}
                                className={`p-3 rounded-lg border text-left transition-colors ${mode === 'ai_compose' ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary/40'}`}>
                                <div className="text-sm font-medium flex items-center gap-1.5">
                                    <Sparkles className="w-3.5 h-3.5 text-primary" /> AI-composed
                                </div>
                                <div className="text-[11px] text-muted-foreground mt-0.5">Agent writes the opener for each recipient.</div>
                            </button>
                            <button type="button" onClick={() => setMode('fixed_template')}
                                className={`p-3 rounded-lg border text-left transition-colors ${mode === 'fixed_template' ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary/40'}`}>
                                <div className="text-sm font-medium flex items-center gap-1.5">
                                    <FileText className="w-3.5 h-3.5 text-primary" /> Fixed template
                                </div>
                                <div className="text-[11px] text-muted-foreground mt-0.5">Same message to everyone. Variables allowed. No LLM cost.</div>
                            </button>
                        </div>
                        {mode === 'fixed_template' && (
                            <Field label="Template text" hint="Placeholders: {{name}} (from Clients if matched, else 'there'), {{phone}}">
                                <textarea value={messageTemplate} onChange={e => setMessageTemplate(e.target.value)}
                                    rows={4} placeholder={"Hi {{name}}! Just letting you know about our new offer..."}
                                    className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm resize-none" />
                                <div className="text-[10px] text-muted-foreground mt-1">{messageTemplate.length} / 4096 chars</div>
                            </Field>
                        )}
                        <div className="pt-1">
                            <Field label={<span className="flex items-center gap-1.5"><ImageIcon className="w-3 h-3" /> Media (optional)</span>}
                                hint="Public URL to attach an image / video / audio / document. Text becomes the caption.">
                                <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
                                    <input value={mediaUrl} onChange={e => setMediaUrl(e.target.value)}
                                        placeholder="https://example.com/promo.jpg"
                                        className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                                    <select value={mediaType} onChange={e => setMediaType(e.target.value as any)}
                                        disabled={!mediaUrl.trim()}
                                        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm disabled:opacity-50">
                                        <option value="" className="bg-card">— type —</option>
                                        <option value="image" className="bg-card">Image</option>
                                        <option value="video" className="bg-card">Video</option>
                                        <option value="audio" className="bg-card">Audio</option>
                                        <option value="document" className="bg-card">Document</option>
                                    </select>
                                </div>
                            </Field>
                        </div>
                    </Section>

                    {/* ─── Recipients ─── */}
                    <Section icon={UsersIcon} title="Recipients">
                        <Field label="Phone numbers"
                            hint={`E.164 preferred (e.g. 994551234567). One per line or comma-separated.`}>
                            <textarea value={phones} onChange={e => setPhones(e.target.value)} rows={4}
                                placeholder={"994551234567\n994701234567"}
                                className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm font-mono resize-none" />
                            <div className="text-[11px] text-muted-foreground mt-1">
                                {phoneList.length} number{phoneList.length === 1 ? '' : 's'}
                            </div>
                        </Field>
                        <label className="flex items-start gap-2 p-2.5 rounded-lg border border-border cursor-pointer hover:bg-secondary/40">
                            <input type="checkbox" checked={skipExisting}
                                onChange={e => setSkipExisting(e.target.checked)}
                                className="w-4 h-4 accent-primary mt-0.5" />
                            <div>
                                <div className="text-sm font-medium">Skip numbers already in conversation</div>
                                <div className="text-[11px] text-muted-foreground">Don't message people this instance has spoken with before.</div>
                            </div>
                        </label>
                    </Section>

                    {/* ─── Delivery ─── */}
                    <Section icon={Timer} title="Delivery">
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Min delay (s)" hint="Between messages">
                                <input type="number" min={1} max={3600} value={minDelaySec}
                                    onChange={e => setMinDelaySec(Math.max(1, Number(e.target.value)))}
                                    className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                            </Field>
                            <Field label="Max delay (s)">
                                <input type="number" min={minDelaySec} max={3600} value={maxDelaySec}
                                    onChange={e => setMaxDelaySec(Math.max(minDelaySec, Number(e.target.value)))}
                                    className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                            </Field>
                        </div>
                        {phoneList.length > 1 && (
                            <div className="bg-secondary/30 border border-border rounded-lg p-2.5 text-[11px] text-muted-foreground flex items-center gap-1.5">
                                <Info className="w-3 h-3" /> Estimated total send time: <span className="font-mono text-foreground">~{totalHuman}</span>
                            </div>
                        )}
                        <label className="flex items-start gap-2 p-2.5 rounded-lg border border-border cursor-pointer hover:bg-secondary/40">
                            <input type="checkbox" checked={scheduleLater}
                                onChange={e => setScheduleLater(e.target.checked)}
                                className="w-4 h-4 accent-primary mt-0.5" />
                            <div className="flex-1">
                                <div className="text-sm font-medium flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Schedule for later</div>
                                <div className="text-[11px] text-muted-foreground">Otherwise the first message goes out immediately.</div>
                            </div>
                        </label>
                        {scheduleLater && (
                            <Field label="Start at">
                                <input type="datetime-local" value={scheduledFor}
                                    onChange={e => setScheduledFor(e.target.value)}
                                    className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm" />
                            </Field>
                        )}
                    </Section>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 p-4 border-t border-border">
                    <button onClick={onClose}
                        className="px-4 py-2 text-sm text-muted-foreground hover:bg-secondary rounded-lg">Cancel</button>
                    <button onClick={launch} disabled={disabled}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg px-5 py-2 text-sm flex items-center gap-2 disabled:opacity-60">
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        {scheduleLater && scheduledFor ? 'Schedule campaign' : 'Launch campaign'}
                    </button>
                </div>
            </motion.div>
        </motion.div>
    );
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
    return (
        <div className="bg-secondary/10 border border-border rounded-xl p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Icon className="w-3 h-3 text-primary" /> {title}
            </div>
            {children}
        </div>
    );
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
            {children}
            {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
        </div>
    );
}

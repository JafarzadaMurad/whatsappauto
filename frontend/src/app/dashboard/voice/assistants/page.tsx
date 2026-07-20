"use client";

// Voice Assistants list — analogous to /dashboard/ai/agents but for
// phone-call-facing assistants. Each row summarises the three-component
// pipeline (transcriber · LLM · voice) plus how many phone numbers and
// calls it has handled, mirroring the summary strip in Vapi's list view.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Phone, Loader2, Plus, Mic, Volume2, Cpu, PhoneCall as PhoneCallIcon, Trash2 } from "lucide-react";
import api from "@/lib/api";

type Assistant = {
    id: string;
    name: string;
    isPublished: boolean;
    transcriberProvider: string;
    transcriberModel: string;
    llmProvider: string;
    llmModel: string;
    ttsProvider: string;
    ttsVoiceId: string;
    createdAt: string;
    updatedAt: string;
    _count?: { phoneNumbers: number; calls: number };
};

export default function VoiceAssistantsPage() {
    const router = useRouter();
    const [rows, setRows] = useState<Assistant[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);

    const load = async () => {
        try {
            const res = await api.get('/voice/assistants');
            if (res.data.success) setRows(res.data.assistants);
        } finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const create = async () => {
        setCreating(true);
        try {
            const res = await api.post('/voice/assistants', {
                name: `Voice assistant ${rows.length + 1}`,
                systemPrompt: 'You are a helpful phone assistant. Speak in short, natural sentences (1-2 lines max).',
            });
            if (res.data.success) router.push(`/dashboard/voice/assistants/${res.data.assistant.id}`);
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
            setCreating(false);
        }
    };

    const remove = async (id: string, name: string) => {
        if (!confirm(`Delete voice assistant "${name}"?`)) return;
        try {
            await api.delete(`/voice/assistants/${id}`);
            load();
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        }
    };

    if (loading) return (
        <div className="flex justify-center items-center h-96"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
    );

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-xl"><Phone className="w-6 h-6" /></div>
                        Voice Assistants
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Phone-call agents. Pick a transcriber, model, and voice — each priced independently. Bind to a phone number to answer inbound calls.
                    </p>
                </div>
                <button onClick={create} disabled={creating}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-4 py-2.5 flex items-center gap-2 transition-all disabled:opacity-60">
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Create Assistant
                </button>
            </div>

            {rows.length === 0 ? (
                <div className="bg-card border border-dashed border-border rounded-2xl p-12 text-center space-y-4">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary">
                        <Phone className="w-7 h-7" />
                    </div>
                    <div>
                        <p className="font-semibold">No voice assistants yet</p>
                        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                            Create your first phone-call agent. You can start from a preset (Balanced, High Intelligence, Ultra Fast, Cost Saver) or configure every component manually.
                        </p>
                    </div>
                    <button onClick={create} disabled={creating}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-4 py-2.5 inline-flex items-center gap-2">
                        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Create your first assistant
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {rows.map(a => (
                        <Link key={a.id} href={`/dashboard/voice/assistants/${a.id}`}
                            className="bg-card border border-border hover:border-primary/40 hover:bg-secondary/20 rounded-2xl p-4 space-y-3 group transition-all">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${a.isPublished ? 'bg-emerald-500/15 text-emerald-400' : 'bg-secondary text-muted-foreground'}`}>
                                        <Phone className="w-5 h-5" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="font-semibold truncate">{a.name}</div>
                                        <div className="text-[11px] text-muted-foreground">
                                            {a._count?.phoneNumbers || 0} number{a._count?.phoneNumbers === 1 ? '' : 's'} · {a._count?.calls || 0} call{a._count?.calls === 1 ? '' : 's'}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    {a.isPublished && (
                                        <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">Live</span>
                                    )}
                                    <button onClick={e => { e.preventDefault(); e.stopPropagation(); remove(a.id, a.name); }}
                                        className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs">
                                <div className="bg-secondary/30 rounded-lg p-2">
                                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                        <Mic className="w-3 h-3" /> STT
                                    </div>
                                    <div className="font-mono text-[10px] truncate mt-0.5">{a.transcriberProvider}/{a.transcriberModel}</div>
                                </div>
                                <div className="bg-secondary/30 rounded-lg p-2">
                                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                        <Cpu className="w-3 h-3" /> LLM
                                    </div>
                                    <div className="font-mono text-[10px] truncate mt-0.5">{a.llmProvider}/{a.llmModel}</div>
                                </div>
                                <div className="bg-secondary/30 rounded-lg p-2">
                                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                        <Volume2 className="w-3 h-3" /> Voice
                                    </div>
                                    <div className="font-mono text-[10px] truncate mt-0.5">{a.ttsProvider}/{a.ttsVoiceId}</div>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}

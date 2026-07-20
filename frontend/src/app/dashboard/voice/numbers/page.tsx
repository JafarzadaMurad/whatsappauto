"use client";

// Phone numbers page — provision (search + buy from Twilio inventory),
// import (bind an existing Twilio number you already own via SID), or
// assign an existing number to a Voice Assistant. Twilio credentials
// live under Admin → Platform Keys (TWILIO_ACCOUNT_SID / _AUTH_TOKEN)
// so the operator here just picks a number.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    Phone, Loader2, Plus, Search, Import, Trash2, Bot,
    CheckCircle2, X, ChevronRight,
} from "lucide-react";
import api from "@/lib/api";

type PhoneNumber = {
    id: string;
    number: string;
    provider: string;
    providerSid: string | null;
    isActive: boolean;
    createdAt: string;
    voiceAssistant?: { id: string; name: string } | null;
    _count?: { calls: number };
};

type Assistant = { id: string; name: string };

type SearchResult = {
    number: string;
    friendlyName: string;
    locality: string | null;
    region: string | null;
    postalCode: string | null;
    capabilities: { voice: boolean; SMS: boolean; MMS: boolean };
};

export default function PhoneNumbersPage() {
    const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
    const [assistants, setAssistants] = useState<Assistant[]>([]);
    const [loading, setLoading] = useState(true);
    const [showBuy, setShowBuy] = useState(false);
    const [showImport, setShowImport] = useState(false);

    const load = async () => {
        try {
            const [n, a] = await Promise.all([
                api.get('/voice/numbers'),
                api.get('/voice/assistants'),
            ]);
            if (n.data.success) setNumbers(n.data.numbers);
            if (a.data.success) setAssistants(a.data.assistants);
        } finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const assign = async (id: string, voiceAssistantId: string | null) => {
        try {
            await api.put(`/voice/numbers/${id}`, { voiceAssistantId });
            load();
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        }
    };

    const release = async (id: string, number: string) => {
        if (!confirm(`Release ${number}? This frees the number on Twilio (billing stops) and deletes the local row.`)) return;
        try {
            await api.delete(`/voice/numbers/${id}`);
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
                        Phone Numbers
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Numbers bound to Voice Assistants for inbound calls. Buy from Twilio's inventory or import a number you already own.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setShowImport(true)}
                        className="bg-secondary/70 hover:bg-secondary border border-border rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm font-medium">
                        <Import className="w-4 h-4" /> Import
                    </button>
                    <button onClick={() => setShowBuy(true)}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-4 py-2.5 flex items-center gap-2">
                        <Plus className="w-4 h-4" /> Buy Number
                    </button>
                </div>
            </div>

            {numbers.length === 0 ? (
                <div className="bg-card border border-dashed border-border rounded-2xl p-12 text-center space-y-4">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary">
                        <Phone className="w-7 h-7" />
                    </div>
                    <div>
                        <p className="font-semibold">No phone numbers yet</p>
                        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                            Buy a new number from Twilio's inventory, or import an existing one by SID. You'll need Twilio credentials set under Admin → Platform Keys.
                        </p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {numbers.map(n => (
                        <div key={n.id} className="bg-card border border-border rounded-2xl p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${n.isActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-secondary text-muted-foreground'}`}>
                                        <Phone className="w-5 h-5" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="font-mono font-semibold truncate">{n.number}</div>
                                        <div className="text-[11px] text-muted-foreground">
                                            {n.provider} · {n._count?.calls || 0} call{n._count?.calls === 1 ? '' : 's'}
                                        </div>
                                    </div>
                                </div>
                                <button onClick={() => release(n.id, n.number)}
                                    className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                            <div>
                                <label className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                                    <Bot className="w-3 h-3" /> Assigned assistant
                                </label>
                                <select value={n.voiceAssistant?.id || ''}
                                    onChange={e => assign(n.id, e.target.value || null)}
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm">
                                    <option value="" className="bg-card">— none (inbound calls will hear "not assigned")</option>
                                    {assistants.map(a => (
                                        <option key={a.id} value={a.id} className="bg-card">{a.name}</option>
                                    ))}
                                </select>
                                {n.voiceAssistant && (
                                    <Link href={`/dashboard/voice/assistants/${n.voiceAssistant.id}`}
                                        className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5 mt-1">
                                        Edit assistant <ChevronRight className="w-3 h-3" />
                                    </Link>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {showBuy && <BuyModal onClose={() => setShowBuy(false)} onBought={load} assistants={assistants} />}
            {showImport && <ImportModal onClose={() => setShowImport(false)} onImported={load} assistants={assistants} />}
        </div>
    );
}

// ─── Buy modal ─────────────────────────────────────────────────────
function BuyModal({ onClose, onBought, assistants }: { onClose: () => void; onBought: () => void; assistants: Assistant[] }) {
    const [country, setCountry] = useState('US');
    const [areaCode, setAreaCode] = useState('');
    const [contains, setContains] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [buying, setBuying] = useState<string | null>(null);
    const [assignTo, setAssignTo] = useState<string>('');

    const search = async () => {
        setSearching(true);
        try {
            const res = await api.post('/voice/numbers/search', { country, areaCode: areaCode || undefined, contains: contains || undefined });
            if (res.data.success) setResults(res.data.numbers);
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        } finally { setSearching(false); }
    };

    const buy = async (number: string) => {
        setBuying(number);
        try {
            await api.post('/voice/numbers/buy', { phoneNumber: number, voiceAssistantId: assignTo || undefined });
            onBought();
            onClose();
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        } finally { setBuying(null); }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-border flex items-center justify-between">
                    <h3 className="font-semibold flex items-center gap-2"><Search className="w-4 h-4" /> Buy a phone number</h3>
                    <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="p-4 space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className="text-xs text-muted-foreground">Country</label>
                            <select value={country} onChange={e => setCountry(e.target.value)}
                                className="mt-1 w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm">
                                {['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'NL', 'AZ', 'TR', 'RU'].map(c =>
                                    <option key={c} value={c} className="bg-card">{c}</option>
                                )}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground">Area code (opt)</label>
                            <input value={areaCode} onChange={e => setAreaCode(e.target.value)}
                                placeholder="212"
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground">Contains digits (opt)</label>
                            <input value={contains} onChange={e => setContains(e.target.value)}
                                placeholder="777"
                                className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Assign to assistant (optional)</label>
                        <select value={assignTo} onChange={e => setAssignTo(e.target.value)}
                            className="mt-1 w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm">
                            <option value="" className="bg-card">— assign later</option>
                            {assistants.map(a => <option key={a.id} value={a.id} className="bg-card">{a.name}</option>)}
                        </select>
                    </div>
                    <button onClick={search} disabled={searching}
                        className="w-full bg-secondary/70 hover:bg-secondary border border-border rounded-lg px-3 py-2 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                        {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                        Search Twilio inventory
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 pt-0 space-y-1">
                    {results.map(r => (
                        <button key={r.number} onClick={() => buy(r.number)} disabled={!!buying}
                            className="w-full text-left bg-secondary/20 hover:bg-secondary/40 rounded-xl p-3 flex items-center gap-3 group disabled:opacity-60">
                            <div className="flex-1 min-w-0">
                                <div className="font-mono font-semibold">{r.number}</div>
                                <div className="text-[11px] text-muted-foreground truncate">
                                    {r.locality || r.region || '—'}
                                    {r.capabilities.voice && ' · voice'}
                                    {r.capabilities.SMS && ' · SMS'}
                                    {r.capabilities.MMS && ' · MMS'}
                                </div>
                            </div>
                            {buying === r.number
                                ? <Loader2 className="w-4 h-4 animate-spin text-primary" />
                                : <span className="text-xs font-medium text-primary opacity-0 group-hover:opacity-100">Buy →</span>}
                        </button>
                    ))}
                    {!searching && results.length === 0 && (
                        <div className="text-center py-8 text-xs text-muted-foreground">Search to see available numbers.</div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Import modal ──────────────────────────────────────────────────
function ImportModal({ onClose, onImported, assistants }: { onClose: () => void; onImported: () => void; assistants: Assistant[] }) {
    const [providerSid, setProviderSid] = useState('');
    const [assignTo, setAssignTo] = useState('');
    const [importing, setImporting] = useState(false);

    const doImport = async () => {
        setImporting(true);
        try {
            await api.post('/voice/numbers/import', { providerSid, voiceAssistantId: assignTo || undefined });
            onImported();
            onClose();
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        } finally { setImporting(false); }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-md p-4 space-y-3" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h3 className="font-semibold flex items-center gap-2"><Import className="w-4 h-4" /> Import existing Twilio number</h3>
                    <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <p className="text-xs text-muted-foreground">
                    Paste the number's Twilio SID (starts with <code className="bg-secondary px-1 rounded">PN...</code>). We'll re-wire the voice webhook so calls land here.
                </p>
                <div>
                    <label className="text-xs text-muted-foreground">Twilio Phone Number SID</label>
                    <input value={providerSid} onChange={e => setProviderSid(e.target.value)}
                        placeholder="PNxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
                <div>
                    <label className="text-xs text-muted-foreground">Assign to assistant (optional)</label>
                    <select value={assignTo} onChange={e => setAssignTo(e.target.value)}
                        className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-2 text-sm">
                        <option value="" className="bg-card">— assign later</option>
                        {assistants.map(a => <option key={a.id} value={a.id} className="bg-card">{a.name}</option>)}
                    </select>
                </div>
                <button onClick={doImport} disabled={importing || !providerSid.trim()}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-3 py-2 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                    {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Import number
                </button>
            </div>
        </div>
    );
}

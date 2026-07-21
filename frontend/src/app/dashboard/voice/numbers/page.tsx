"use client";

// Phone numbers page — provision (search + buy from Twilio inventory),
// import (bind an existing Twilio number you already own via SID), or
// assign an existing number to a Voice Assistant. Twilio credentials
// are BYOK per workspace: the first Buy/Import prompts for SID + Auth
// Token, we verify + persist them on the workspace, and every
// subsequent call reuses the stored creds.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    Phone, Loader2, Plus, Search, Import, Trash2, Bot,
    CheckCircle2, X, ChevronRight, KeyRound, PhoneOutgoing, AlertCircle,
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

type TwilioStatus = { configured: boolean; accountSidTail: string | null };

export default function PhoneNumbersPage() {
    const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
    const [assistants, setAssistants] = useState<Assistant[]>([]);
    const [twilio, setTwilio] = useState<TwilioStatus>({ configured: false, accountSidTail: null });
    const [loading, setLoading] = useState(true);
    const [showBuy, setShowBuy] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [outboundOn, setOutboundOn] = useState<PhoneNumber | null>(null);

    const load = async () => {
        try {
            const [n, a, t] = await Promise.all([
                api.get('/voice/numbers'),
                api.get('/voice/assistants'),
                api.get('/voice/twilio/status'),
            ]);
            if (n.data.success) setNumbers(n.data.numbers);
            if (a.data.success) setAssistants(a.data.assistants);
            if (t.data.success) setTwilio({ configured: !!t.data.configured, accountSidTail: t.data.accountSidTail || null });
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

    const disconnect = async () => {
        if (!confirm('Disconnect this workspace\'s Twilio credentials? You\'ll need to enter them again on the next Buy/Import.')) return;
        try {
            await api.delete('/voice/twilio');
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
                        Numbers bound to Voice Assistants. Buy from Twilio's inventory or import a number you already own.
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

            {/* Twilio credentials banner */}
            {twilio.configured ? (
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs">
                        <div className="p-1 bg-emerald-500/15 text-emerald-400 rounded-md"><CheckCircle2 className="w-3.5 h-3.5" /></div>
                        <span className="text-emerald-400/90">Twilio account connected</span>
                        {twilio.accountSidTail && (
                            <span className="text-muted-foreground">· ending in <span className="font-mono">…{twilio.accountSidTail}</span></span>
                        )}
                    </div>
                    <button onClick={disconnect} className="text-[11px] text-muted-foreground hover:text-red-400">
                        Disconnect
                    </button>
                </div>
            ) : (
                <div className="bg-amber-500/5 border border-amber-500/25 rounded-xl px-4 py-3 flex items-start gap-3">
                    <div className="p-1.5 bg-amber-500/15 text-amber-400 rounded-md mt-0.5"><AlertCircle className="w-4 h-4" /></div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-amber-400/90">Bring your own Twilio account</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            You'll be asked for your Twilio Account SID + Auth Token the first time you buy or import a number.
                            Per-minute call charges land on <em>your</em> Twilio bill. We only use the credentials to provision numbers and route calls.
                        </p>
                    </div>
                </div>
            )}

            {numbers.length === 0 ? (
                <div className="bg-card border border-dashed border-border rounded-2xl p-12 text-center space-y-4">
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary">
                        <Phone className="w-7 h-7" />
                    </div>
                    <div>
                        <p className="font-semibold">No phone numbers yet</p>
                        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                            Buy a new number from Twilio's inventory, or import an existing one by SID.
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
                                <div className="flex items-center gap-1">
                                    <button onClick={() => setOutboundOn(n)}
                                        disabled={!n.voiceAssistant}
                                        title={n.voiceAssistant ? 'Place a test call' : 'Assign an assistant first'}
                                        className="p-1.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground">
                                        <PhoneOutgoing className="w-3.5 h-3.5" />
                                    </button>
                                    <button onClick={() => release(n.id, n.number)}
                                        className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
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

            {showBuy && <BuyModal onClose={() => setShowBuy(false)} onBought={load} assistants={assistants} needsCreds={!twilio.configured} />}
            {showImport && <ImportModal onClose={() => setShowImport(false)} onImported={load} assistants={assistants} needsCreds={!twilio.configured} />}
            {outboundOn && <OutboundModal onClose={() => setOutboundOn(null)} number={outboundOn} />}
        </div>
    );
}

// ─── Twilio credentials fields — inline block shown at the top of ───
// ─── the Buy + Import modals when the workspace has no creds yet. ───
function TwilioCredsFields({ sid, setSid, token, setToken }: {
    sid: string; setSid: (v: string) => void; token: string; setToken: (v: string) => void;
}) {
    return (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-400/90">
                <KeyRound className="w-3.5 h-3.5" /> Twilio credentials (one-time)
            </div>
            <p className="text-[11px] text-muted-foreground">
                Grab them from your Twilio console → Account → API keys & tokens. Saved to your workspace so we don't ask again.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                    <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Account SID</label>
                    <input value={sid} onChange={e => setSid(e.target.value)}
                        placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-2 py-1.5 text-sm font-mono" />
                </div>
                <div>
                    <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Auth Token</label>
                    <input value={token} onChange={e => setToken(e.target.value)}
                        type="password"
                        placeholder="••••••••••••••••••••••••••••••••"
                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-2 py-1.5 text-sm font-mono" />
                </div>
            </div>
        </div>
    );
}

// ─── Buy modal ─────────────────────────────────────────────────────
function BuyModal({ onClose, onBought, assistants, needsCreds }: { onClose: () => void; onBought: () => void; assistants: Assistant[]; needsCreds: boolean }) {
    const [country, setCountry] = useState('US');
    const [areaCode, setAreaCode] = useState('');
    const [contains, setContains] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [buying, setBuying] = useState<string | null>(null);
    const [assignTo, setAssignTo] = useState<string>('');
    const [sid, setSid] = useState('');
    const [token, setToken] = useState('');

    const credsPayload = () => needsCreds
        ? { accountSid: sid.trim(), authToken: token.trim() }
        : undefined;

    const search = async () => {
        if (needsCreds && (!sid.trim() || !token.trim())) {
            alert('Enter Twilio Account SID + Auth Token to search inventory.');
            return;
        }
        setSearching(true);
        try {
            const res = await api.post('/voice/numbers/search', {
                country, areaCode: areaCode || undefined, contains: contains || undefined,
                credentials: credsPayload(),
            });
            if (res.data.success) setResults(res.data.numbers);
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        } finally { setSearching(false); }
    };

    const buy = async (number: string) => {
        setBuying(number);
        try {
            await api.post('/voice/numbers/buy', {
                phoneNumber: number,
                voiceAssistantId: assignTo || undefined,
                credentials: credsPayload(),
            });
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
                    {needsCreds && <TwilioCredsFields sid={sid} setSid={setSid} token={token} setToken={setToken} />}
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
function ImportModal({ onClose, onImported, assistants, needsCreds }: { onClose: () => void; onImported: () => void; assistants: Assistant[]; needsCreds: boolean }) {
    const [providerSid, setProviderSid] = useState('');
    const [assignTo, setAssignTo] = useState('');
    const [importing, setImporting] = useState(false);
    const [sid, setSid] = useState('');
    const [token, setToken] = useState('');

    const doImport = async () => {
        if (needsCreds && (!sid.trim() || !token.trim())) {
            alert('Enter Twilio Account SID + Auth Token to import a number.');
            return;
        }
        setImporting(true);
        try {
            await api.post('/voice/numbers/import', {
                providerSid, voiceAssistantId: assignTo || undefined,
                credentials: needsCreds ? { accountSid: sid.trim(), authToken: token.trim() } : undefined,
            });
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
                {needsCreds && <TwilioCredsFields sid={sid} setSid={setSid} token={token} setToken={setToken} />}
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

// ─── Outbound (Test Call) modal ────────────────────────────────────
function OutboundModal({ onClose, number }: { onClose: () => void; number: PhoneNumber }) {
    const [to, setTo] = useState('');
    const [dialing, setDialing] = useState(false);
    const [callSid, setCallSid] = useState<string | null>(null);

    const dial = async () => {
        if (!to.trim()) { alert('Enter a destination number in E.164 format (e.g. +14155551234).'); return; }
        setDialing(true);
        try {
            const res = await api.post(`/voice/numbers/${number.id}/outbound`, { toNumber: to.trim() });
            if (res.data.success) setCallSid(res.data.callSid);
        } catch (err: any) {
            alert(err.response?.data?.message || err.message);
        } finally { setDialing(false); }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-md p-4 space-y-3" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h3 className="font-semibold flex items-center gap-2"><PhoneOutgoing className="w-4 h-4" /> Place a test call</h3>
                    <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <p className="text-xs text-muted-foreground">
                    Twilio will dial from <span className="font-mono">{number.number}</span> — the assistant <em>{number.voiceAssistant?.name}</em> answers as soon as the callee picks up.
                </p>
                <div>
                    <label className="text-xs text-muted-foreground">Destination number (E.164)</label>
                    <input value={to} onChange={e => setTo(e.target.value)}
                        placeholder="+14155551234"
                        className="mt-1 w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
                {callSid ? (
                    <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-lg p-3 text-xs">
                        <div className="font-medium text-emerald-400/90 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Call initiated
                        </div>
                        <div className="text-muted-foreground mt-1 font-mono break-all">{callSid}</div>
                        <p className="text-muted-foreground mt-2">Watch the Call History page to follow it live.</p>
                    </div>
                ) : (
                    <button onClick={dial} disabled={dialing || !to.trim()}
                        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-3 py-2 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                        {dialing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneOutgoing className="w-4 h-4" />}
                        Dial
                    </button>
                )}
            </div>
        </div>
    );
}

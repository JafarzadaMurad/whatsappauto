"use client";

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Router as RouterIcon, Trash2, Smartphone, Loader2, QrCode, Bot, X, GitBranch, Stethoscope, CheckCircle2, AlertCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import api from "@/lib/api";
import type { Socket } from "socket.io-client";
import { createSocket } from "@/lib/socket";

interface Instance {
    id: string;
    name: string;
    status: string;
    createdAt: string;
    agentId?: string | null;
    agent?: any;
    routerAgentId?: string | null;
    routerAgent?: any;
}

export default function WhatsAppPage() {
    const [instances, setInstances] = useState<Instance[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newInstanceName, setNewInstanceName] = useState("");
    const [activeQr, setActiveQr] = useState<{ id: string; qrUrl: string } | null>(null);
    const [diagnoseId, setDiagnoseId] = useState<string | null>(null);
    const [agents, setAgents] = useState<any[]>([]);
    const [updatingAgent, setUpdatingAgent] = useState<string | null>(null);
    const socketRef = useRef<Socket | null>(null);

    const fetchData = async () => {
        try {
            const [instRes, agentsRes] = await Promise.all([
                api.get('/instances'),
                api.get('/agents')
            ]);
            if (instRes.data.success) setInstances(instRes.data.instances);
            if (agentsRes.data.success) setAgents(agentsRes.data.agents);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    useEffect(() => {
        fetchData();

        const socket = createSocket();
        socketRef.current = socket;

        return () => { socket.disconnect(); };
    }, []);

    // Attach socket listeners per instance
    useEffect(() => {
        const socket = socketRef.current;
        if (!socket) return;

        const qrHandlers: Record<string, (qr: string) => void> = {};
        const statusHandlers: Record<string, (status: string) => void> = {};

        instances.forEach(inst => {
            qrHandlers[inst.id] = (qrData: string) => {
                setActiveQr({ id: inst.id, qrUrl: qrData });
            };
            statusHandlers[inst.id] = (status: string) => {
                setInstances(prev => prev.map(i => i.id === inst.id ? { ...i, status } : i));
                if (status === 'CONNECTED') {
                    setActiveQr(prev => prev?.id === inst.id ? null : prev);
                }
            };

            socket.on(`qr-${inst.id}`, qrHandlers[inst.id]);
            socket.on(`status-${inst.id}`, statusHandlers[inst.id]);
        });

        return () => {
            instances.forEach(inst => {
                socket.off(`qr-${inst.id}`, qrHandlers[inst.id]);
                socket.off(`status-${inst.id}`, statusHandlers[inst.id]);
            });
        };
    }, [instances.map(i => i.id).join(',')]);

    // Poll the REST /qr endpoint until the instance flips to
    // CONNECTED (or a 5-minute wall-clock). Belt-and-braces alongside
    // the socket listener — the socket race (listener attached AFTER
    // Baileys already emitted the first QR OR the CONNECTED event)
    // is what causes both the "QR gəlmir" and "modal bağlanmır,
    // status connecting qalır" bugs on a fresh instance. When we see
    // CONNECTED we close the modal ourselves and patch the list row
    // so the UI doesn't wait for a page refresh.
    const pollForQr = async (instanceId: string) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < 5 * 60_000) {
            try {
                const r = await api.get(`/instances/${instanceId}/qr`);
                if (r.data?.status === 'CONNECTED') {
                    setActiveQr(prev => prev?.id === instanceId ? null : prev);
                    setInstances(prev => prev.map(i => i.id === instanceId ? { ...i, status: 'CONNECTED' } : i));
                    return;
                }
                if (r.data?.qr) {
                    // Keep polling — the user still has to scan and
                    // we want to close the modal ourselves once the
                    // pairing completes, socket message or not.
                    setActiveQr(prev => (prev?.id === instanceId && prev.qrUrl === r.data.qr) ? prev : { id: instanceId, qrUrl: r.data.qr });
                }
            } catch (err: any) {
                // 404 = the instance was deleted (or belongs to another
                // workspace after a switch). Stop immediately — the old
                // catch-all kept hammering the endpoint for the full
                // 5 minutes and flooded the console with 404s.
                if (err?.response?.status === 404 || err?.response?.status === 403) {
                    setActiveQr(prev => prev?.id === instanceId ? null : prev);
                    return;
                }
                /* transient error — keep polling */
            }
            await new Promise(r => setTimeout(r, 1500));
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newInstanceName) return;
        // Ask BEFORE creating so the freshly-spawned Baileys session boots
        // with the right syncFullHistory flag — otherwise the first link
        // happens with the default (off) and the user sees an empty inbox.
        const wantsHistory = window.confirm(
            'Sync existing chats from your phone?\n\n' +
            'OK: import the recent chat history from the phone right after you scan the QR. The inbox will show existing conversations immediately.\n\n' +
            'Cancel: capture only new messages from now on.'
        );
        setCreating(true);
        try {
            const res = await api.post('/instances', { name: newInstanceName });
            if (res.data.success) {
                const inst = res.data.instance;
                // Persist the choice before the QR appears so the next
                // (re)connection picks the right Baileys options.
                if (wantsHistory) {
                    try { await api.put(`/instances/${inst.id}`, { syncHistory: true }); } catch { /* ignore */ }
                    // Restart so the live session re-spawns with syncFullHistory=true.
                    try { await api.post(`/instances/${inst.id}/restart`); } catch { /* ignore */ }
                }
                setInstances(prev => [inst, ...prev]);
                setNewInstanceName("");
                // Kick the REST poll immediately — don't wait for
                // React to re-render and attach the socket listener.
                pollForQr(inst.id);
            }
        } catch (err) { console.error(err); }
        finally { setCreating(false); }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this instance?')) return;
        try {
            // First attempt — backend reports linked campaigns without deleting.
            await api.delete(`/instances/${id}`);
            setInstances(prev => prev.filter(i => i.id !== id));
            if (activeQr?.id === id) setActiveQr(null);
        } catch (err: any) {
            // 409 with requiresConfirmation = there are dependent campaigns.
            const body = err?.response?.data;
            if (err?.response?.status === 409 && body?.requiresConfirmation) {
                const list = (body.campaigns || []).map((c: any) => `• ${c.name} (${c.status})`).join('\n');
                const proceed = confirm(
                    `${body.message}\n\nLinked campaigns:\n${list}\n\nDelete this instance anyway?`
                );
                if (!proceed) return;
                try {
                    await api.delete(`/instances/${id}?force=true`);
                    setInstances(prev => prev.filter(i => i.id !== id));
                    if (activeQr?.id === id) setActiveQr(null);
                } catch (e: any) {
                    alert(e?.response?.data?.message || e.message);
                }
                return;
            }
            alert(body?.message || err.message || 'Delete failed');
        }
    };

    const handleLink = async (id: string) => {
        // Ask the user whether to pull existing chat history off the phone.
        // confirm() returns true for OK ("Yes, sync"), false for Cancel ("No, only new").
        const wantsHistory = window.confirm(
            'Sync existing chats from your phone?\n\n' +
            'OK: import recent chat history right after scanning the QR (slower on first link, but you immediately see existing conversations in the inbox).\n\n' +
            'Cancel: only capture new messages going forward.'
        );
        try {
            // Persist the choice on the instance, then start the link flow.
            await api.put(`/instances/${id}`, { syncHistory: wantsHistory });
            await api.post(`/instances/${id}/restart`);
            // Belt-and-braces: REST poll for the QR alongside the
            // socket listener. Socket alone drops the very first QR
            // on races we can't fully close from the client.
            pollForQr(id);
        } catch (err) { console.error(err); }
    };

    const handleLinkAgent = async (instanceId: string, agentId: string) => {
        setUpdatingAgent(instanceId);
        try {
            await api.put(`/instances/${instanceId}`, { agentId: agentId || null });
            setInstances(prev => prev.map(i => i.id === instanceId ? { ...i, agentId: agentId || null, agent: agents.find(a => a.id === agentId) } : i));
        } catch (err) { console.error(err); }
        finally { setUpdatingAgent(null); }
    };

    const handleLinkRouter = async (instanceId: string, routerAgentId: string) => {
        setUpdatingAgent(instanceId);
        try {
            await api.put(`/instances/${instanceId}`, { routerAgentId: routerAgentId || null });
            setInstances(prev => prev.map(i => i.id === instanceId ? { ...i, routerAgentId: routerAgentId || null, routerAgent: agents.find(a => a.id === routerAgentId) } : i));
        } catch (err) { console.error(err); }
        finally { setUpdatingAgent(null); }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-8">
            <div>
                <h1 className="text-3xl font-bold">WhatsApp Instances</h1>
                <p className="text-muted-foreground mt-1">Manage your connected WhatsApp numbers</p>
            </div>

            {/* QR Code Modal */}
            <AnimatePresence>
                {activeQr && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                        onClick={() => setActiveQr(null)}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="bg-card border border-border rounded-2xl p-8 shadow-2xl flex flex-col items-center"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between w-full mb-6">
                                <h3 className="text-lg font-semibold">Scan QR Code</h3>
                                <button onClick={() => setActiveQr(null)} className="p-1.5 hover:bg-secondary rounded-lg">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <p className="text-sm text-muted-foreground mb-4">Open WhatsApp on your phone &gt; Linked Devices &gt; Link a Device</p>
                            <div className="bg-white p-4 rounded-2xl shadow-xl">
                                <img src={activeQr.qrUrl} alt="QR Code" className="w-56 h-56 object-contain" />
                            </div>
                            <p className="text-xs text-muted-foreground mt-4">QR code refreshes automatically</p>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="grid lg:grid-cols-3 gap-8">
                {/* Create Form */}
                <div className="lg:col-span-1">
                    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm sticky top-8">
                        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                            <Plus className="w-5 h-5 text-primary" /> New Instance
                        </h2>
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div>
                                <label className="text-sm font-medium text-muted-foreground">Instance Name</label>
                                <input type="text" required placeholder="e.g. Sales Team" value={newInstanceName}
                                    onChange={e => setNewInstanceName(e.target.value)}
                                    className="mt-1 w-full bg-secondary/50 border border-border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50" />
                            </div>
                            <button type="submit" disabled={creating}
                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl px-4 py-2.5 flex items-center justify-center gap-2 disabled:opacity-70">
                                {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Create Instance'}
                            </button>
                        </form>
                    </div>
                </div>

                {/* Instance List */}
                <div className="lg:col-span-2 space-y-4">
                    {loading ? (
                        <div className="flex items-center justify-center h-48 border border-border border-dashed rounded-2xl">
                            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : instances.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-48 border border-border border-dashed rounded-2xl bg-card/50 text-center">
                            <Smartphone className="w-12 h-12 text-muted-foreground mb-3 opacity-50" />
                            <h3 className="text-lg font-medium">No instances</h3>
                            <p className="text-muted-foreground text-sm mt-1">Create an instance and scan QR to link WhatsApp</p>
                        </div>
                    ) : (
                        instances.map(inst => (
                            <motion.div key={inst.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                                className="bg-card border border-border rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <div className={`p-3 rounded-xl ${inst.status === 'CONNECTED' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-secondary text-muted-foreground'}`}>
                                        <RouterIcon className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold">{inst.name}</h3>
                                        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                                            <span className="flex items-center gap-1.5">
                                                <span className={`w-2 h-2 rounded-full ${inst.status === 'CONNECTED' ? 'bg-emerald-500' : inst.status === 'CONNECTING' ? 'bg-amber-500 animate-pulse' : 'bg-destructive'}`} />
                                                {inst.status}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 flex-wrap">
                                    {/* Unified handler picker — one slot per channel.
                                        Pick either a regular AI agent OR a router agent.
                                        Selecting one clears the other on the server side,
                                        and 'None' means the channel is intentionally
                                        idle (no AI replies, even for previously bound
                                        contacts). */}
                                    {(() => {
                                        const current = inst.routerAgentId
                                            ? `r:${inst.routerAgentId}`
                                            : (inst.agentId ? `a:${inst.agentId}` : '');
                                        const onPick = (val: string) => {
                                            if (!val) {
                                                handleLinkAgent(inst.id, '');
                                                handleLinkRouter(inst.id, '');
                                            } else if (val.startsWith('r:')) {
                                                handleLinkAgent(inst.id, '');
                                                handleLinkRouter(inst.id, val.slice(2));
                                            } else if (val.startsWith('a:')) {
                                                handleLinkRouter(inst.id, '');
                                                handleLinkAgent(inst.id, val.slice(2));
                                            }
                                        };
                                        const isRouter = !!inst.routerAgentId;
                                        const accent = isRouter
                                            ? 'bg-amber-500/5 border-amber-500/30'
                                            : (inst.agentId ? 'bg-primary/5 border-primary/30' : 'bg-secondary/30 border-border');
                                        return (
                                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${accent}`}
                                                title="Pick the AI agent or router that handles this channel">
                                                {updatingAgent === inst.id
                                                    ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                                                    : isRouter
                                                        ? <GitBranch className="w-4 h-4 text-amber-400" />
                                                        : <Bot className={`w-4 h-4 ${inst.agentId ? 'text-primary' : 'text-muted-foreground'}`} />}
                                                <select value={current} disabled={updatingAgent === inst.id}
                                                    onChange={e => onPick(e.target.value)}
                                                    className="bg-transparent text-sm font-medium focus:outline-none min-w-[180px] max-w-[220px] truncate">
                                                    <option value="" className="bg-card text-foreground">— None (channel idle) —</option>
                                                    {agents.filter(a => !a.isRouter).map(a => (
                                                        <option key={a.id} value={`a:${a.id}`} className="bg-card text-foreground">
                                                            🤖 AI · {a.name}
                                                        </option>
                                                    ))}
                                                    {agents.filter(a => a.isRouter).map(a => (
                                                        <option key={a.id} value={`r:${a.id}`} className="bg-card text-foreground">
                                                            🔀 Router · {a.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        );
                                    })()}

                                    {inst.status === 'CONNECTED' ? (
                                        <>
                                            <Link href={`/dashboard/instances/${inst.id}`}
                                                className="px-3 py-1.5 text-primary hover:bg-primary/10 rounded-xl text-sm font-medium transition-colors">
                                                Chat
                                            </Link>
                                            <button onClick={() => setDiagnoseId(inst.id)}
                                                title="Check why a message didn't arrive"
                                                className="flex items-center gap-1.5 px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-xl text-sm font-medium transition-colors">
                                                <Stethoscope className="w-4 h-4" /> Diagnose
                                            </button>
                                        </>
                                    ) : (
                                        <button onClick={() => handleLink(inst.id)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-primary hover:bg-primary/10 rounded-xl text-sm font-medium transition-colors">
                                            <QrCode className="w-4 h-4" /> Link
                                        </button>
                                    )}

                                    <button onClick={() => handleDelete(inst.id)}
                                        className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </motion.div>
                        ))
                    )}
                </div>
            </div>

            {diagnoseId && (
                <DiagnoseModal instanceId={diagnoseId} onClose={() => setDiagnoseId(null)} />
            )}
        </div>
    );
}

// ─── Number diagnostics ────────────────────────────────────────────
// Answers "I sent a message and it never arrived". Reports whether the
// number is on WhatsApp, which JID we'd address it by, and offers a
// session reset for the case where the contact's devices changed and
// our cached encryption state went stale.
type DiagReport = {
    input: string;
    digits: string;
    pnJid: string;
    registered: boolean | null;
    lid: string | null;
    wouldSendTo: string;
    onWhatsApp?: any;
    onWhatsAppError?: string;
    lidError?: string;
};

function DiagnoseModal({ instanceId, onClose }: { instanceId: string; onClose: () => void }) {
    const [phone, setPhone] = useState('');
    const [checking, setChecking] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [report, setReport] = useState<DiagReport | null>(null);
    const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

    const check = async () => {
        if (!phone.trim()) return;
        setChecking(true); setNote(null); setReport(null);
        try {
            const r = await api.get(`/instances/${instanceId}/check-number`, { params: { phone: phone.trim() } });
            if (r.data?.success) setReport(r.data.report);
        } catch (err: any) {
            setNote({ ok: false, text: err.response?.data?.message || err.message });
        } finally { setChecking(false); }
    };

    const resetContact = async () => {
        if (!report) return;
        if (!confirm(`Drop cached encryption sessions for ${report.digits}?\n\nHarmless — the next message simply re-negotiates. Use this when a contact reinstalled WhatsApp, switched to the Business app, or changed linked devices.`)) return;
        setResetting(true); setNote(null);
        try {
            const r = await api.post(`/instances/${instanceId}/reset-contact`, { phone: report.digits });
            setNote({ ok: true, text: r.data?.message || 'Sessions cleared.' });
        } catch (err: any) {
            setNote({ ok: false, text: err.response?.data?.message || err.message });
        } finally { setResetting(false); }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-lg p-5 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="font-semibold flex items-center gap-2">
                            <Stethoscope className="w-4 h-4 text-primary" /> Diagnose a number
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Check why a message to a specific number didn't arrive.
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex gap-2">
                    <input value={phone} onChange={e => setPhone(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && check()}
                        placeholder="994551234567"
                        className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm font-mono" />
                    <button onClick={check} disabled={checking || !phone.trim()}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2 disabled:opacity-60">
                        {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Stethoscope className="w-4 h-4" />}
                        Check
                    </button>
                </div>

                {note && (
                    <div className={`text-xs rounded-lg px-3 py-2 flex items-start gap-2 ${
                        note.ok
                            ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400'
                            : 'bg-red-500/10 border border-red-500/25 text-red-400'
                    }`}>
                        {note.ok ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
                        <span>{note.text}</span>
                    </div>
                )}

                {report && (
                    <div className="space-y-3">
                        <div className={`rounded-lg px-3 py-2.5 text-sm flex items-start gap-2 ${
                            report.registered === false
                                ? 'bg-red-500/10 border border-red-500/25 text-red-400'
                                : report.registered
                                    ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400'
                                    : 'bg-amber-500/10 border border-amber-500/25 text-amber-400'
                        }`}>
                            {report.registered === false
                                ? <><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>Not registered on WhatsApp. Check the country code and that there's no leading zero.</span></>
                                : report.registered
                                    ? <><CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>Registered on WhatsApp.</span></>
                                    : <><AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>Couldn't verify — {report.onWhatsAppError || 'lookup failed'}.</span></>}
                        </div>

                        <div className="bg-secondary/30 border border-border rounded-lg p-3 space-y-1.5 text-xs">
                            <Row label="Phone JID" value={report.pnJid} />
                            <Row label="LID mapping" value={report.lid || '— none cached —'} />
                            <Row label="Would send to" value={report.wouldSendTo} strong />
                        </div>

                        <div className="bg-secondary/20 border border-border rounded-lg p-3 space-y-2">
                            <p className="text-[11px] text-muted-foreground">
                                If the number is registered but messages still don't arrive, the cached
                                encryption session is likely stale — that happens when the contact
                                reinstalls WhatsApp, moves to the Business app, or changes linked
                                devices. Clearing it forces a fresh key exchange on the next message.
                            </p>
                            <button onClick={resetContact} disabled={resetting}
                                className="w-full bg-secondary/60 hover:bg-secondary border border-border rounded-lg px-3 py-2 text-xs font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                                {resetting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                                Reset encryption session for this contact
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground flex-shrink-0">{label}</span>
            <span className={`font-mono text-right break-all ${strong ? 'text-foreground font-semibold' : ''}`}>{value}</span>
        </div>
    );
}

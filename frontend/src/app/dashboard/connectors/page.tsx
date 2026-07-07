"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Blocks, Calendar, Check, Loader2, Unplug, X, ChevronDown } from "lucide-react";
import api from "@/lib/api";

type CalendarItem = { id: string; summary: string; primary?: boolean };
type GoogleStatus = {
    connected: boolean;
    email: string | null;
    calendarId: string | null;
    scopes: string | null;
    updatedAt: string | null;
};

export default function ConnectorsPage() {
    const search = useSearchParams();
    const router = useRouter();
    const [status, setStatus] = useState<GoogleStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [banner, setBanner] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);
    const [calendars, setCalendars] = useState<CalendarItem[] | null>(null);
    const [pickingCalendar, setPickingCalendar] = useState(false);
    const [savingCalendar, setSavingCalendar] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const r = await api.get('/google/oauth/status');
            if (r.data?.success) setStatus(r.data);
        } catch { /* ignore */ }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    // Show the callback outcome as a top banner and clean the query so a
    // refresh doesn't repeat the message.
    useEffect(() => {
        const outcome = search.get('googleConnect');
        if (!outcome) return;
        if (outcome === 'ok') {
            const email = search.get('email') || '';
            setBanner({ kind: 'ok', message: `Google Calendar connected${email ? ` as ${email}` : ''}.` });
        } else {
            const err = search.get('error') || 'connection failed';
            setBanner({ kind: 'error', message: `Could not connect Google Calendar — ${err}.` });
        }
        router.replace('/dashboard/connectors');
    }, [search, router]);

    const connect = async () => {
        setConnecting(true);
        try {
            const r = await api.get('/google/oauth/authorize', { params: { returnTo: '/dashboard/connectors' } });
            if (r.data?.url) window.location.href = r.data.url;
            else setBanner({ kind: 'error', message: r.data?.message || 'Could not start OAuth flow.' });
        } catch (e: any) {
            setBanner({ kind: 'error', message: e?.response?.data?.message || e.message || 'Connect failed.' });
        } finally {
            setConnecting(false);
        }
    };

    const disconnect = async () => {
        if (!confirm('Disconnect Google Calendar? The agent will lose scheduling ability until reconnected.')) return;
        setDisconnecting(true);
        try {
            await api.delete('/google/oauth/disconnect');
            await load();
            setCalendars(null);
            setBanner({ kind: 'ok', message: 'Google Calendar disconnected.' });
        } catch (e: any) {
            setBanner({ kind: 'error', message: e?.response?.data?.message || e.message || 'Disconnect failed.' });
        } finally {
            setDisconnecting(false);
        }
    };

    const openCalendarPicker = async () => {
        setPickingCalendar(true);
        if (!calendars) {
            try {
                const r = await api.get('/google/calendars');
                if (r.data?.success) setCalendars(r.data.calendars || []);
            } catch (e: any) {
                setBanner({ kind: 'error', message: e?.response?.data?.message || 'Could not load calendar list.' });
            }
        }
    };

    const chooseCalendar = async (id: string) => {
        setSavingCalendar(true);
        try {
            await api.put('/google/calendar', { calendarId: id });
            await load();
            setPickingCalendar(false);
        } catch (e: any) {
            setBanner({ kind: 'error', message: e?.response?.data?.message || 'Could not save selection.' });
        } finally {
            setSavingCalendar(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        <div className="p-2 bg-primary/10 text-primary rounded-xl"><Blocks className="w-6 h-6" /></div>
                        Connectors
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Third-party services your AI agents can use. Connect once per workspace; every agent with the matching skill toggled on gets access.
                    </p>
                </div>
            </div>

            {banner && (
                <div className={`flex items-start gap-3 px-4 py-2.5 rounded-lg text-sm ${
                    banner.kind === 'ok'
                        ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                        : 'bg-red-500/10 border border-red-500/30 text-red-300'
                }`}>
                    <span className="flex-1">{banner.message}</span>
                    <button onClick={() => setBanner(null)} className="text-current hover:opacity-70">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {loading ? (
                <div className="flex justify-center items-center h-64">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
            ) : (
                <div className="grid gap-4">
                    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                        <div className="flex items-start gap-4">
                            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 flex-shrink-0">
                                <Calendar className="w-6 h-6" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h2 className="font-semibold text-base">Google Calendar</h2>
                                    {status?.connected && (
                                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                            <Check className="w-3 h-3" /> Connected
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Lets the agent list events, check availability, book meetings, and cancel bookings on a Google Calendar.
                                    Enable the <span className="font-mono">google_calendar</span> skill on any agent to use it.
                                </p>
                                {status?.connected && (
                                    <div className="mt-3 space-y-2 text-xs">
                                        <div className="flex items-center gap-2">
                                            <span className="text-muted-foreground w-24">Account:</span>
                                            <span className="font-mono">{status.email}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-muted-foreground w-24">Target calendar:</span>
                                            <button onClick={openCalendarPicker}
                                                className="inline-flex items-center gap-1 font-mono px-2 py-0.5 rounded-md border border-border hover:bg-secondary/40">
                                                {status.calendarId || 'primary'} <ChevronDown className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="flex-shrink-0">
                                {status?.connected ? (
                                    <button onClick={disconnect} disabled={disconnecting}
                                        className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-50">
                                        {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unplug className="w-4 h-4" />}
                                        Disconnect
                                    </button>
                                ) : (
                                    <button onClick={connect} disabled={connecting}
                                        className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                                        {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Blocks className="w-4 h-4" />}
                                        Connect
                                    </button>
                                )}
                            </div>
                        </div>

                        {pickingCalendar && (
                            <div className="border-t border-border pt-3">
                                <div className="text-xs font-medium text-muted-foreground mb-2">Pick a calendar</div>
                                {calendars === null ? (
                                    <div className="flex justify-center py-4">
                                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                                    </div>
                                ) : calendars.length === 0 ? (
                                    <p className="text-xs text-muted-foreground italic">No writable calendars found on this account.</p>
                                ) : (
                                    <div className="grid gap-1.5">
                                        {calendars.map(c => (
                                            <button key={c.id}
                                                onClick={() => chooseCalendar(c.id)}
                                                disabled={savingCalendar || c.id === status?.calendarId}
                                                className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs border transition-colors ${
                                                    c.id === status?.calendarId
                                                        ? 'bg-primary/10 border-primary/40 text-foreground'
                                                        : 'bg-secondary/40 border-border hover:bg-secondary/60'
                                                }`}>
                                                <span className="font-mono truncate mr-2">{c.summary}{c.primary ? ' · primary' : ''}</span>
                                                {c.id === status?.calendarId && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <div className="flex justify-end mt-2">
                                    <button onClick={() => setPickingCalendar(false)}
                                        className="text-[11px] text-muted-foreground hover:text-foreground">Close</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

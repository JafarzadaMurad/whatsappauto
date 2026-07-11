import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

// Scope set requested during OAuth. Read+write on events lets the
// scheduling skill both check availability and create bookings.
export const GOOGLE_CALENDAR_SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
    'openid',
    'email',
    'profile',
];

async function getGoogleClientCredentials(): Promise<{ clientId: string; clientSecret: string }> {
    const rows = await prisma.systemConfig.findMany({
        where: { key: { in: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] } },
    });
    const map: Record<string, string> = {};
    rows.forEach(r => { map[r.key] = r.value; });
    if (!map.GOOGLE_CLIENT_ID || !map.GOOGLE_CLIENT_SECRET) {
        throw new Error('Google OAuth is not configured. Admin needs to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
    }
    return { clientId: map.GOOGLE_CLIENT_ID, clientSecret: map.GOOGLE_CLIENT_SECRET };
}

export function getRedirectUri() {
    const base = process.env.FRONTEND_URL || 'https://chatbot.tural.ai';
    return `${base.replace(/\/$/, '')}/api/google/oauth/callback`;
}

export async function buildAuthorizeUrl(state: string): Promise<string> {
    const { clientId } = await getGoogleClientCredentials();
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: getRedirectUri(),
        response_type: 'code',
        scope: GOOGLE_CALENDAR_SCOPES.join(' '),
        access_type: 'offline',      // required to receive refresh_token
        prompt: 'consent',           // force fresh refresh_token even on re-connect
        state,
        include_granted_scopes: 'true',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
    refreshToken: string;
    accessToken: string;
    scope: string;
    email: string;
}> {
    const { clientId, clientSecret } = await getGoogleClientCredentials();
    const client = new OAuth2Client({ clientId, clientSecret, redirectUri: getRedirectUri() });
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
        throw new Error('No refresh token returned. Revoke the app from Google account settings and retry.');
    }
    const ticket = await client.verifyIdToken({
        idToken: tokens.id_token || '',
        audience: clientId,
    }).catch(() => null);
    const email = ticket?.getPayload()?.email;
    if (!email) throw new Error('Could not read Google account email from OAuth response.');
    return {
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token || '',
        scope: tokens.scope || GOOGLE_CALENDAR_SCOPES.join(' '),
        email,
    };
}

// Uses the stored refresh_token to mint a fresh access_token for API
// calls. Google's access tokens live ~1 hour; we don't cache them yet
// (single-tenant workspaces, low volume — the extra latency per call
// is a rounding error, and we avoid stale-token bugs).
async function getAccessToken(workspaceId: string): Promise<string> {
    const conn = await prisma.googleCalendarConnection.findUnique({ where: { workspaceId } });
    if (!conn) throw new Error('This workspace has no Google Calendar connected.');
    const { clientId, clientSecret } = await getGoogleClientCredentials();
    const client = new OAuth2Client({ clientId, clientSecret });
    client.setCredentials({ refresh_token: conn.refreshToken });
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) throw new Error('Failed to refresh Google access token.');
    return credentials.access_token;
}

async function authHeaders(workspaceId: string) {
    const token = await getAccessToken(workspaceId);
    return { Authorization: `Bearer ${token}` };
}

export type GoogleCalendarListItem = {
    id: string;
    summary: string;
    primary?: boolean;
    accessRole?: string;
    timeZone?: string;
};

export async function listCalendars(workspaceId: string): Promise<GoogleCalendarListItem[]> {
    const r = await axios.get(`${CALENDAR_API}/users/me/calendarList`, {
        headers: await authHeaders(workspaceId),
        params: { minAccessRole: 'writer' },
    });
    return (r.data.items || []).map((c: any) => ({
        id: c.id, summary: c.summary, primary: !!c.primary, accessRole: c.accessRole, timeZone: c.timeZone,
    }));
}

export type CalendarEvent = {
    id: string;
    summary: string;
    description?: string;
    start: string; // ISO
    end: string;   // ISO
    attendees?: { email: string; responseStatus?: string }[];
    htmlLink?: string;
};

function normaliseTime(t: any): string {
    if (!t) return '';
    return t.dateTime || t.date || '';
}

export async function listEvents(workspaceId: string, opts: {
    timeMin: string;
    timeMax: string;
    calendarId?: string;
    maxResults?: number;
    q?: string;
}): Promise<CalendarEvent[]> {
    const conn = await prisma.googleCalendarConnection.findUnique({ where: { workspaceId } });
    if (!conn) throw new Error('This workspace has no Google Calendar connected.');
    const calendarId = encodeURIComponent(opts.calendarId || conn.calendarId || 'primary');
    const r = await axios.get(`${CALENDAR_API}/calendars/${calendarId}/events`, {
        headers: await authHeaders(workspaceId),
        params: {
            timeMin: opts.timeMin,
            timeMax: opts.timeMax,
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: opts.maxResults || 50,
            q: opts.q || undefined,
        },
    });
    return (r.data.items || []).map((e: any): CalendarEvent => ({
        id: e.id,
        summary: e.summary || '(no title)',
        description: e.description || undefined,
        start: normaliseTime(e.start),
        end: normaliseTime(e.end),
        attendees: e.attendees || undefined,
        htmlLink: e.htmlLink || undefined,
    }));
}

export async function createEvent(workspaceId: string, opts: {
    summary: string;
    description?: string;
    start: string; // ISO with timezone or local + timezone
    end: string;
    timezone?: string;
    attendees?: string[]; // emails
    calendarId?: string;
}): Promise<CalendarEvent> {
    const conn = await prisma.googleCalendarConnection.findUnique({ where: { workspaceId } });
    if (!conn) throw new Error('This workspace has no Google Calendar connected.');
    const calendarId = encodeURIComponent(opts.calendarId || conn.calendarId || 'primary');
    const body: any = {
        summary: opts.summary,
        description: opts.description || undefined,
        start: opts.timezone
            ? { dateTime: opts.start, timeZone: opts.timezone }
            : { dateTime: opts.start },
        end: opts.timezone
            ? { dateTime: opts.end, timeZone: opts.timezone }
            : { dateTime: opts.end },
        attendees: opts.attendees?.length ? opts.attendees.map(email => ({ email })) : undefined,
    };
    const r = await axios.post(`${CALENDAR_API}/calendars/${calendarId}/events`, body, {
        headers: { ...(await authHeaders(workspaceId)), 'Content-Type': 'application/json' },
        params: { sendUpdates: opts.attendees?.length ? 'all' : 'none' },
    });
    const e = r.data;
    return {
        id: e.id,
        summary: e.summary,
        description: e.description || undefined,
        start: normaliseTime(e.start),
        end: normaliseTime(e.end),
        attendees: e.attendees || undefined,
        htmlLink: e.htmlLink || undefined,
    };
}

export async function deleteEvent(workspaceId: string, eventId: string, calendarId?: string): Promise<void> {
    const conn = await prisma.googleCalendarConnection.findUnique({ where: { workspaceId } });
    if (!conn) throw new Error('This workspace has no Google Calendar connected.');
    const cid = encodeURIComponent(calendarId || conn.calendarId || 'primary');
    await axios.delete(`${CALENDAR_API}/calendars/${cid}/events/${encodeURIComponent(eventId)}`, {
        headers: await authHeaders(workspaceId),
        params: { sendUpdates: 'all' },
    });
}

export async function revokeAndDisconnect(workspaceId: string): Promise<void> {
    const conn = await prisma.googleCalendarConnection.findUnique({ where: { workspaceId } });
    if (!conn) return;
    try {
        await axios.post('https://oauth2.googleapis.com/revoke', new URLSearchParams({ token: conn.refreshToken }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
    } catch (e: any) {
        logger.warn({ err: e?.response?.data || e?.message }, '[google] revoke failed — deleting row anyway');
    }
    await prisma.googleCalendarConnection.delete({ where: { workspaceId } });
}

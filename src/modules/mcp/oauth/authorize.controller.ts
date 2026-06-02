import crypto from 'crypto';
import { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma';
import { config } from '../../../config';

// GET /api/mcp/oauth/authorize?client_id=...&redirect_uri=...&code_challenge=...&code_challenge_method=S256
//
// We delegate the UI to the frontend at /oauth/authorize. The frontend reads
// the params, shows the consent screen (using the user's existing session),
// then POSTs back to /api/mcp/oauth/authorize/consent with the user's userId
// (verified via the dashboard JWT) and decision.
export async function authorizeRedirect(req: Request, res: Response) {
    const params = new URLSearchParams(req.query as any);
    const base = (config.FRONTEND_URL || 'https://chatbot.tur.al').replace(/\/$/, '');
    return res.redirect(`${base}/oauth/authorize?${params.toString()}`);
}

// POST /api/mcp/oauth/authorize/consent — called by the frontend consent
// page after the logged-in user clicks "Allow". Returns the authorization
// code; the frontend then redirects the browser to `redirect_uri?code=...`.
//
// Standard auth middleware protects this (JWT from the dashboard session).
export async function issueAuthCode(req: Request, res: Response) {
    try {
        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ success: false, message: 'Not authenticated' });

        const {
            client_id,
            redirect_uri,
            code_challenge,
            code_challenge_method,
            scope,
        } = req.body || {};

        if (!client_id || !redirect_uri || !code_challenge) {
            return res.status(400).json({ success: false, message: 'Missing required OAuth parameters' });
        }
        const method = code_challenge_method === 'plain' ? 'plain' : 'S256';

        const client = await prisma.mcpClient.findUnique({ where: { clientId: client_id } });
        if (!client) return res.status(400).json({ success: false, message: 'Unknown client' });
        if (!client.redirectUris.includes(redirect_uri)) {
            return res.status(400).json({ success: false, message: 'redirect_uri not registered for this client' });
        }

        // Attach the client to this user on first consent
        if (!client.userId) {
            await prisma.mcpClient.update({ where: { id: client.id }, data: { userId } });
        } else if (client.userId !== userId) {
            // Soft re-bind: a different user authorizing the same client_id
            // should get their own row. Easiest: just keep multiple consents
            // by issuing the code against the requesting user.
        }

        const code = crypto.randomBytes(32).toString('hex');
        const scopes = String(scope || 'full').split(/[,\s]+/).filter(Boolean);
        await prisma.mcpAuthCode.create({
            data: {
                code,
                userId,
                clientId: client_id,
                redirectUri: redirect_uri,
                codeChallenge: code_challenge,
                codeChallengeMethod: method,
                scopes,
                expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            },
        });

        const redirect = new URL(redirect_uri);
        redirect.searchParams.set('code', code);
        if (req.body.state) redirect.searchParams.set('state', String(req.body.state));
        return res.json({ success: true, redirectTo: redirect.toString() });
    } catch (e: any) {
        return res.status(500).json({ success: false, message: e.message });
    }
}

// POST /api/mcp/oauth/authorize/deny — when user clicks Deny on the
// consent screen. Frontend uses this to log the decision (optional).
export async function denyConsent(_req: Request, res: Response) {
    return res.json({ success: true });
}

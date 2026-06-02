import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma';

const ACCESS_TTL_SECS = 60 * 60;             // 1 hour
const REFRESH_TTL_SECS = 60 * 24 * 60 * 60;  // 60 days

function pkceMatches(verifier: string, challenge: string, method: string): boolean {
    if (method === 'plain') return verifier === challenge;
    // S256
    const hash = crypto.createHash('sha256').update(verifier).digest();
    const b64url = hash.toString('base64')
        .replace(/=+$/, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    return b64url === challenge;
}

async function authenticateClient(req: Request): Promise<{ clientId: string; isPublic: boolean } | null> {
    // RFC 6749 §3.2.1: secret can come in Authorization: Basic OR in form body
    let clientId: string | undefined;
    let clientSecret: string | undefined;
    const authHeader = String(req.headers.authorization || '');
    if (authHeader.toLowerCase().startsWith('basic ')) {
        const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString();
        const idx = decoded.indexOf(':');
        if (idx > 0) {
            clientId = decoded.slice(0, idx);
            clientSecret = decoded.slice(idx + 1);
        }
    }
    if (!clientId && req.body?.client_id) {
        clientId = String(req.body.client_id);
        if (req.body.client_secret) clientSecret = String(req.body.client_secret);
    }
    if (!clientId) return null;
    const client = await prisma.mcpClient.findUnique({ where: { clientId } });
    if (!client) return null;
    const isPublic = !client.clientSecret;
    if (isPublic) return { clientId, isPublic: true };
    if (!clientSecret) return null;
    const ok = await bcrypt.compare(clientSecret, client.clientSecret);
    return ok ? { clientId, isPublic: false } : null;
}

export async function issueToken(req: Request, res: Response) {
    try {
        const grantType = String(req.body?.grant_type || '');

        const client = await authenticateClient(req);
        if (!client) {
            return res.status(401).json({ error: 'invalid_client' });
        }

        if (grantType === 'authorization_code') {
            const code = String(req.body.code || '');
            const verifier = String(req.body.code_verifier || '');
            const redirectUri = String(req.body.redirect_uri || '');
            if (!code || !verifier || !redirectUri) {
                return res.status(400).json({ error: 'invalid_request' });
            }
            const row = await prisma.mcpAuthCode.findUnique({ where: { code } });
            if (!row || row.consumedAt || row.expiresAt < new Date()) {
                return res.status(400).json({ error: 'invalid_grant' });
            }
            if (row.clientId !== client.clientId) {
                return res.status(400).json({ error: 'invalid_grant' });
            }
            if (row.redirectUri !== redirectUri) {
                return res.status(400).json({ error: 'invalid_grant' });
            }
            if (!pkceMatches(verifier, row.codeChallenge, row.codeChallengeMethod)) {
                return res.status(400).json({ error: 'invalid_grant' });
            }
            await prisma.mcpAuthCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });

            const accessToken = 'mcp_at_' + crypto.randomBytes(32).toString('hex');
            const refreshToken = 'mcp_rt_' + crypto.randomBytes(32).toString('hex');
            await prisma.mcpOAuthToken.create({
                data: {
                    userId: row.userId,
                    clientId: row.clientId,
                    accessToken,
                    refreshToken,
                    expiresAt: new Date(Date.now() + ACCESS_TTL_SECS * 1000),
                    scopes: row.scopes,
                },
            });
            return res.json({
                access_token: accessToken,
                token_type: 'Bearer',
                expires_in: ACCESS_TTL_SECS,
                refresh_token: refreshToken,
                scope: row.scopes.join(' '),
            });
        }

        if (grantType === 'refresh_token') {
            const refreshToken = String(req.body.refresh_token || '');
            if (!refreshToken) return res.status(400).json({ error: 'invalid_request' });
            const old = await prisma.mcpOAuthToken.findUnique({ where: { refreshToken } });
            if (!old || old.clientId !== client.clientId) {
                return res.status(400).json({ error: 'invalid_grant' });
            }
            const ageMs = Date.now() - old.createdAt.getTime();
            if (ageMs > REFRESH_TTL_SECS * 1000) return res.status(400).json({ error: 'invalid_grant', error_description: 'Refresh token expired' });

            const accessToken = 'mcp_at_' + crypto.randomBytes(32).toString('hex');
            const newRefresh = 'mcp_rt_' + crypto.randomBytes(32).toString('hex');
            await prisma.$transaction([
                prisma.mcpOAuthToken.delete({ where: { id: old.id } }),
                prisma.mcpOAuthToken.create({
                    data: {
                        userId: old.userId,
                        clientId: old.clientId,
                        accessToken,
                        refreshToken: newRefresh,
                        expiresAt: new Date(Date.now() + ACCESS_TTL_SECS * 1000),
                        scopes: old.scopes,
                    },
                }),
            ]);
            return res.json({
                access_token: accessToken,
                token_type: 'Bearer',
                expires_in: ACCESS_TTL_SECS,
                refresh_token: newRefresh,
                scope: old.scopes.join(' '),
            });
        }

        return res.status(400).json({ error: 'unsupported_grant_type' });
    } catch (e: any) {
        return res.status(500).json({ error: 'server_error', error_description: e.message });
    }
}

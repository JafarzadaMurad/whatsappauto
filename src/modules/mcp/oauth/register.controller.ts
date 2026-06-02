import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma';

// Dynamic Client Registration (RFC 7591). Anonymous endpoint — MCP clients
// (Claude Desktop, etc.) call this on first connect to obtain a client_id
// (and optional secret). The client is associated with no user yet; user
// binding happens at /authorize via the logged-in session.
export async function dynamicRegister(req: Request, res: Response) {
    try {
        const body = req.body || {};
        const redirectUris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
        if (redirectUris.length === 0) {
            return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'At least one redirect_uri is required' });
        }
        for (const uri of redirectUris) {
            try { new URL(uri); } catch { return res.status(400).json({ error: 'invalid_redirect_uri', error_description: `Invalid URI: ${uri}` }); }
        }

        const clientName = String(body.client_name || 'MCP Client').slice(0, 100);
        const isPublic = body.token_endpoint_auth_method === 'none' || !!body.public_client;

        const clientId = 'mcp_' + crypto.randomBytes(16).toString('hex');
        const clientSecret = isPublic ? '' : crypto.randomBytes(32).toString('hex');
        const clientSecretHash = clientSecret ? await bcrypt.hash(clientSecret, 10) : '';

        // Per spec these rows can be unattached to a user until the first
        // authorization completes. We store userId as empty until then.
        await prisma.mcpClient.create({
            data: {
                userId: '',
                clientId,
                clientSecret: clientSecretHash,
                name: clientName,
                redirectUris,
            },
        });

        const response: any = {
            client_id: clientId,
            client_name: clientName,
            redirect_uris: redirectUris,
            token_endpoint_auth_method: isPublic ? 'none' : 'client_secret_basic',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
        };
        if (clientSecret) response.client_secret = clientSecret;

        return res.status(201).json(response);
    } catch (e: any) {
        return res.status(500).json({ error: 'server_error', error_description: e.message });
    }
}

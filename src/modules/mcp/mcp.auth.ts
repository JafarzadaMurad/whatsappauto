import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';

function buildWwwAuth(error: string): string {
    const base = (config.FRONTEND_URL || 'https://chatbot.tur.al').replace(/\/$/, '');
    const resourceMeta = `${base}/.well-known/oauth-protected-resource`;
    return `Bearer realm="MCP", error="${error}", resource_metadata="${resourceMeta}"`;
}

export type McpAuthInfo = {
    userId: string;
    authKind: 'api_key' | 'oauth';
    authRef: string;
};

declare module 'express-serve-static-core' {
    interface Request {
        mcpAuth?: McpAuthInfo;
    }
}

export async function mcpAuth(req: Request, res: Response, next: NextFunction) {
    const header = String(req.headers.authorization || '');
    const token = header.replace(/^Bearer\s+/i, '').trim();

    if (!token) {
        return res
            .status(401)
            .setHeader('WWW-Authenticate', 'Bearer realm="MCP", error="invalid_token"')
            .json({ error: 'invalid_token', error_description: 'Missing Authorization header' });
    }

    try {
        if (token.startsWith('sk_')) {
            const apiKey = await prisma.apiKey.findUnique({ where: { key: token } });
            if (!apiKey) {
                return res
                    .status(401)
                    .setHeader('WWW-Authenticate', buildWwwAuth('invalid_token'))
                    .json({ error: 'invalid_token', error_description: 'API key not found' });
            }
            prisma.apiKey
                .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
                .catch(() => {});
            req.mcpAuth = { userId: apiKey.userId, authKind: 'api_key', authRef: apiKey.id };
            return next();
        }

        // Otherwise treat as MCP OAuth bearer token
        const oauth = await prisma.mcpOAuthToken.findUnique({ where: { accessToken: token } });
        if (!oauth) {
            return res
                .status(401)
                .setHeader('WWW-Authenticate', buildWwwAuth('invalid_token'))
                .json({ error: 'invalid_token', error_description: 'OAuth token not recognized' });
        }
        if (oauth.expiresAt < new Date()) {
            return res
                .status(401)
                .setHeader('WWW-Authenticate', buildWwwAuth('invalid_token'))
                .json({ error: 'invalid_token', error_description: 'OAuth token expired' });
        }
        req.mcpAuth = { userId: oauth.userId, authKind: 'oauth', authRef: oauth.id };
        return next();
    } catch (err: any) {
        return res.status(500).json({ error: 'server_error', error_description: err.message });
    }
}

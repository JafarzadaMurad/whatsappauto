import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { getOrCreatePersonalWorkspace } from '../../lib/workspace-migration';

function buildWwwAuth(error: string): string {
    const base = (config.FRONTEND_URL || 'https://chatbot.tural.ai').replace(/\/$/, '');
    const resourceMeta = `${base}/.well-known/oauth-protected-resource`;
    return `Bearer realm="MCP", error="${error}", resource_metadata="${resourceMeta}"`;
}

export type McpAuthInfo = {
    userId: string;
    workspaceId: string;
    authKind: 'api_key' | 'oauth';
    authRef: string;
};

declare module 'express-serve-static-core' {
    interface Request {
        mcpAuth?: McpAuthInfo;
    }
}

// A credential stays bound to whichever workspace it was minted in (or
// last switched to). Membership can be revoked after the fact, so we
// re-check on every request rather than trusting the stored id — the
// same rule the dashboard's auth middleware applies.
async function assertWorkspaceAccess(userId: string, workspaceId: string): Promise<boolean> {
    const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { id: true },
    });
    if (member) return true;
    // Owners always have access even if the membership row is missing
    // (older workspaces created before members were backfilled).
    const owned = await prisma.workspace.findFirst({
        where: { id: workspaceId, ownerId: userId },
        select: { id: true },
    });
    return !!owned;
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
            // API keys remember the workspace they were created in; fall back
            // to the user's personal workspace for keys minted before the
            // workspace migration.
            const wsId = apiKey.workspaceId || (await getOrCreatePersonalWorkspace(apiKey.userId));
            const okWs = await assertWorkspaceAccess(apiKey.userId, wsId);
            if (!okWs) {
                return res.status(403).json({
                    error: 'access_denied',
                    error_description:
                        'This credential points at a workspace you no longer have access to. ' +
                        'Use switch_workspace to pick one you can reach.',
                });
            }
            req.mcpAuth = { userId: apiKey.userId, workspaceId: wsId, authKind: 'api_key', authRef: apiKey.id };
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
        const oauthWs = oauth.workspaceId || (await getOrCreatePersonalWorkspace(oauth.userId));
        const okOauthWs = await assertWorkspaceAccess(oauth.userId, oauthWs);
        if (!okOauthWs) {
            return res.status(403).json({
                error: 'access_denied',
                error_description:
                    'This token points at a workspace you no longer have access to. ' +
                    'Use switch_workspace to pick one you can reach.',
            });
        }
        req.mcpAuth = { userId: oauth.userId, workspaceId: oauthWs, authKind: 'oauth', authRef: oauth.id };
        return next();
    } catch (err: any) {
        return res.status(500).json({ error: 'server_error', error_description: err.message });
    }
}

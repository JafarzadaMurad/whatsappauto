import { Router, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { prisma } from '../../lib/prisma';
import { config } from '../../config';
import { authMiddleware } from '../../middleware/auth.middleware';
import { mcpAuth } from './mcp.auth';
import { buildMcpServer } from './mcp.server';
import {
    PERMISSION_CATEGORIES,
    PERMISSION_VERBS,
    listPermissions,
    setPermissions,
} from './mcp.permissions';
import { dynamicRegister } from './oauth/register.controller';
import { authorizeRedirect, issueAuthCode, denyConsent } from './oauth/authorize.controller';
import { issueToken } from './oauth/token.controller';

const router: Router = Router();

// ─── MCP discovery (no auth) ───
// https://modelcontextprotocol.io/specification/draft/basic/transports/
router.get('/.well-known/oauth-authorization-server', (_req, res) => {
    const base = (config.FRONTEND_URL || 'https://chatbot.tur.al').replace(/\/$/, '');
    res.json({
        issuer: base,
        authorization_endpoint: `${base}/api/mcp/oauth/authorize`,
        token_endpoint: `${base}/api/mcp/oauth/token`,
        registration_endpoint: `${base}/api/mcp/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    });
});

// ─── OAuth provider ───
router.post('/oauth/register', dynamicRegister);
router.get('/oauth/authorize', authorizeRedirect);
router.post('/oauth/authorize/consent', authMiddleware, issueAuthCode);
router.post('/oauth/authorize/deny', authMiddleware, denyConsent);
router.post('/oauth/token', issueToken);

// ─── MCP main endpoint (Streamable HTTP) ───
async function handleMcp(req: Request, res: Response) {
    if (!req.mcpAuth) return res.status(401).end();
    try {
        const server = buildMcpServer({ auth: req.mcpAuth, userId: req.mcpAuth.userId });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await server.connect(transport);
        await transport.handleRequest(req as any, res, req.body);
    } catch (e: any) {
        if (!res.headersSent) res.status(500).json({ error: 'server_error', error_description: e.message });
    }
}

router.post('/', mcpAuth, handleMcp);
router.get('/', mcpAuth, handleMcp);
router.delete('/', mcpAuth, handleMcp);

// ─── Settings API (JWT-protected; used by the dashboard) ───
router.get('/permissions', authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const flags = await listPermissions(userId);
    res.json({
        success: true,
        categories: PERMISSION_CATEGORIES,
        verbs: PERMISSION_VERBS,
        toolFlags: flags,
    });
});

router.put('/permissions', authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const flags = (req.body?.toolFlags || {}) as Record<string, boolean>;
    await setPermissions(userId, flags);
    res.json({ success: true });
});

router.get('/clients', authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const [clients, tokens] = await Promise.all([
        prisma.mcpClient.findMany({
            where: { userId },
            select: { id: true, clientId: true, name: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
        }),
        prisma.mcpOAuthToken.findMany({
            where: { userId },
            select: { id: true, clientId: true, expiresAt: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 50,
        }),
    ]);
    res.json({ success: true, clients, tokens });
});

router.delete('/clients/:id', authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const id = String(req.params.id || '');
    const existing = await prisma.mcpClient.findFirst({ where: { id, userId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
    // Cascade: revoke all tokens issued to this clientId
    await prisma.$transaction([
        prisma.mcpOAuthToken.deleteMany({ where: { userId, clientId: existing.clientId } }),
        prisma.mcpClient.delete({ where: { id } }),
    ]);
    res.json({ success: true });
});

router.delete('/tokens/:id', authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const id = String(req.params.id || '');
    const existing = await prisma.mcpOAuthToken.findFirst({ where: { id, userId } });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });
    await prisma.mcpOAuthToken.delete({ where: { id } });
    res.json({ success: true });
});

router.get('/audit', authMiddleware, async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const tool = req.query.tool as string | undefined;
    const status = req.query.status as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = await prisma.mcpAuditLog.findMany({
        where: {
            userId,
            ...(tool ? { tool } : {}),
            ...(status === 'ok' ? { resultOk: true } : status === 'error' ? { resultOk: false } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
    });
    res.json({ success: true, logs: rows });
});

export default router;

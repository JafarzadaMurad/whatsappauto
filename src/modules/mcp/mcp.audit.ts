import { prisma } from '../../lib/prisma';
import { logger } from '../../utils/logger';
import type { McpAuthInfo } from './mcp.auth';

const SENSITIVE_KEYS = new Set(['accessToken', 'access_token', 'password', 'apiKey', 'api_key', 'secret', 'client_secret', 'authorization']);

function redact(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(redact);
    if (typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            if (SENSITIVE_KEYS.has(k)) out[k] = '[redacted]';
            else out[k] = redact(v);
        }
        return out;
    }
    return value;
}

export async function writeAudit(opts: {
    auth: McpAuthInfo;
    tool: string;
    args: unknown;
    resultOk: boolean;
    errorMsg?: string;
    durationMs: number;
}) {
    try {
        await prisma.mcpAuditLog.create({
            data: {
                userId: opts.auth.userId,
                authKind: opts.auth.authKind,
                authRef: opts.auth.authRef,
                tool: opts.tool,
                argsJson: redact(opts.args) as any,
                resultOk: opts.resultOk,
                errorMsg: opts.errorMsg?.slice(0, 2000) ?? null,
                durationMs: opts.durationMs,
            },
        });
    } catch (e: any) {
        logger.warn({ err: e.message }, '[MCP] audit log write failed');
    }
}

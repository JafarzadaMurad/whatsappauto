// Workspace tools.
//
// An MCP credential (API key or OAuth token) is bound to exactly one
// workspace — the one it was minted in. That made MCP useless for the
// common case where a user owns one workspace and has been invited to
// several others: the assistant could only ever see the bound one.
//
// These tools let the caller enumerate every workspace they can reach
// (owned + shared) and re-point their credential at one of them.
// `switch_workspace` persists the choice on the credential row, so it
// survives across sessions and reconnects — the assistant doesn't have
// to re-select on every conversation.

import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { ok, fail, type RegisterToolFn } from '../mcp.server';

export function registerWorkspaceTools(reg: RegisterToolFn) {
    reg(
        'list_workspaces',
        'Lists every workspace the calling user can access — both the ones they own and the ones shared with them — and marks which one is currently active for this MCP connection. Use this before switch_workspace.',
        {},
        async (_args, ctx) => {
            const memberships = await prisma.workspaceMember.findMany({
                where: { userId: ctx.userId },
                orderBy: { createdAt: 'asc' },
                select: {
                    role: true,
                    workspace: {
                        select: {
                            id: true, name: true, ownerId: true, createdAt: true,
                            owner: { select: { id: true, email: true, name: true } },
                            plan: { select: { name: true } },
                        },
                    },
                    customRole: { select: { name: true } },
                },
            });

            const rows = memberships.map(m => ({
                id: m.workspace.id,
                name: m.workspace.name,
                isOwner: m.workspace.ownerId === ctx.userId,
                access: m.workspace.ownerId === ctx.userId
                    ? 'owner'
                    : (m.customRole?.name || m.role || 'member'),
                ownedBy: m.workspace.ownerId === ctx.userId
                    ? 'you'
                    : (m.workspace.owner?.name || m.workspace.owner?.email || 'unknown'),
                plan: m.workspace.plan?.name || null,
                active: m.workspace.id === ctx.workspaceId,
            }));

            if (rows.length === 0) {
                return ok({ workspaces: [], note: 'No workspace memberships found for this user.' });
            }
            return ok({
                activeWorkspaceId: ctx.workspaceId,
                workspaces: rows,
            });
        },
    );

    reg(
        'switch_workspace',
        'Points this MCP credential at a different workspace. The workspace must be one the user owns or has been invited to (see list_workspaces). The change persists for future calls and sessions. Every other tool operates on the active workspace.',
        { workspaceId: z.string().uuid() },
        async ({ workspaceId }, ctx) => {
            if (workspaceId === ctx.workspaceId) {
                return ok({ workspaceId, changed: false, message: 'Already the active workspace.' });
            }

            // Membership is the authorisation boundary — never trust the
            // id alone, or a leaked credential could reach any workspace.
            const member = await prisma.workspaceMember.findUnique({
                where: { workspaceId_userId: { workspaceId, userId: ctx.userId } },
                select: {
                    role: true,
                    customRole: { select: { name: true } },
                    workspace: { select: { id: true, name: true, ownerId: true } },
                },
            });
            if (!member) {
                return fail(
                    `You don't have access to workspace ${workspaceId}. ` +
                    'Call list_workspaces to see the ones available to you.',
                );
            }

            // Persist onto whichever credential authenticated this call.
            if (ctx.auth.authKind === 'api_key') {
                await prisma.apiKey.update({
                    where: { id: ctx.auth.authRef },
                    data: { workspaceId },
                });
            } else {
                await prisma.mcpOAuthToken.update({
                    where: { id: ctx.auth.authRef },
                    data: { workspaceId },
                });
            }

            return ok({
                workspaceId,
                name: member.workspace.name,
                access: member.workspace.ownerId === ctx.userId
                    ? 'owner'
                    : (member.customRole?.name || member.role || 'member'),
                changed: true,
                message:
                    `Active workspace is now "${member.workspace.name}". ` +
                    'Subsequent tool calls operate on it.',
            });
        },
    );

    reg(
        'get_active_workspace',
        'Returns the workspace this MCP connection is currently operating on, including the caller\'s access level in it.',
        {},
        async (_args, ctx) => {
            const ws = await prisma.workspace.findUnique({
                where: { id: ctx.workspaceId },
                select: {
                    id: true, name: true, ownerId: true,
                    owner: { select: { email: true, name: true } },
                    plan: { select: { name: true, monthlyCredits: true } },
                    creditsUsedThisPeriod: true, creditTopUp: true,
                },
            });
            if (!ws) return fail('Active workspace no longer exists.');

            const member = await prisma.workspaceMember.findUnique({
                where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: ctx.userId } },
                select: { role: true, customRole: { select: { name: true } } },
            });

            return ok({
                id: ws.id,
                name: ws.name,
                isOwner: ws.ownerId === ctx.userId,
                access: ws.ownerId === ctx.userId
                    ? 'owner'
                    : (member?.customRole?.name || member?.role || 'member'),
                ownedBy: ws.ownerId === ctx.userId ? 'you' : (ws.owner?.name || ws.owner?.email || 'unknown'),
                plan: ws.plan?.name || null,
                credits: {
                    monthly: ws.plan?.monthlyCredits ?? 0,
                    topUp: ws.creditTopUp,
                    usedThisPeriod: ws.creditsUsedThisPeriod,
                },
            });
        },
    );
}

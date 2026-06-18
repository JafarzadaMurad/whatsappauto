import { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { isOwner, canMeta } from '../../lib/workspace-context';
import { seedRolesForWorkspace } from '../../lib/role-migration';

const createSchema = z.object({ name: z.string().min(1).max(60) });
const updateSchema = z.object({ name: z.string().min(1).max(60) });
const inviteSchema = z.object({
    email: z.string().email(),
    roleId: z.string().uuid(),
});
const updateMemberSchema = z.object({ roleId: z.string().uuid() });

// Helper: resolve a workspace's default role row id (used as a fallback
// for legacy clients that still send role strings).
async function defaultRoleId(workspaceId: string): Promise<string> {
    const r = await prisma.workspaceRole.findFirst({
        where: { workspaceId, name: 'Member' },
        select: { id: true },
    });
    if (r) return r.id;
    // Last-resort: seed and re-query.
    return seedRolesForWorkspace(workspaceId);
}

export class WorkspaceController {
    // List every workspace the current user is a member of (own + others' they joined).
    async list(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const memberships = await prisma.workspaceMember.findMany({
                where: { userId },
                include: {
                    workspace: {
                        select: { id: true, name: true, ownerId: true, planId: true, subscriptionStatus: true, createdAt: true },
                    },
                    customRole: { select: { id: true, name: true, permissions: true } },
                },
                orderBy: { createdAt: 'asc' },
            });
            const workspaces = memberships.map(m => ({
                ...m.workspace,
                role: m.role,
                roleId: m.roleId,
                roleName: m.customRole?.name || m.role,
                permissions: m.customRole?.permissions || null,
                isOwner: m.workspace.ownerId === userId,
            }));
            return res.json({ success: true, workspaces });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // Create a new workspace (the caller becomes the OWNER member).
    async create(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { name } = createSchema.parse(req.body);
            const ws = await prisma.workspace.create({
                data: {
                    name,
                    ownerId: userId,
                    members: { create: { userId, role: 'OWNER' } },
                },
            });
            await seedRolesForWorkspace(ws.id).catch(() => {});
            return res.status(201).json({ success: true, workspace: ws });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // Workspace details + members + invitations + roles. Caller must be a member.
    async get(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            const membership = await prisma.workspaceMember.findUnique({
                where: { workspaceId_userId: { workspaceId: id, userId } },
                include: { customRole: true },
            });
            if (!membership) return res.status(404).json({ success: false, message: 'Workspace not found' });
            await seedRolesForWorkspace(id).catch(() => {});
            const ws = await prisma.workspace.findUnique({
                where: { id },
                include: {
                    members: {
                        include: {
                            user: { select: { id: true, email: true, name: true } },
                            customRole: { select: { id: true, name: true } },
                        },
                        orderBy: { createdAt: 'asc' },
                    },
                    invitations: {
                        where: { acceptedAt: null, expiresAt: { gt: new Date() } },
                        select: {
                            id: true, email: true, role: true, expiresAt: true, createdAt: true, roleId: true,
                            customRole: { select: { id: true, name: true } },
                        },
                    },
                },
            });
            return res.json({
                success: true,
                workspace: ws,
                role: membership.role,
                roleName: membership.customRole?.name || membership.role,
                permissions: membership.role === 'OWNER' ? null : (membership.customRole?.permissions || {}),
            });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async update(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            if (req.workspaceId !== id) return res.status(403).json({ success: false, message: 'Permission denied' });
            if (!isOwner(req) && !canMeta(req, 'manageWorkspace')) {
                return res.status(403).json({ success: false, message: 'Permission denied' });
            }
            const { name } = updateSchema.parse(req.body);
            const ws = await prisma.workspace.update({ where: { id }, data: { name } });
            return res.json({ success: true, workspace: ws });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async remove(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            const ws = await prisma.workspace.findUnique({ where: { id } });
            if (!ws) return res.status(404).json({ success: false, message: 'Workspace not found' });
            if (ws.ownerId !== userId) return res.status(403).json({ success: false, message: 'Only the owner can delete' });
            const ownedCount = await prisma.workspace.count({ where: { ownerId: userId } });
            if (ownedCount <= 1) return res.status(400).json({ success: false, message: 'You cannot delete your last workspace' });
            await prisma.workspace.delete({ where: { id } });
            return res.json({ success: true });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // ─── Members ─────────────────────────────────────────────────
    async updateMember(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const memberId = req.params.memberId as string;
            if (req.workspaceId !== id) return res.status(403).json({ success: false, message: 'Permission denied' });
            if (!isOwner(req) && !canMeta(req, 'manageRoles')) {
                return res.status(403).json({ success: false, message: 'Permission denied' });
            }
            const { roleId } = updateMemberSchema.parse(req.body);
            const role = await prisma.workspaceRole.findFirst({ where: { id: roleId, workspaceId: id } });
            if (!role) return res.status(400).json({ success: false, message: 'Invalid roleId' });

            const target = await prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId: id } });
            if (!target) return res.status(404).json({ success: false, message: 'Member not found' });
            if (target.role === 'OWNER') return res.status(400).json({ success: false, message: 'Cannot change the owner\'s role' });

            const updated = await prisma.workspaceMember.update({
                where: { id: memberId },
                data: { roleId, role: role.name.toUpperCase() === 'ADMIN' ? 'ADMIN' : 'MEMBER' },
                include: { customRole: { select: { id: true, name: true } } },
            });
            return res.json({ success: true, member: updated });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async removeMember(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            const memberId = req.params.memberId as string;
            if (req.workspaceId !== id) return res.status(403).json({ success: false, message: 'Permission denied' });
            const target = await prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId: id } });
            if (!target) return res.status(404).json({ success: false, message: 'Member not found' });
            if (target.role === 'OWNER') return res.status(400).json({ success: false, message: 'Cannot remove the owner' });
            const isSelf = target.userId === userId;
            const canRemove = isOwner(req) || canMeta(req, 'manageRoles');
            if (!isSelf && !canRemove) return res.status(403).json({ success: false, message: 'Forbidden' });
            await prisma.workspaceMember.delete({ where: { id: memberId } });
            return res.json({ success: true });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // ─── Invitations ─────────────────────────────────────────────
    async createInvite(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            if (req.workspaceId !== id) return res.status(403).json({ success: false, message: 'Permission denied' });
            if (!isOwner(req) && !canMeta(req, 'inviteMembers')) {
                return res.status(403).json({ success: false, message: 'Permission denied' });
            }
            const { email, roleId } = inviteSchema.parse(req.body);
            const role = await prisma.workspaceRole.findFirst({ where: { id: roleId, workspaceId: id } });
            if (!role) return res.status(400).json({ success: false, message: 'Invalid roleId' });

            const existingUser = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } });
            if (existingUser) {
                const existingMember = await prisma.workspaceMember.findUnique({
                    where: { workspaceId_userId: { workspaceId: id, userId: existingUser.id } },
                });
                if (existingMember) return res.status(400).json({ success: false, message: 'Already a member' });
            }

            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
            const invite = await prisma.workspaceInvitation.create({
                data: {
                    workspaceId: id,
                    email: email.toLowerCase(),
                    role: role.name.toUpperCase() === 'ADMIN' ? 'ADMIN' : 'MEMBER',
                    roleId,
                    token,
                    expiresAt,
                    invitedById: userId,
                },
                include: { customRole: { select: { id: true, name: true } } },
            });

            return res.status(201).json({ success: true, invite, acceptUrl: `/accept-invite/${token}` });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async cancelInvite(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const inviteId = req.params.inviteId as string;
            if (req.workspaceId !== id) return res.status(403).json({ success: false, message: 'Permission denied' });
            if (!isOwner(req) && !canMeta(req, 'inviteMembers')) {
                return res.status(403).json({ success: false, message: 'Permission denied' });
            }
            await prisma.workspaceInvitation.delete({ where: { id: inviteId } });
            return res.json({ success: true });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // Peek at an invite by token (used by the accept page to show context before login).
    async peekInvite(req: Request, res: Response) {
        try {
            const token = req.params.token as string;
            const invite = await prisma.workspaceInvitation.findUnique({
                where: { token },
                include: {
                    workspace: { select: { id: true, name: true, ownerId: true } },
                    customRole: { select: { name: true } },
                },
            });
            if (!invite) return res.status(404).json({ success: false, message: 'Invitation not found' });
            if (invite.acceptedAt) return res.status(400).json({ success: false, message: 'Invitation already used' });
            if (invite.expiresAt < new Date()) return res.status(400).json({ success: false, message: 'Invitation expired' });
            return res.json({
                success: true,
                workspaceName: invite.workspace.name,
                email: invite.email,
                role: invite.customRole?.name || invite.role,
            });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async acceptInvite(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
            const token = req.params.token as string;
            const invite = await prisma.workspaceInvitation.findUnique({ where: { token } });
            if (!invite) return res.status(404).json({ success: false, message: 'Invitation not found' });
            if (invite.acceptedAt) return res.status(400).json({ success: false, message: 'Already used' });
            if (invite.expiresAt < new Date()) return res.status(400).json({ success: false, message: 'Expired' });
            if (invite.email.toLowerCase() !== (user?.email || '').toLowerCase()) {
                return res.status(403).json({ success: false, message: 'Invitation is for a different email' });
            }
            const roleId = invite.roleId || await defaultRoleId(invite.workspaceId);
            const existing = await prisma.workspaceMember.findUnique({
                where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
            });
            if (!existing) {
                await prisma.workspaceMember.create({
                    data: {
                        workspaceId: invite.workspaceId,
                        userId,
                        role: invite.role,
                        roleId,
                    },
                });
            }
            await prisma.workspaceInvitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
            return res.json({ success: true, workspaceId: invite.workspaceId });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }
}

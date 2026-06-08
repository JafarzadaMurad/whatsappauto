import { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';

const createSchema = z.object({ name: z.string().min(1).max(60) });
const updateSchema = z.object({ name: z.string().min(1).max(60) });
const inviteSchema = z.object({
    email: z.string().email(),
    role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
});
const updateMemberSchema = z.object({ role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']) });

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
                },
                orderBy: { createdAt: 'asc' },
            });
            const workspaces = memberships.map(m => ({
                ...m.workspace,
                role: m.role,
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
            return res.status(201).json({ success: true, workspace: ws });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // Workspace details + members. The caller must be a member.
    async get(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            const membership = await prisma.workspaceMember.findUnique({
                where: { workspaceId_userId: { workspaceId: id, userId } },
            });
            if (!membership) return res.status(404).json({ success: false, message: 'Workspace not found' });
            const ws = await prisma.workspace.findUnique({
                where: { id },
                include: {
                    members: {
                        include: { user: { select: { id: true, email: true, name: true } } },
                        orderBy: { createdAt: 'asc' },
                    },
                    invitations: {
                        where: { acceptedAt: null, expiresAt: { gt: new Date() } },
                        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
                    },
                },
            });
            return res.json({ success: true, workspace: ws, role: membership.role });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async update(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            const { name } = updateSchema.parse(req.body);
            const m = await prisma.workspaceMember.findUnique({
                where: { workspaceId_userId: { workspaceId: id, userId } },
            });
            if (!m) return res.status(404).json({ success: false, message: 'Workspace not found' });
            if (m.role !== 'OWNER' && m.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Only owner/admin can rename' });
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
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            const memberId = req.params.memberId as string;
            const { role } = updateMemberSchema.parse(req.body);

            const me = await prisma.workspaceMember.findUnique({
                where: { workspaceId_userId: { workspaceId: id, userId } },
            });
            if (!me) return res.status(404).json({ success: false, message: 'Workspace not found' });
            if (me.role !== 'OWNER' && me.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Only owner/admin can change roles' });

            const target = await prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId: id } });
            if (!target) return res.status(404).json({ success: false, message: 'Member not found' });
            if (target.role === 'OWNER') return res.status(400).json({ success: false, message: 'Cannot change the owner\'s role' });

            const updated = await prisma.workspaceMember.update({ where: { id: memberId }, data: { role } });
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
            const me = await prisma.workspaceMember.findUnique({
                where: { workspaceId_userId: { workspaceId: id, userId } },
            });
            if (!me) return res.status(404).json({ success: false, message: 'Workspace not found' });
            const target = await prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId: id } });
            if (!target) return res.status(404).json({ success: false, message: 'Member not found' });
            if (target.role === 'OWNER') return res.status(400).json({ success: false, message: 'Cannot remove the owner' });
            // Allow self-leave OR owner/admin removing others
            const isSelf = target.userId === userId;
            const isAdmin = me.role === 'OWNER' || me.role === 'ADMIN';
            if (!isSelf && !isAdmin) return res.status(403).json({ success: false, message: 'Forbidden' });
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
            const { email, role } = inviteSchema.parse(req.body);

            const me = await prisma.workspaceMember.findUnique({
                where: { workspaceId_userId: { workspaceId: id, userId } },
            });
            if (!me) return res.status(404).json({ success: false, message: 'Workspace not found' });
            if (me.role !== 'OWNER' && me.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Only owner/admin can invite' });

            // If the email already belongs to a member, don't bother creating an invite.
            const existingUser = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } });
            if (existingUser) {
                const existingMember = await prisma.workspaceMember.findUnique({
                    where: { workspaceId_userId: { workspaceId: id, userId: existingUser.id } },
                });
                if (existingMember) return res.status(400).json({ success: false, message: 'Already a member' });
            }

            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days
            const invite = await prisma.workspaceInvitation.create({
                data: {
                    workspaceId: id,
                    email: email.toLowerCase(),
                    role,
                    token,
                    expiresAt,
                    invitedById: userId,
                },
            });

            return res.status(201).json({ success: true, invite, acceptUrl: `/accept-invite/${token}` });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async cancelInvite(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const id = req.params.id as string;
            const inviteId = req.params.inviteId as string;
            const me = await prisma.workspaceMember.findUnique({
                where: { workspaceId_userId: { workspaceId: id, userId } },
            });
            if (!me) return res.status(404).json({ success: false, message: 'Workspace not found' });
            if (me.role !== 'OWNER' && me.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Forbidden' });
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
                include: { workspace: { select: { id: true, name: true, ownerId: true } } },
            });
            if (!invite) return res.status(404).json({ success: false, message: 'Invitation not found' });
            if (invite.acceptedAt) return res.status(400).json({ success: false, message: 'Invitation already used' });
            if (invite.expiresAt < new Date()) return res.status(400).json({ success: false, message: 'Invitation expired' });
            return res.json({
                success: true,
                workspaceName: invite.workspace.name,
                email: invite.email,
                role: invite.role,
            });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    // Accept an invitation. Requires auth. The invitation's email should match the user's email.
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
            // Idempotent: if already a member, just mark the invite consumed.
            const existing = await prisma.workspaceMember.findUnique({
                where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
            });
            if (!existing) {
                await prisma.workspaceMember.create({
                    data: { workspaceId: invite.workspaceId, userId, role: invite.role },
                });
            }
            await prisma.workspaceInvitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
            return res.json({ success: true, workspaceId: invite.workspaceId });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }
}

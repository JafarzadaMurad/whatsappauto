import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { isOwner, canMeta } from '../../lib/workspace-context';
import { SECTIONS, META_FLAGS, SYSTEM_ROLES, sanitizePermissions } from '../../lib/permissions';
import { seedRolesForWorkspace } from '../../lib/role-migration';

const createSchema = z.object({
    name: z.string().min(1).max(40),
    description: z.string().max(200).optional().nullable(),
    permissions: z.any(),
});

const updateSchema = z.object({
    name: z.string().min(1).max(40).optional(),
    description: z.string().max(200).optional().nullable(),
    permissions: z.any().optional(),
});

// Permission gate used by all mutating endpoints in this controller. The
// workspace owner can always manage roles; otherwise the actor must have
// `meta.manageRoles` set on their own role.
function canManageRoles(req: Request, workspaceId: string): boolean {
    if (req.workspaceId !== workspaceId) return false;
    return isOwner(req) || canMeta(req, 'manageRoles');
}

export class WorkspaceRoleController {
    // Returns the catalogue used by the role editor UI: which sections
    // exist, which verbs they support, and which meta flags are available.
    // Stable client-side, so we can just inline it.
    async catalog(_req: Request, res: Response) {
        return res.json({ success: true, sections: SECTIONS, metaFlags: META_FLAGS, systemRoles: SYSTEM_ROLES.map(r => ({ name: r.name, description: r.description })) });
    }

    async list(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            if (req.workspaceId !== id) {
                return res.status(403).json({ success: false, message: 'Not a member of this workspace' });
            }
            // Make sure system roles exist (cheap, idempotent).
            await seedRolesForWorkspace(id).catch(() => {});
            const roles = await prisma.workspaceRole.findMany({
                where: { workspaceId: id },
                orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
                include: { _count: { select: { members: true, invitations: true } } },
            });
            return res.json({ success: true, roles });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async create(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            if (!canManageRoles(req, id)) return res.status(403).json({ success: false, message: 'Permission denied' });
            const body = createSchema.parse(req.body);
            const permissions = sanitizePermissions(body.permissions);
            const role = await prisma.workspaceRole.create({
                data: {
                    workspaceId: id,
                    name: body.name.trim(),
                    description: body.description?.trim() || null,
                    permissions: permissions as any,
                    isSystem: false,
                },
            });
            return res.status(201).json({ success: true, role });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            if (e?.code === 'P2002') return res.status(400).json({ success: false, message: 'A role with that name already exists' });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async update(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const roleId = req.params.roleId as string;
            if (!canManageRoles(req, id)) return res.status(403).json({ success: false, message: 'Permission denied' });
            const role = await prisma.workspaceRole.findFirst({ where: { id: roleId, workspaceId: id } });
            if (!role) return res.status(404).json({ success: false, message: 'Role not found' });

            const body = updateSchema.parse(req.body);
            const data: any = {};
            if (body.name !== undefined) {
                if (role.isSystem && body.name.trim() !== role.name) {
                    return res.status(400).json({ success: false, message: 'System roles cannot be renamed' });
                }
                data.name = body.name.trim();
            }
            if (body.description !== undefined) data.description = body.description?.trim() || null;
            if (body.permissions !== undefined) data.permissions = sanitizePermissions(body.permissions) as any;
            const updated = await prisma.workspaceRole.update({ where: { id: roleId }, data });
            return res.json({ success: true, role: updated });
        } catch (e: any) {
            if (e instanceof z.ZodError) return res.status(400).json({ success: false, errors: e.issues });
            if (e?.code === 'P2002') return res.status(400).json({ success: false, message: 'A role with that name already exists' });
            return res.status(500).json({ success: false, message: e.message });
        }
    }

    async remove(req: Request, res: Response) {
        try {
            const id = req.params.id as string;
            const roleId = req.params.roleId as string;
            if (!canManageRoles(req, id)) return res.status(403).json({ success: false, message: 'Permission denied' });
            const role = await prisma.workspaceRole.findFirst({
                where: { id: roleId, workspaceId: id },
                include: { _count: { select: { members: true, invitations: true } } },
            });
            if (!role) return res.status(404).json({ success: false, message: 'Role not found' });
            if (role.isSystem) return res.status(400).json({ success: false, message: 'System roles cannot be deleted' });
            if (role._count.members > 0) {
                return res.status(400).json({ success: false, message: `${role._count.members} member(s) still use this role — reassign them first` });
            }
            await prisma.workspaceRole.delete({ where: { id: roleId } });
            return res.json({ success: true });
        } catch (e: any) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }
}

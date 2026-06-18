import { prisma } from './prisma';
import { logger } from '../utils/logger';
import { SYSTEM_ROLES } from './permissions';

// Ensures every workspace has the seeded system roles (Admin / Member /
// Viewer) and that every existing WorkspaceMember + WorkspaceInvitation
// has a `roleId` pointing at the right one. Owner rows keep their
// legacy `role: 'OWNER'` string and intentionally have no roleId — owner
// access is determined by Workspace.ownerId, not by a role row.
export async function ensureWorkspaceRoles() {
    const workspaces = await prisma.workspace.findMany({ select: { id: true } });
    if (!workspaces.length) return;

    let touched = 0;
    for (const ws of workspaces) {
        const existing = await prisma.workspaceRole.findMany({
            where: { workspaceId: ws.id },
            select: { id: true, name: true, isSystem: true },
        });
        const byName = new Map(existing.map(r => [r.name, r]));

        for (const tmpl of SYSTEM_ROLES) {
            if (byName.has(tmpl.name)) continue;
            await prisma.workspaceRole.create({
                data: {
                    workspaceId: ws.id,
                    name: tmpl.name,
                    description: tmpl.description,
                    permissions: tmpl.permissions as any,
                    isSystem: true,
                },
            });
            touched++;
        }

        const roles = await prisma.workspaceRole.findMany({
            where: { workspaceId: ws.id },
            select: { id: true, name: true },
        });
        const roleIdByName: Record<string, string> = {};
        roles.forEach(r => { roleIdByName[r.name.toUpperCase()] = r.id; });

        // Map legacy role string → seeded role
        function resolveRoleId(legacy: string): string | null {
            const key = (legacy || 'MEMBER').toUpperCase();
            if (key === 'OWNER') return null; // owner stays implicit
            if (key === 'ADMIN')  return roleIdByName['ADMIN']  || null;
            if (key === 'VIEWER') return roleIdByName['VIEWER'] || null;
            return roleIdByName['MEMBER'] || null;
        }

        const members = await prisma.workspaceMember.findMany({
            where: { workspaceId: ws.id, roleId: null },
            select: { id: true, role: true },
        });
        for (const m of members) {
            const rid = resolveRoleId(m.role);
            if (m.role.toUpperCase() === 'OWNER') continue; // keep OWNER as-is
            if (!rid) continue;
            await prisma.workspaceMember.update({
                where: { id: m.id },
                data: { roleId: rid },
            });
            touched++;
        }

        const invites = await prisma.workspaceInvitation.findMany({
            where: { workspaceId: ws.id, roleId: null, acceptedAt: null },
            select: { id: true, role: true },
        });
        for (const i of invites) {
            const rid = resolveRoleId(i.role);
            if (!rid) continue;
            await prisma.workspaceInvitation.update({
                where: { id: i.id },
                data: { roleId: rid },
            });
            touched++;
        }
    }

    if (touched > 0) {
        logger.info(`[role-migration] seeded/remapped ${touched} role row(s)`);
    }
}

// Creates the three seeded roles for a brand-new workspace and returns
// the Member roleId (used as the default for invitations).
export async function seedRolesForWorkspace(workspaceId: string): Promise<string> {
    const existing = await prisma.workspaceRole.findMany({
        where: { workspaceId },
        select: { id: true, name: true },
    });
    const haveByName = new Map(existing.map(r => [r.name, r.id]));
    for (const tmpl of SYSTEM_ROLES) {
        if (haveByName.has(tmpl.name)) continue;
        const r = await prisma.workspaceRole.create({
            data: {
                workspaceId,
                name: tmpl.name,
                description: tmpl.description,
                permissions: tmpl.permissions as any,
                isSystem: true,
            },
            select: { id: true, name: true },
        });
        haveByName.set(r.name, r.id);
    }
    return haveByName.get('Member') || haveByName.get('Admin') || Array.from(haveByName.values())[0];
}

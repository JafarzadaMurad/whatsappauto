import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';
import { getWorkspaceId } from '../../lib/workspace-context';

const createProviderSchema = z.object({
    provider: z.enum(['OPENAI', 'CLAUDE', 'GEMINI', 'GLM']),
    apiKey: z.string().min(1),
    // Pro+ toggle. When true, the caller's own apiKey is used and
    // credits aren't deducted. The controller enforces plan gating —
    // Free/Starter workspaces get 403 on true regardless.
    useOwnKey: z.boolean().optional(),
});

export class AiProviderController {
    async listProviders(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const providers = await prisma.aiProvider.findMany({
                where: { workspaceId },
                select: { id: true, provider: true, apiKey: true, useOwnKey: true, createdAt: true }
            });
            const masked = providers.map(p => ({
                ...p,
                apiKey: p.apiKey.length > 8 ? `${p.apiKey.substring(0, 4)}...${p.apiKey.slice(-4)}` : '***'
            }));
            return res.status(200).json({ success: true, providers: masked });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async upsertProvider(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const workspaceId = getWorkspaceId(req);
            const data = createProviderSchema.parse(req.body);

            // useOwnKey requires a plan with allowCustomApiKeys.
            let useOwnKey = data.useOwnKey ?? false;
            if (useOwnKey && workspaceId) {
                const ws = await prisma.workspace.findUnique({
                    where: { id: workspaceId },
                    select: { plan: { select: { allowCustomApiKeys: true } } },
                });
                if (!ws?.plan?.allowCustomApiKeys) {
                    return res.status(403).json({
                        success: false,
                        message: 'Your plan does not allow bringing your own API key. Upgrade to Pro or higher.',
                    });
                }
            }

            // Unique constraint is on (userId, provider). Within a workspace,
            // find by workspaceId+provider; create on miss.
            const existing = await prisma.aiProvider.findFirst({
                where: { workspaceId, provider: data.provider }
            });
            if (existing) {
                await prisma.aiProvider.update({
                    where: { id: existing.id },
                    data: { apiKey: data.apiKey, useOwnKey },
                });
            } else {
                await prisma.aiProvider.create({
                    data: { userId, workspaceId, provider: data.provider, apiKey: data.apiKey, useOwnKey },
                });
            }

            return res.status(200).json({ success: true, message: 'Provider saved successfully' });
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, errors: error.issues });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    async deleteProvider(req: Request, res: Response) {
        try {
            const workspaceId = getWorkspaceId(req);
            const id = req.params.id as string;

            const provider = await prisma.aiProvider.findFirst({ where: { id, workspaceId } });
            if (!provider) {
                return res.status(404).json({ success: false, message: 'Provider not found' });
            }

            await prisma.aiProvider.delete({ where: { id } });
            return res.status(200).json({ success: true, message: 'Provider deleted' });
        } catch (error: any) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

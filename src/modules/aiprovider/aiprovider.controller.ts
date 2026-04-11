import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { z } from 'zod';

const createProviderSchema = z.object({
    provider: z.enum(['OPENAI', 'CLAUDE', 'GEMINI']),
    apiKey: z.string().min(1)
});

export class AiProviderController {
    async listProviders(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const providers = await prisma.aiProvider.findMany({
                where: { userId },
                // Mask the API keys partially for security
                select: {
                    id: true,
                    provider: true,
                    apiKey: true,
                    createdAt: true
                }
            });

            // masking API keys
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
            const data = createProviderSchema.parse(req.body);

            // We do upsert based on the unique combination of userId and provider
            // Prisma doesn't have direct upsert via multiple scalar fields unless it's a @@unique index.
            // We added @@unique([userId, provider]) in schema.prisma!

            const provider = await prisma.aiProvider.upsert({
                where: {
                    userId_provider: {
                        userId,
                        provider: data.provider
                    }
                },
                update: {
                    apiKey: data.apiKey
                },
                create: {
                    userId,
                    provider: data.provider,
                    apiKey: data.apiKey
                }
            });

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
            const userId = (req as any).user.id;
            const id = req.params.id as string;

            const provider = await prisma.aiProvider.findFirst({ where: { id, userId } });
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

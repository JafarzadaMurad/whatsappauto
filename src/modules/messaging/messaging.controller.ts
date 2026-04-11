import { Request, Response } from 'express';
import { MessagingService } from './messaging.service';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';

const messagingService = new MessagingService();

const sendTextSchema = z.object({
    instanceId: z.string().uuid(),
    to: z.string().min(5), // Phone number
    text: z.string().min(1)
});

export class MessagingController {
    async sendText(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const data = sendTextSchema.parse(req.body);

            // Ensure the instance belongs to the user
            const instance = await prisma.instance.findFirst({
                where: { id: data.instanceId, userId }
            });

            if (!instance) {
                return res.status(404).json({ success: false, message: 'Instance not found or unauthorized' });
            }

            const result = await messagingService.sendText(data.instanceId, data.to, data.text);
            return res.status(200).json({ success: true, message: result });

        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ success: false, errors: error.issues });
            }
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

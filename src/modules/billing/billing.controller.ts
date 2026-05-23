import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import { createCheckoutSession, createPortalSession, constructWebhookEvent, handleWebhookEvent } from './billing.service';

export class BillingController {
    async checkout(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { planId } = z.object({ planId: z.string().min(1) }).parse(req.body);
            const url = await createCheckoutSession(userId, planId);
            return res.json({ success: true, url });
        } catch (error: any) {
            if (error instanceof z.ZodError) return res.status(400).json({ success: false, errors: error.issues });
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    async portal(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const url = await createPortalSession(userId);
            return res.json({ success: true, url });
        } catch (error: any) {
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    // Stripe webhook — requires raw body for signature verification.
    // Mounted with express.raw() BEFORE the global JSON middleware.
    async webhook(req: Request, res: Response) {
        const signature = req.headers['stripe-signature'] as string;
        if (!signature) return res.status(400).send('Missing stripe-signature header');
        let event;
        try {
            event = await constructWebhookEvent(req.body, signature);
        } catch (err: any) {
            logger.warn({ err: err.message }, '[Stripe] webhook signature verification failed');
            return res.status(400).send(`Webhook signature error: ${err.message}`);
        }
        try {
            await handleWebhookEvent(event);
            return res.json({ received: true });
        } catch (err: any) {
            logger.error({ err: err.message, type: event.type }, '[Stripe] webhook handler failed');
            return res.status(500).send('Webhook handler error');
        }
    }
}

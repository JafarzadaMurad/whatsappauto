import { Router } from 'express';
import { InstagramController } from './instagram.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new InstagramController();

// Webhook endpoints (no auth - Meta calls these)
router.get('/webhook', controller.verifyWebhook.bind(controller));
router.post('/webhook', controller.handleWebhook.bind(controller));

// OAuth callback (no auth - redirect from Instagram)
router.get('/callback', controller.handleCallback.bind(controller));

// Authenticated endpoints
router.get('/auth-url', authMiddleware, controller.getAuthUrl.bind(controller));
router.get('/accounts', authMiddleware, controller.getAccounts.bind(controller));
router.post('/accounts', authMiddleware, controller.saveAccount.bind(controller));
router.put('/accounts/:id', authMiddleware, controller.updateAccount.bind(controller));
router.delete('/accounts/:id', authMiddleware, controller.deleteAccount.bind(controller));

export default router;

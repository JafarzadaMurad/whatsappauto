import { Router } from 'express';
import { WebhookController } from './webhook.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new WebhookController();

router.use(authMiddleware);

router.get('/', controller.listWebhooks);
router.post('/', controller.createWebhook);
router.delete('/:id', controller.deleteWebhook);

export default router;

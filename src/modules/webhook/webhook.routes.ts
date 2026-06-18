import { Router } from 'express';
import { WebhookController } from './webhook.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePerm } from '../../lib/workspace-context';

const router = Router();
const controller = new WebhookController();

router.use(authMiddleware);
router.use(requirePerm('webhooks', 'view'));

router.get('/', controller.listWebhooks);
router.post('/', requirePerm('webhooks', 'create'), controller.createWebhook);
router.delete('/:id', requirePerm('webhooks', 'delete'), controller.deleteWebhook);

export default router;

import { Router } from 'express';
import { MessagingController } from './messaging.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireChatWrite } from '../../lib/workspace-context';

const router = Router();
const controller = new MessagingController();

router.use(authMiddleware);

// Direct send endpoints are gated on chat.write — same capability the
// inbox /reply endpoint requires. API-key callers always have full owner
// permissions, so external integrations are unaffected.
router.post('/send-text', requireChatWrite, controller.sendText.bind(controller));
router.post('/send-media', requireChatWrite, controller.sendMedia.bind(controller));

export default router;

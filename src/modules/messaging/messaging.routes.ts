import { Router } from 'express';
import { MessagingController } from './messaging.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new MessagingController();

router.use(authMiddleware);

router.post('/send-text', controller.sendText);

export default router;

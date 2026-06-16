import { Router } from 'express';
import { InboxController } from './inbox.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new InboxController();

router.use(authMiddleware);

router.get('/accounts', controller.getAccounts.bind(controller));
router.get('/unified', controller.getUnified.bind(controller));
router.get('/conversations', controller.getConversations.bind(controller));
router.get('/messages', controller.getMessages.bind(controller));
router.post('/reply', controller.reply.bind(controller));
router.post('/mark-read', controller.markRead.bind(controller));

export default router;

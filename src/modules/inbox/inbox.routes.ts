import { Router } from 'express';
import { InboxController } from './inbox.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireChatView, requireChatWrite, requirePerm } from '../../lib/workspace-context';

const router = Router();
const controller = new InboxController();

router.use(authMiddleware);
router.use(requirePerm('inbox', 'view'));

router.get('/accounts', requireChatView, controller.getAccounts.bind(controller));
router.get('/unified', requireChatView, controller.getUnified.bind(controller));
router.get('/conversations', requireChatView, controller.getConversations.bind(controller));
router.get('/messages', requireChatView, controller.getMessages.bind(controller));
router.post('/reply', requireChatWrite, controller.reply.bind(controller));
router.post('/send-media', requireChatWrite, controller.sendMedia.bind(controller));
router.post('/mark-read', requireChatView, controller.markRead.bind(controller));
router.post('/refresh-profile-pic', requireChatView, controller.refreshProfilePic.bind(controller));
router.post('/assign-agent', requireChatWrite, controller.assignAgent.bind(controller));

export default router;

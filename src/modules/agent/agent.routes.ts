import { Router } from 'express';
import { AgentController } from './agent.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePerm } from '../../lib/workspace-context';

const router = Router();
const controller = new AgentController();

router.use(authMiddleware);
router.use(requirePerm('agents', 'view'));

router.get('/', controller.getAgents.bind(controller));
router.get('/:id', controller.getAgent.bind(controller));
router.post('/', requirePerm('agents', 'create'), controller.createAgent.bind(controller));
router.put('/:id', requirePerm('agents', 'update'), controller.updateAgent.bind(controller));
router.delete('/:id', requirePerm('agents', 'delete'), controller.deleteAgent.bind(controller));
router.get('/:id/conversations', controller.getConversations.bind(controller));
router.get('/:id/messages', controller.getConversationMessages.bind(controller));
router.get('/:id/stats', controller.getTokenStats.bind(controller));
router.get('/:id/activity', controller.getActivity.bind(controller));
router.post('/test-http-tool', requirePerm('agents', 'update'), controller.testHttpTool.bind(controller));
router.post('/:id/test-as-contact', requirePerm('agents', 'update'), controller.testAsContact.bind(controller));
router.post('/:id/reply', requirePerm('agents', 'update'), controller.replyToConversation.bind(controller));

export default router;

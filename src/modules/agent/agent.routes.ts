import { Router } from 'express';
import { AgentController } from './agent.controller';
import { AgentMediaController, agentMediaUpload } from './agent-media.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePerm } from '../../lib/workspace-context';

const router = Router();
const controller = new AgentController();
const mediaController = new AgentMediaController();

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

// Agent media library — files the LLM can send to a customer on demand.
router.get('/:id/media', mediaController.list.bind(mediaController));
router.post('/:id/media', requirePerm('agents', 'update'),
    agentMediaUpload.single('file'), mediaController.upload.bind(mediaController));
router.patch('/:id/media/:mediaId', requirePerm('agents', 'update'),
    mediaController.rename.bind(mediaController));
router.delete('/:id/media/:mediaId', requirePerm('agents', 'delete'),
    mediaController.remove.bind(mediaController));

export default router;

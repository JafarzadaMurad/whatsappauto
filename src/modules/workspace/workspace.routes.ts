import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { WorkspaceController } from './workspace.controller';

const router: Router = Router();
const controller = new WorkspaceController();

// Peek at an invite by token without being signed in (just shows the workspace name + intended email)
router.get('/invitations/:token', controller.peekInvite.bind(controller));

router.use(authMiddleware);

router.get('/', controller.list.bind(controller));
router.post('/', controller.create.bind(controller));
router.get('/:id', controller.get.bind(controller));
router.put('/:id', controller.update.bind(controller));
router.delete('/:id', controller.remove.bind(controller));

router.put('/:id/members/:memberId', controller.updateMember.bind(controller));
router.delete('/:id/members/:memberId', controller.removeMember.bind(controller));

router.post('/:id/invitations', controller.createInvite.bind(controller));
router.delete('/:id/invitations/:inviteId', controller.cancelInvite.bind(controller));
router.post('/invitations/:token/accept', controller.acceptInvite.bind(controller));

export default router;

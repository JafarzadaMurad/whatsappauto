import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceRoleController } from './workspace-role.controller';

const router: Router = Router();
const controller = new WorkspaceController();
const roleController = new WorkspaceRoleController();

// Peek at an invite by token without being signed in (just shows the workspace name + intended email)
router.get('/invitations/:token', controller.peekInvite.bind(controller));

router.use(authMiddleware);

// Permission catalogue — what the role editor uses to render itself. No
// workspace scope: it's the same for everyone.
router.get('/roles/catalog', roleController.catalog.bind(roleController));

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

// Role CRUD for a workspace
router.get('/:id/roles', roleController.list.bind(roleController));
router.post('/:id/roles', roleController.create.bind(roleController));
router.put('/:id/roles/:roleId', roleController.update.bind(roleController));
router.delete('/:id/roles/:roleId', roleController.remove.bind(roleController));

export default router;

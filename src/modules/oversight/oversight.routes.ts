import { Router } from 'express';
import { OversightController } from './oversight.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePerm } from '../../lib/workspace-context';

const router = Router();
const controller = new OversightController();

router.use(authMiddleware);

// Unread badge endpoint is read by every dashboard mount — keep it on
// view so collapsed-sidebar members still get the count, but everything
// else falls under the standard oversight gate.
router.get('/suggestions/unread', requirePerm('oversight', 'view'), controller.unreadCount.bind(controller));

router.use(requirePerm('oversight', 'view'));

router.get('/', controller.list.bind(controller));
router.post('/', requirePerm('oversight', 'create'), controller.create.bind(controller));
router.put('/:id', requirePerm('oversight', 'update'), controller.update.bind(controller));
router.delete('/:id', requirePerm('oversight', 'delete'), controller.remove.bind(controller));
router.post('/:id/run', requirePerm('oversight', 'update'), controller.runNow.bind(controller));

router.get('/suggestions', controller.listSuggestions.bind(controller));
router.post('/suggestions/mark-read', controller.markRead.bind(controller));
router.post('/suggestions/:id/approve', requirePerm('oversight', 'update'), controller.approve.bind(controller));
router.post('/suggestions/:id/reject', requirePerm('oversight', 'update'), controller.reject.bind(controller));

export default router;

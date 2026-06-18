import { Router } from 'express';
import { AutomationController } from './automation.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePerm } from '../../lib/workspace-context';

const router = Router();
const controller = new AutomationController();

router.use(authMiddleware);
router.use(requirePerm('automations', 'view'));

router.get('/', controller.list.bind(controller));
router.get('/:id', controller.get.bind(controller));
router.get('/:id/executions', controller.executions.bind(controller));
router.post('/', requirePerm('automations', 'create'), controller.create.bind(controller));
router.put('/:id', requirePerm('automations', 'update'), controller.update.bind(controller));
router.delete('/:id', requirePerm('automations', 'delete'), controller.remove.bind(controller));

export default router;

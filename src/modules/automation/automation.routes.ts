import { Router } from 'express';
import { AutomationController } from './automation.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new AutomationController();

router.use(authMiddleware);

router.get('/', controller.list.bind(controller));
router.get('/:id', controller.get.bind(controller));
router.get('/:id/executions', controller.executions.bind(controller));
router.post('/', controller.create.bind(controller));
router.put('/:id', controller.update.bind(controller));
router.delete('/:id', controller.remove.bind(controller));

export default router;

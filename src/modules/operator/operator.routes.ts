import { Router } from 'express';
import { OperatorController } from './operator.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new OperatorController();

router.use(authMiddleware);

router.get('/agent/:agentId', controller.list.bind(controller));
router.post('/agent/:agentId', controller.create.bind(controller));
router.get('/agent/:agentId/requests', controller.recentRequests.bind(controller));
router.put('/:id', controller.update.bind(controller));
router.delete('/:id', controller.remove.bind(controller));

export default router;

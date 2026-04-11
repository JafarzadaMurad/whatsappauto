import { Router } from 'express';
import { AgentController } from './agent.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new AgentController();

router.use(authMiddleware);

router.get('/', controller.getAgents.bind(controller));
router.get('/:id', controller.getAgent.bind(controller));
router.post('/', controller.createAgent.bind(controller));
router.put('/:id', controller.updateAgent.bind(controller));
router.delete('/:id', controller.deleteAgent.bind(controller));

export default router;

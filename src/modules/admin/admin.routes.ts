import { Router } from 'express';
import { AdminController } from './admin.controller';
import { AiModelsController } from '../aiprovider/aimodels.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const router = Router();
const controller = new AdminController();
const aiModelsController = new AiModelsController();

router.use(authMiddleware, requireAdmin);

router.get('/users', controller.listUsers.bind(controller));
router.put('/users/:id', controller.updateUser.bind(controller));
router.get('/config', controller.getConfig.bind(controller));
router.put('/config', controller.setConfig.bind(controller));

router.put('/ai-models', aiModelsController.set.bind(aiModelsController));

export default router;

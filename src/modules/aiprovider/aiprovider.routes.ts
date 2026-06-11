import { Router } from 'express';
import { AiProviderController } from './aiprovider.controller';
import { AiModelsController } from './aimodels.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new AiProviderController();
const modelsController = new AiModelsController();

router.use(authMiddleware);

router.get('/', controller.listProviders.bind(controller));
router.post('/', controller.upsertProvider.bind(controller)); // Use POST for upsert
router.delete('/:id', controller.deleteProvider.bind(controller));

// Available models catalogue — read by everyone, written by admin
// (admin route handles the PUT under /admin/ai-models).
router.get('/models', modelsController.list.bind(modelsController));

export default router;

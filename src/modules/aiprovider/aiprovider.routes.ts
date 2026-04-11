import { Router } from 'express';
import { AiProviderController } from './aiprovider.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new AiProviderController();

router.use(authMiddleware);

router.get('/', controller.listProviders.bind(controller));
router.post('/', controller.upsertProvider.bind(controller)); // Use POST for upsert
router.delete('/:id', controller.deleteProvider.bind(controller));

export default router;

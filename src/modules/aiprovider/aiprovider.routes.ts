import { Router } from 'express';
import { AiProviderController } from './aiprovider.controller';
import { AiModelsController } from './aimodels.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePerm } from '../../lib/workspace-context';

const router = Router();
const controller = new AiProviderController();
const modelsController = new AiModelsController();

router.use(authMiddleware);

// Available models catalogue — exposed to anyone authenticated so role
// editors and agent setup pages can render even when the user doesn't
// have provider write access. Registered BEFORE the provider gate.
router.get('/models', modelsController.list.bind(modelsController));

router.use(requirePerm('providers', 'view'));

router.get('/', controller.listProviders.bind(controller));
router.post('/', requirePerm('providers', 'create'), controller.upsertProvider.bind(controller));
router.delete('/:id', requirePerm('providers', 'delete'), controller.deleteProvider.bind(controller));

export default router;

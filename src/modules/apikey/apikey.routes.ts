import { Router } from 'express';
import { ApiKeyController } from './apikey.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePerm } from '../../lib/workspace-context';

const router = Router();
const controller = new ApiKeyController();

router.use(authMiddleware);
router.use(requirePerm('apikeys', 'view'));

router.post('/', requirePerm('apikeys', 'create'), controller.createKey.bind(controller));
router.get('/', controller.listKeys.bind(controller));
router.delete('/:id', requirePerm('apikeys', 'delete'), controller.deleteKey.bind(controller));

export default router;

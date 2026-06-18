import { Router } from 'express';
import { WhatsappController } from './whatsapp.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePerm } from '../../lib/workspace-context';

const router = Router();
const whatsappController = new WhatsappController();

router.use(authMiddleware);
router.use(requirePerm('whatsapp', 'view'));

router.get('/', whatsappController.listInstances);
router.post('/', requirePerm('whatsapp', 'create'), whatsappController.createInstance);
router.post('/:id/restart', requirePerm('whatsapp', 'update'), whatsappController.restartInstance);
router.put('/:id', requirePerm('whatsapp', 'update'), whatsappController.updateInstance);
router.delete('/:id', requirePerm('whatsapp', 'delete'), whatsappController.deleteInstance);

export default router;

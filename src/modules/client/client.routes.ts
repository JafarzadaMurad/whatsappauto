import { Router } from 'express';
import { ClientController } from './client.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePerm } from '../../lib/workspace-context';

const router = Router();
const controller = new ClientController();

router.use(authMiddleware);
router.use(requirePerm('contacts', 'view'));

router.get('/', controller.getClients.bind(controller));
router.post('/pause', requirePerm('contacts', 'update'), controller.pauseByPhone.bind(controller));
router.get('/:id', controller.getClient.bind(controller));
router.put('/:id', requirePerm('contacts', 'update'), controller.updateClient.bind(controller));
router.delete('/:id', requirePerm('contacts', 'delete'), controller.deleteClient.bind(controller));

export default router;

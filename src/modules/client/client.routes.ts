import { Router } from 'express';
import { ClientController } from './client.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new ClientController();

router.use(authMiddleware);

router.get('/', controller.getClients.bind(controller));
router.get('/:id', controller.getClient.bind(controller));
router.put('/:id', controller.updateClient.bind(controller));
router.delete('/:id', controller.deleteClient.bind(controller));

export default router;

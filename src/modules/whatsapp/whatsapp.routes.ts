import { Router } from 'express';
import { WhatsappController } from './whatsapp.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const whatsappController = new WhatsappController();

router.use(authMiddleware);

router.get('/', whatsappController.listInstances);
router.post('/', whatsappController.createInstance);
router.delete('/:id', whatsappController.deleteInstance);

export default router;

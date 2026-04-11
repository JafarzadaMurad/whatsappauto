import { Router } from 'express';
import { ApiKeyController } from './apikey.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new ApiKeyController();

// Use middleware to ensure only logged in users can manage keys
router.use(authMiddleware);

router.post('/', controller.createKey.bind(controller));
router.get('/', controller.listKeys.bind(controller));
router.delete('/:id', controller.deleteKey.bind(controller));

export default router;

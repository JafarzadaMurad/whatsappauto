import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { UserFieldController } from './userfield.controller';

const router: Router = Router();
const controller = new UserFieldController();

router.use(authMiddleware);

router.get('/', controller.list.bind(controller));
router.post('/', controller.create.bind(controller));
router.put('/reorder', controller.reorder.bind(controller));
router.put('/:id', controller.update.bind(controller));
router.delete('/:id', controller.remove.bind(controller));

export default router;

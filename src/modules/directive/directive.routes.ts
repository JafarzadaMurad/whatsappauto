import { Router } from 'express';
import { DirectiveController } from './directive.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new DirectiveController();

router.use(authMiddleware);

router.get('/by-contact', controller.byContact.bind(controller));
router.get('/', controller.list.bind(controller));
router.post('/', controller.create.bind(controller));
router.delete('/:id', controller.remove.bind(controller));

export default router;

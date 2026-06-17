import { Router } from 'express';
import { OversightController } from './oversight.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new OversightController();

router.use(authMiddleware);

router.get('/', controller.list.bind(controller));
router.post('/', controller.create.bind(controller));
router.put('/:id', controller.update.bind(controller));
router.delete('/:id', controller.remove.bind(controller));
router.post('/:id/run', controller.runNow.bind(controller));

router.get('/suggestions', controller.listSuggestions.bind(controller));
router.get('/suggestions/unread', controller.unreadCount.bind(controller));
router.post('/suggestions/mark-read', controller.markRead.bind(controller));
router.post('/suggestions/:id/approve', controller.approve.bind(controller));
router.post('/suggestions/:id/reject', controller.reject.bind(controller));

export default router;

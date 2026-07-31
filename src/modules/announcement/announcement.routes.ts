import { Router } from 'express';
import { AnnouncementController } from './announcement.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const router = Router();
const controller = new AnnouncementController();

router.use(authMiddleware);

// User-facing — every signed-in user reads their own feed.
router.get('/', controller.listForMe.bind(controller));
router.post('/read-all', controller.markAllRead.bind(controller));
router.post('/:id/read', controller.markRead.bind(controller));

// Admin-only authoring. Mounted under the same prefix so the frontend
// only has one base path to remember.
router.get('/admin/all', requireAdmin, controller.listAll.bind(controller));
router.post('/admin', requireAdmin, controller.create.bind(controller));
router.put('/admin/:id', requireAdmin, controller.update.bind(controller));
router.delete('/admin/:id', requireAdmin, controller.remove.bind(controller));

export default router;

import { Router } from 'express';
import { PlanController } from './plan.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const router = Router();
const controller = new PlanController();

// Authenticated user-facing endpoints
router.get('/me', authMiddleware, controller.getCurrent.bind(controller));
router.get('/public', authMiddleware, controller.listPublic.bind(controller));

// Admin-only — full CRUD + catalog for the model-picker in the editor
router.get('/', authMiddleware, requireAdmin, controller.list.bind(controller));
router.get('/model-catalog', authMiddleware, requireAdmin, controller.modelCatalog.bind(controller));
router.get('/voice-catalog', authMiddleware, requireAdmin, controller.voiceCatalog.bind(controller));
router.post('/', authMiddleware, requireAdmin, controller.create.bind(controller));
router.put('/:id', authMiddleware, requireAdmin, controller.update.bind(controller));
router.post('/:id/default', authMiddleware, requireAdmin, controller.setDefault.bind(controller));
router.delete('/:id/default', authMiddleware, requireAdmin, controller.clearDefault.bind(controller));
router.delete('/:id', authMiddleware, requireAdmin, controller.remove.bind(controller));

export default router;

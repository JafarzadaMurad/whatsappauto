import { Router } from 'express';
import { PlanController } from './plan.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const router = Router();
const controller = new PlanController();

// Public — active plans for the pricing page
router.get('/public', authMiddleware, controller.listPublic.bind(controller));

// Admin-only — full CRUD
router.get('/', authMiddleware, requireAdmin, controller.list.bind(controller));
router.post('/', authMiddleware, requireAdmin, controller.create.bind(controller));
router.put('/:id', authMiddleware, requireAdmin, controller.update.bind(controller));
router.delete('/:id', authMiddleware, requireAdmin, controller.remove.bind(controller));

export default router;

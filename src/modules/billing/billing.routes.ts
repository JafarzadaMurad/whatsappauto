import { Router } from 'express';
import { BillingController } from './billing.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new BillingController();

router.post('/checkout', authMiddleware, controller.checkout.bind(controller));
router.post('/portal', authMiddleware, controller.portal.bind(controller));

export default router;

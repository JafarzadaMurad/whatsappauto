import { Router } from 'express';
import { CreditsController, AiPricingController, AdminCreditsController } from './credits.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const userRouter = Router();
const controller = new CreditsController();
userRouter.use(authMiddleware);
userRouter.get('/balance', controller.getBalance.bind(controller));
userRouter.get('/history', controller.getHistory.bind(controller));

const adminPricingRouter = Router();
const pricingCtrl = new AiPricingController();
adminPricingRouter.use(authMiddleware, requireAdmin);
adminPricingRouter.get('/', pricingCtrl.list.bind(pricingCtrl));
adminPricingRouter.post('/', pricingCtrl.create.bind(pricingCtrl));
adminPricingRouter.post('/refresh-from-catalog', pricingCtrl.refreshFromCatalog.bind(pricingCtrl));
adminPricingRouter.put('/:id', pricingCtrl.update.bind(pricingCtrl));
adminPricingRouter.delete('/:id', pricingCtrl.remove.bind(pricingCtrl));

const adminCreditsRouter = Router();
const adminCreditsCtrl = new AdminCreditsController();
adminCreditsRouter.use(authMiddleware, requireAdmin);
adminCreditsRouter.get('/workspaces', adminCreditsCtrl.listWorkspaces.bind(adminCreditsCtrl));
adminCreditsRouter.post('/workspaces/:workspaceId/top-up', adminCreditsCtrl.topUp.bind(adminCreditsCtrl));
adminCreditsRouter.post('/workspaces/:workspaceId/reset', adminCreditsCtrl.reset.bind(adminCreditsCtrl));

export { userRouter, adminPricingRouter, adminCreditsRouter };

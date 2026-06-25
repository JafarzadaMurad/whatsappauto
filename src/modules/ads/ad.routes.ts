import { Router } from 'express';
import { AdController } from './ad.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new AdController();

router.use(authMiddleware);

// Routing rules CRUD
router.get('/routes', controller.listRoutes.bind(controller));
router.post('/routes', controller.createRoute.bind(controller));
router.put('/routes/:id', controller.updateRoute.bind(controller));
router.delete('/routes/:id', controller.deleteRoute.bind(controller));

// Discovery — what ads have brought traffic recently
router.get('/recent', controller.recentAds.bind(controller));

export default router;

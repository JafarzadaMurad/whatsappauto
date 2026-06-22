import { Router } from 'express';
import { AnalyticsController } from './analytics.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePerm } from '../../lib/workspace-context';

const router = Router();
const c = new AnalyticsController();

router.use(authMiddleware);
router.use(requirePerm('analytics', 'view'));

router.post('/query', c.query.bind(c));

router.get('/widgets',         c.listWidgets.bind(c));
router.post('/widgets',        c.createWidget.bind(c));
router.put('/widgets/:id',     c.updateWidget.bind(c));
router.delete('/widgets/:id',  c.deleteWidget.bind(c));

export default router;

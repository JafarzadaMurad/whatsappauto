import { Router } from 'express';
import { MetaController } from './meta.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new MetaController();

router.use(authMiddleware);

router.get('/auth-url', controller.authUrl.bind(controller));
router.post('/exchange', controller.exchange.bind(controller));

router.get('/accounts', controller.listAccounts.bind(controller));
router.post('/accounts', controller.saveAccounts.bind(controller));
router.delete('/accounts/:id', controller.deleteAccount.bind(controller));

router.get('/accounts/:id/ads', controller.listAds.bind(controller));
router.get('/accounts/:id/campaigns', controller.listCampaigns.bind(controller));
router.get('/accounts/:id/adsets', controller.listAdSets.bind(controller));

// Generic-level routes — :level is 'campaign' | 'adset' | 'ad'.
router.get('/accounts/:id/objects/:level/:objectId/insights', controller.objectInsights.bind(controller));
router.get('/accounts/:id/objects/:level/:objectId/contacts', controller.objectContacts.bind(controller));
router.post('/accounts/:id/objects/:level/:objectId/bind', controller.bindObject.bind(controller));
router.delete('/accounts/:id/objects/:level/:objectId/bind', controller.unbindObject.bind(controller));
router.post('/accounts/:id/objects/:level/:objectId/status', controller.setObjectStatus.bind(controller));

export default router;

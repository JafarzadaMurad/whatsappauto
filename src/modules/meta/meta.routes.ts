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
router.get('/accounts/:id/ads/:adId/insights', controller.adInsights.bind(controller));
router.get('/accounts/:id/ads/:adId/contacts', controller.adContacts.bind(controller));
router.post('/accounts/:id/ads/:adId/bind', controller.bindAd.bind(controller));
router.delete('/accounts/:id/ads/:adId/bind', controller.unbindAd.bind(controller));

export default router;

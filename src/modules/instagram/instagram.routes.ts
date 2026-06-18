import { Router } from 'express';
import { InstagramController } from './instagram.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePerm } from '../../lib/workspace-context';

const router = Router();
const controller = new InstagramController();

// Webhook endpoints (no auth - Meta calls these)
router.get('/webhook', controller.verifyWebhook.bind(controller));
router.post('/webhook', controller.handleWebhook.bind(controller));

// OAuth callback (no auth - redirect from Instagram)
router.get('/callback', controller.handleCallback.bind(controller));

const view   = requirePerm('instagram', 'view');
const create = requirePerm('instagram', 'create');
const update = requirePerm('instagram', 'update');
const remove = requirePerm('instagram', 'delete');

router.get('/auth-url',                              authMiddleware, view,   controller.getAuthUrl.bind(controller));
router.post('/exchange-code',                        authMiddleware, create, controller.exchangeCode.bind(controller));
router.get('/accounts',                              authMiddleware, view,   controller.getAccounts.bind(controller));
router.post('/accounts',                             authMiddleware, create, controller.saveAccount.bind(controller));
router.put('/accounts/:id',                          authMiddleware, update, controller.updateAccount.bind(controller));
router.delete('/accounts/:id',                       authMiddleware, remove, controller.deleteAccount.bind(controller));
router.get('/accounts/:id/profile',                  authMiddleware, view,   controller.getAccountProfile.bind(controller));
router.get('/accounts/:id/media',                    authMiddleware, view,   controller.getAccountMedia.bind(controller));
router.get('/accounts/:id/media/:mediaId/comments',  authMiddleware, view,   controller.getMediaComments.bind(controller));
router.post('/accounts/:id/comments/:commentId/reply', authMiddleware, update, controller.replyToMediaComment.bind(controller));

export default router;

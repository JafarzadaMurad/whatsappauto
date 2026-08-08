import { Router } from 'express';
import { AdminController } from './admin.controller';
import { AiModelsController } from '../aiprovider/aimodels.controller';
import { AiHubController } from './ai-hub.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const router = Router();
const controller = new AdminController();
const aiModelsController = new AiModelsController();
const aiHubController = new AiHubController();

router.use(authMiddleware, requireAdmin);

router.get('/users', controller.listUsers.bind(controller));
router.post('/users', controller.createUser.bind(controller));
router.get('/users/:id', controller.getUser.bind(controller));
router.put('/users/:id', controller.updateUser.bind(controller));
router.post('/users/:id/verify-email', controller.verifyEmail.bind(controller));
router.delete('/users/:id', controller.deleteUser.bind(controller));

// Per-user workspace helpers
router.post('/users/:id/workspaces', controller.createWorkspaceForUser.bind(controller));

// Cross-user workspace management (list + drill + mutate)
router.get('/workspaces', controller.listWorkspaces.bind(controller));
router.get('/workspaces/:id', controller.getWorkspace.bind(controller));
router.put('/workspaces/:id', controller.updateWorkspace.bind(controller));
router.delete('/workspaces/:id', controller.deleteWorkspace.bind(controller));
router.put('/workspaces/:id/transfer', controller.transferWorkspace.bind(controller));
router.post('/workspaces/:id/members', controller.addWorkspaceMember.bind(controller));
router.put('/workspaces/:id/members/:memberId', controller.updateWorkspaceMember.bind(controller));
router.delete('/workspaces/:id/members/:memberId', controller.removeWorkspaceMember.bind(controller));

router.get('/config', controller.getConfig.bind(controller));
router.put('/config', controller.setConfig.bind(controller));

router.put('/ai-models', aiModelsController.set.bind(aiModelsController));

// Merged AI providers view — keys + text catalogue + voice catalogue
// + pricing, one object per provider.
router.get('/ai-hub', aiHubController.overview.bind(aiHubController));

// The Claude subscription pool sits with the provider keys, because
// that is the same decision: what credential Claude calls run on.
router.get('/ai-hub/subscription', aiHubController.getSubscription.bind(aiHubController));
router.put('/ai-hub/subscription', aiHubController.saveSubscription.bind(aiHubController));

export default router;

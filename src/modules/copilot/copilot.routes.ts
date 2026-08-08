import { Router } from 'express';
import { CopilotController, AdminCopilotController } from './copilot.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const userRouter = Router();
const controller = new CopilotController();
userRouter.use(authMiddleware);
userRouter.get('/config', controller.config.bind(controller));
userRouter.post('/config', controller.saveCustomPrompt.bind(controller));
userRouter.get('/sessions', controller.listSessions.bind(controller));
userRouter.post('/sessions', controller.newSession.bind(controller));
userRouter.get('/sessions/:id', controller.getSession.bind(controller));
userRouter.post('/chat', controller.chat.bind(controller));
userRouter.post('/voice/session', controller.voiceSession.bind(controller));
userRouter.post('/voice/finish', controller.voiceFinish.bind(controller));
userRouter.get('/tool-schemas', controller.toolSchemas.bind(controller));
userRouter.post('/tool-call', controller.toolCall.bind(controller));

const adminRouter = Router();
const adminController = new AdminCopilotController();
adminRouter.use(authMiddleware, requireAdmin);
adminRouter.get('/', adminController.getSettings.bind(adminController));
adminRouter.put('/', adminController.saveSettings.bind(adminController));

export { userRouter as copilotUserRouter, adminRouter as adminCopilotRouter };

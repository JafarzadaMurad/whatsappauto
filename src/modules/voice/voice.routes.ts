import { Router } from 'express';
import { VoiceAssistantController } from './voice-assistant.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const controller = new VoiceAssistantController();

router.use(authMiddleware);

// Catalogue is auth-gated but not workspace-scoped — the editor uses
// it to render the provider dropdowns + presets before the assistant
// exists in the DB.
router.get('/catalog', controller.catalog.bind(controller));
router.post('/estimate', controller.estimate.bind(controller));

router.get('/assistants', controller.list.bind(controller));
router.post('/assistants', controller.create.bind(controller));
router.get('/assistants/:id', controller.get.bind(controller));
router.put('/assistants/:id', controller.update.bind(controller));
router.delete('/assistants/:id', controller.remove.bind(controller));

export default router;

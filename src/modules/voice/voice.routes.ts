import { Router } from 'express';
import { VoiceAssistantController } from './voice-assistant.controller';
import { PhoneNumberController } from './phone-number.controller';
import { VoiceWebhookController } from './voice-webhook.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const assistants = new VoiceAssistantController();
const numbers = new PhoneNumberController();
const webhook = new VoiceWebhookController();

// ─── Twilio webhooks — NO auth (Twilio hits these directly) ────────
// Signature verification could be added here; for MVP we accept any
// well-formed inbound and rely on the CallSid matching a row we own.
router.post('/webhook', webhook.webhook.bind(webhook));
router.post('/status', webhook.status.bind(webhook));

// ─── Dashboard-facing endpoints ────────────────────────────────────
router.use(authMiddleware);

router.get('/catalog', assistants.catalog.bind(assistants));
router.post('/estimate', assistants.estimate.bind(assistants));

router.get('/assistants', assistants.list.bind(assistants));
router.post('/assistants', assistants.create.bind(assistants));
router.get('/assistants/:id', assistants.get.bind(assistants));
router.put('/assistants/:id', assistants.update.bind(assistants));
router.delete('/assistants/:id', assistants.remove.bind(assistants));
router.post('/assistants/:id/test-session', assistants.testSession.bind(assistants));

router.get('/calls', assistants.listCalls.bind(assistants));

router.get('/twilio/status', numbers.twilioStatus.bind(numbers));
router.delete('/twilio', numbers.disconnectTwilio.bind(numbers));

router.get('/numbers', numbers.list.bind(numbers));
router.post('/numbers/search', numbers.search.bind(numbers));
router.post('/numbers/buy', numbers.buy.bind(numbers));
router.post('/numbers/import', numbers.importNumber.bind(numbers));
router.put('/numbers/:id', numbers.update.bind(numbers));
router.delete('/numbers/:id', numbers.release.bind(numbers));
router.post('/numbers/:id/outbound', numbers.outbound.bind(numbers));

export default router;

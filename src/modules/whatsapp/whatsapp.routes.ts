import { Router } from 'express';
import { WhatsappController } from './whatsapp.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePerm } from '../../lib/workspace-context';

const router = Router();
const whatsappController = new WhatsappController();

router.use(authMiddleware);
router.use(requirePerm('whatsapp', 'view'));

router.get('/', whatsappController.listInstances);
router.post('/', requirePerm('whatsapp', 'create'), whatsappController.createInstance);
// Single-instance status + QR polling for headless integrations
// (external CRMs). Both remain view-scope so read-only workspace
// members can still power a CRM in their own space.
router.get('/:id', whatsappController.getInstance);
router.get('/:id/qr', whatsappController.getQr);
// "Why didn't my message arrive?" — reports whether a number is on
// WhatsApp, the JID we'd address, and the cached LID mapping.
router.get('/:id/check-number', whatsappController.checkNumber);
router.post('/:id/restart', requirePerm('whatsapp', 'update'), whatsappController.restartInstance);
router.post('/:id/logout', requirePerm('whatsapp', 'update'), whatsappController.logoutInstance);
router.put('/:id', requirePerm('whatsapp', 'update'), whatsappController.updateInstance);
router.delete('/:id', requirePerm('whatsapp', 'delete'), whatsappController.deleteInstance);

export default router;

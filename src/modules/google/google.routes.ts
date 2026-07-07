import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { googleController } from './google.controller';

const router = Router();

// Public — Google hits this after the consent screen. Verifies state
// against the in-memory nonce store, so no auth middleware here.
router.get('/oauth/callback', googleController.callback.bind(googleController));

// Authenticated — every other endpoint needs the current workspace.
router.get('/oauth/status', authMiddleware, googleController.status.bind(googleController));
router.get('/oauth/authorize', authMiddleware, googleController.authorize.bind(googleController));
router.delete('/oauth/disconnect', authMiddleware, googleController.disconnect.bind(googleController));
router.get('/calendars', authMiddleware, googleController.listCalendars.bind(googleController));
router.put('/calendar', authMiddleware, googleController.setCalendar.bind(googleController));

export default router;

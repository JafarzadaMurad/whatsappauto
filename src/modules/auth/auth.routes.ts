import { Router } from 'express';
import { AuthController } from './auth.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();
const authController = new AuthController();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/me', authMiddleware, authController.me);
router.post('/verify-email', authController.verifyEmail.bind(authController));
router.post('/resend-verification', authMiddleware, authController.resendVerification.bind(authController));
router.post('/forgot-password', authController.forgotPassword.bind(authController));
router.post('/reset-password', authController.resetPassword.bind(authController));
router.get('/google/config', authController.googleConfig);
router.post('/google', authController.googleLogin);

export default router;

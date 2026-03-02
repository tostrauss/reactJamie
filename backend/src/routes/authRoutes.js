import express from 'express';
import { register, login, getProfile, updateProfile, completeOnboarding, changePassword, deleteAccount, forgotPassword, resetPassword, sendVerification, verifyEmail } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { strictLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
router.put('/onboarding', authenticate, completeOnboarding);
router.put('/password', authenticate, strictLimiter, changePassword);
router.delete('/account', authenticate, strictLimiter, deleteAccount);

// Password reset (public - no auth needed)
router.post('/forgot-password', strictLimiter, forgotPassword);
router.post('/reset-password', strictLimiter, resetPassword);

// Email verification (requires auth)
router.post('/send-verification', authenticate, sendVerification);
router.post('/verify-email', verifyEmail);

export default router;

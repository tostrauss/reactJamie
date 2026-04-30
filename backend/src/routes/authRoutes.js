import express from 'express';
import { register, login, logout, getProfile, updateProfile, completeOnboarding, changePassword, deleteAccount, exportData, forgotPassword, resetPassword, sendVerification, verifyEmail, sendEmailCode, verifyEmailCode, googleLogin, refreshToken } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { strictLimiter } from '../middleware/rateLimiter.js';
import { geofenceRegistration } from '../middleware/geofence.js';

const router = express.Router();

router.post('/register', geofenceRegistration, register);
router.post('/login', login);
router.post('/logout', logout);
router.post('/google', strictLimiter, googleLogin);
router.post('/refresh', authenticate, refreshToken);
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
router.put('/onboarding', authenticate, completeOnboarding);
router.put('/password', authenticate, strictLimiter, changePassword);
router.delete('/account', authenticate, strictLimiter, deleteAccount);
router.get('/export', authenticate, exportData);

// Password reset (public - no auth needed)
router.post('/forgot-password', strictLimiter, forgotPassword);
router.post('/reset-password', strictLimiter, resetPassword);

// Registration OTP (public - no auth needed)
router.post('/send-email-code', strictLimiter, sendEmailCode);
router.post('/verify-email-code', strictLimiter, verifyEmailCode);

// Email verification (requires auth)
router.post('/send-verification', authenticate, sendVerification);
router.post('/verify-email', verifyEmail);

export default router;

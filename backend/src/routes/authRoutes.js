import express from 'express';
import { register, login, logout, getProfile, updateProfile, completeOnboarding, changePassword, deleteAccount, exportData, forgotPassword, resetPassword, sendVerification, verifyEmail, sendEmailCode, verifyEmailCode, googleLogin, refreshToken } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { strictLimiter, authLimiter, registrationLimiter } from '../middleware/rateLimiter.js';
import { geofenceRegistration } from '../middleware/geofence.js';

const router = express.Router();

router.post('/register', geofenceRegistration, registrationLimiter, register);
router.post('/login', authLimiter, login);
router.post('/logout', logout);
router.post('/google', strictLimiter, googleLogin);
// Refresh under the auth limiter (20/15min). Without this, a leaked token
// can be rotated indefinitely — defeating the lockout + TTL we rely on.
router.post('/refresh', authLimiter, authenticate, refreshToken);
router.get('/profile', authenticate, getProfile);
// Profile mutations: cap at 30/15min per user. updateProfile accepts JSON
// arrays (interests, photos) and triggers downstream text moderation; we
// don't want it abused as a free DoS amplifier into OpenAI.
router.put('/profile', authenticate, authLimiter, updateProfile);
router.put('/onboarding', authenticate, authLimiter, completeOnboarding);
router.put('/password', authenticate, strictLimiter, changePassword);
router.delete('/account', authenticate, strictLimiter, deleteAccount);
router.get('/export', authenticate, strictLimiter, exportData);

// Password reset (public - no auth needed)
router.post('/forgot-password', strictLimiter, forgotPassword);
router.post('/reset-password', strictLimiter, resetPassword);

// Registration OTP (public - no auth needed)
router.post('/send-email-code', registrationLimiter, sendEmailCode);
router.post('/verify-email-code', registrationLimiter, verifyEmailCode);

// Email verification (requires auth)
router.post('/send-verification', authenticate, sendVerification);
router.post('/verify-email', strictLimiter, verifyEmail);

export default router;

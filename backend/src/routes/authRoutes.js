import express from 'express';
import { register, login, logout, getProfile, updateProfile, completeOnboarding, changePassword, deleteAccount, exportData, forgotPassword, resetPassword, sendVerification, verifyEmail, sendEmailCode, verifyEmailCode, googleLogin, appleLogin, refreshToken } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { strictLimiter, registrationLimiter } from '../middleware/rateLimiter.js';
import { geofenceRegistration } from '../middleware/geofence.js';

const router = express.Router();

// NOTE: the whole router is mounted behind authLimiter (100/15min) in
// server.js, so routes below DON'T re-apply it — doing so double-counted every
// request and halved the effective limit. Sensitive ops add strictLimiter
// (5/h) on top; that 5/h binds first for them, which is intended.
router.post('/register', geofenceRegistration, registrationLimiter, register);
router.post('/login', login);
router.post('/logout', logout);
// Google/Apple use the standard authLimiter (via mount) — NOT strictLimiter:
// 5/h shared across an entire NAT (CGNAT carriers, event WiFi) locked out real
// users on their 6th social login of the hour.
router.post('/google', googleLogin);
router.post('/apple',  appleLogin);
router.post('/refresh', authenticate, refreshToken);
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
router.put('/onboarding', authenticate, completeOnboarding);
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

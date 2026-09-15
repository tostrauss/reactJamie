import express from 'express';
import { register, login, logout, getProfile, updateProfile, completeOnboarding, changePassword, deleteAccount, exportData, forgotPassword, resetPassword, sendVerification, verifyEmail, sendEmailCode, verifyEmailCode, googleLogin, googleLoginCode, appleLogin, refreshToken, updatePrivacyPreferences
} from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { strictLimiter, passwordResetLimiter, registrationLimiter } from '../middleware/rateLimiter.js';
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
// Auth-code redirect flow — see googleLoginCode's comment (no popup, works in
// the Android TWA/installed-PWA where the implicit popup flow dead-ended).
router.post('/google/code', googleLoginCode);
router.post('/apple',  appleLogin);
router.post('/refresh', authenticate, refreshToken);
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
// Settings -> Privatsphaere. Own route, not /api/push/preferences: a read
// receipt is not a push preference.
router.put('/privacy', authenticate, updatePrivacyPreferences);
router.put('/onboarding', authenticate, completeOnboarding);
router.put('/password', authenticate, strictLimiter, changePassword);
router.delete('/account', authenticate, strictLimiter, deleteAccount);
router.get('/export', authenticate, strictLimiter, exportData);

// Password reset (public - no auth needed). Own limiter with its own store
// prefix: sharing the 5/h strict bucket with /password + /account + /export +
// /verify-email meant one reset (2 calls) plus a verification click (1) used up
// an entire NAT's hourly budget — see rateLimiter.js, finding 5.
router.post('/forgot-password', passwordResetLimiter, forgotPassword);
router.post('/reset-password', passwordResetLimiter, resetPassword);

// Registration OTP (public - no auth needed)
router.post('/send-email-code', registrationLimiter, sendEmailCode);
router.post('/verify-email-code', registrationLimiter, verifyEmailCode);

// Email verification (requires auth)
router.post('/send-verification', authenticate, sendVerification);
// A one-click confirmation link is not a credential operation — it belongs on
// the registration limiter, not on the 5/h sensitive-ops bucket it used to
// silently drain.
router.post('/verify-email', registrationLimiter, verifyEmail);

export default router;

import express from 'express';
import { getVapidKey, subscribe, unsubscribe, saveApnsToken, reportPushDiagnostics } from '../controllers/pushController.js';
import { authenticate } from '../middleware/auth.js';
import { generalLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Pre-auth breadcrumb for the iOS token POST. Runs BEFORE authenticate on
// purpose: if the cookie/JWT is missing on api.jamie-app.com the request 401s,
// the app swallows it, saveApnsToken never runs — and until 2026-09-04 that
// case left no trace anywhere. One line, no token material, no user id.
const apnsTokenEntryLog = (req, _res, next) => {
  const auth = req.headers.authorization ? 'header' : (req.headers.cookie ? 'cookie' : 'none');
  console.log(`[APNs] apns-token POST received auth=${auth} platform=${req.get('x-client-platform') || '-'} len=${String(req.body?.token || '').length}`);
  next();
};

// Public — frontend needs the VAPID public key before subscribing
router.get('/vapid-key', generalLimiter, getVapidKey);

// Authenticated
router.post('/subscribe', authenticate, subscribe);
router.post('/unsubscribe', authenticate, unsubscribe);
router.post('/apns-token', apnsTokenEntryLog, authenticate, saveApnsToken);
// Native app reports what happened on the device (permission / registration
// outcome) so "no push" is diagnosable from Railway logs — see controller.
router.post('/diagnostics', generalLimiter, authenticate, reportPushDiagnostics);

export default router;

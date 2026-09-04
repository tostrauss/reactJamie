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
  // Header value is client-controlled → allowlist to a short identifier so it
  // can't carry control characters into the log viewer.
  const platform = String(req.get('x-client-platform') || '-').replace(/[^\w.-]/g, '').slice(0, 16) || '-';
  console.log(`[APNs] apns-token POST received auth=${auth} platform=${platform} len=${String(req.body?.token || '').length}`);
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
// No route-level generalLimiter: the SAME instance is already mounted on all
// of /api (server.js), and repeating it double-counts every request
// (express-rate-limit ERR_ERL_DOUBLE_COUNT). Sentry escalation is throttled
// per user inside the controller.
router.post('/diagnostics', authenticate, reportPushDiagnostics);

export default router;

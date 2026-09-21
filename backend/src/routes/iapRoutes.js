import express from 'express';
import { verifyApple, restoreApple } from '../controllers/iapController.js';
import { verifyGoogle, restoreGoogle } from '../controllers/googleIapController.js';
import { authenticate } from '../middleware/auth.js';
import { strictLimiter } from '../middleware/rateLimiter.js';
import { requirePayments } from '../middleware/requirePayments.js';

const router = express.Router();

// Receipt verification is rate-limited because each call hits Apple's
// servers; a flooded endpoint would burn through our quota.
router.post('/apple/verify',  authenticate, requirePayments, strictLimiter, verifyApple);
router.post('/apple/restore', authenticate, requirePayments, strictLimiter, restoreApple);

// Google Play Billing (Android-TWA). Same gates as Apple: JWT, the payments
// kill-switch ON the route, strict limiter (each call hits Google's API).
// The RTDN webhook (/google/notifications) is mounted raw in server.js.
router.post('/google/verify',  authenticate, requirePayments, strictLimiter, verifyGoogle);
router.post('/google/restore', authenticate, requirePayments, strictLimiter, restoreGoogle);

export default router;

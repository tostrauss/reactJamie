import express from 'express';
import { verifyApple, restoreApple } from '../controllers/iapController.js';
import { verifyGoogle, restoreGoogle } from '../controllers/googleIapController.js';
import { getPaymentsConfig, syncRevenueCat } from '../controllers/revenueCatController.js';
import { authenticate } from '../middleware/auth.js';
import { strictLimiter, iapSyncLimiter } from '../middleware/rateLimiter.js';
import { requirePayments } from '../middleware/requirePayments.js';

const router = express.Router();

// Which purchase paths are live (public, no secrets). Read by every client at
// app start, see revenueCatController.getPaymentsConfig.
router.get('/config', getPaymentsConfig);

// Receipt verification is rate-limited because each call hits Apple's
// servers; a flooded endpoint would burn through our quota.
router.post('/apple/verify',  authenticate, requirePayments, strictLimiter, verifyApple);
router.post('/apple/restore', authenticate, requirePayments, strictLimiter, restoreApple);

// RevenueCat (the iOS purchase path since 23.09.2026). The client only says
// "sync me"; the server asks RevenueCat. Own limiter, see iapSyncLimiter.
// The webhook (/revenuecat/webhook) is mounted in server.js.
router.post('/revenuecat/sync', authenticate, requirePayments, iapSyncLimiter, syncRevenueCat);

// Google Play Billing (Android-TWA). Same gates as RevenueCat: JWT, the
// payments kill-switch ON the route, and the per-user iapSyncLimiter (NOT the
// 5/h strictLimiter: verify runs right after Google has charged the user).
// The RTDN webhook (/google/notifications) is mounted raw in server.js.
router.post('/google/verify',  authenticate, requirePayments, iapSyncLimiter, verifyGoogle);
router.post('/google/restore', authenticate, requirePayments, iapSyncLimiter, restoreGoogle);

export default router;

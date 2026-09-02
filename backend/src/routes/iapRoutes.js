import express from 'express';
import { verifyApple, restoreApple } from '../controllers/iapController.js';
import { authenticate } from '../middleware/auth.js';
import { strictLimiter } from '../middleware/rateLimiter.js';
import { requirePayments } from '../middleware/requirePayments.js';

const router = express.Router();

// Receipt verification is rate-limited because each call hits Apple's
// servers; a flooded endpoint would burn through our quota.
router.post('/apple/verify',  authenticate, requirePayments, strictLimiter, verifyApple);
router.post('/apple/restore', authenticate, requirePayments, strictLimiter, restoreApple);

export default router;

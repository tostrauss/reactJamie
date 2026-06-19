import express from 'express';
import {
  getStatus, createSubscription, cancelSubscription, createPortalSession, withdrawSubscription,
} from '../controllers/subscriptionController.js';
import { authenticate } from '../middleware/auth.js';
import { strictLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.get('/status', authenticate, getStatus);
router.post('/create', authenticate, createSubscription);
router.post('/cancel', authenticate, cancelSubscription);
// Stripe Billing Portal — Pro user manages subscription/payment method/invoices.
router.post('/portal', authenticate, createPortalSession);
// 14-day Widerruf (immediate cancel + refund). strictLimiter: it moves money, so
// cap it like other sensitive actions (5/hour) to block abuse/double-fire.
router.post('/withdraw', authenticate, strictLimiter, withdrawSubscription);

export default router;

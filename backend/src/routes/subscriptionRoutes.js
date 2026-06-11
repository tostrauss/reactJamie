import express from 'express';
import {
  getStatus, createSubscription, cancelSubscription, createPortalSession,
} from '../controllers/subscriptionController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/status', authenticate, getStatus);
router.post('/create', authenticate, createSubscription);
router.post('/cancel', authenticate, cancelSubscription);
// Stripe Billing Portal — Pro user manages subscription/payment method/invoices.
router.post('/portal', authenticate, createPortalSession);

export default router;

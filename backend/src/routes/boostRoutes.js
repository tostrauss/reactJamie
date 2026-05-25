import express from 'express';
import {
  getCredits,
  getPackages,
  applyBoost,
  createStripeIntent,
  stripeWebhook,
  createPaypalOrder,
  capturePaypalOrder,
  redeemReferral,
} from '../controllers/boostController.js';
import { authenticate } from '../middleware/auth.js';
import { generalLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Wallet & packages
router.get('/credits', authenticate, getCredits);
router.get('/packages', generalLimiter, getPackages);
router.get('/paypal-client-id', authenticate, (_req, res) => res.json({ client_id: process.env.PAYPAL_CLIENT_ID || null }));

// Apply boost (spend a credit)
router.post('/apply', authenticate, applyBoost);

// Referral
router.post('/redeem-referral', authenticate, redeemReferral);

// Stripe
router.post('/stripe/create-intent', authenticate, createStripeIntent);
// Stripe webhook needs raw body — mounted separately in server.js

// PayPal
router.post('/paypal/create-order', authenticate, createPaypalOrder);
router.post('/paypal/capture-order', authenticate, capturePaypalOrder);

export default router;

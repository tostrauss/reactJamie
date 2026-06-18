import express from 'express';
import {
  getCredits,
  getPackages,
  applyBoost,
  createStripeIntent,
  redeemReferral,
} from '../controllers/boostController.js';
import { authenticate } from '../middleware/auth.js';
import { generalLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Wallet & packages
router.get('/credits', authenticate, getCredits);
router.get('/packages', generalLimiter, getPackages);

// Apply boost (spend a credit)
router.post('/apply', authenticate, applyBoost);

// Referral
router.post('/redeem-referral', authenticate, redeemReferral);

// Stripe
router.post('/stripe/create-intent', authenticate, createStripeIntent);
// Stripe webhook needs raw body — mounted separately in server.js

export default router;

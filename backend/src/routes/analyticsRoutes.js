import express from 'express';
import { trackEvent, suggestCategory } from '../controllers/analyticsController.js';
import { optionalAuth } from '../middleware/auth.js';
import { generalLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// optionalAuth — works for both logged-in users and guests
router.post('/event', optionalAuth, generalLimiter, trackEvent);
router.post('/suggest-category', optionalAuth, generalLimiter, suggestCategory);

export default router;

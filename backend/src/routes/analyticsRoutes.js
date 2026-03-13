import express from 'express';
import { trackEvent, suggestCategory } from '../controllers/analyticsController.js';
import { optionalAuth } from '../middleware/auth.js';

const router = express.Router();

// optionalAuth — works for both logged-in users and guests
router.post('/event', optionalAuth, trackEvent);
router.post('/suggest-category', optionalAuth, suggestCategory);

export default router;

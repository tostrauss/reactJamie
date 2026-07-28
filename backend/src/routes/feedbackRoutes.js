import express from 'express';
import { submitFeedback } from '../controllers/feedbackController.js';
import { authenticate } from '../middleware/auth.js';
import { feedbackLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Authenticated (guests included when enabled — they store as anonymous).
// feedbackLimiter: 5/hour per user, keyed on req.userId, so it must run
// AFTER authenticate.
router.post('/', authenticate, feedbackLimiter, submitFeedback);

export default router;

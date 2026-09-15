import express from 'express';
import { submitContact } from '../controllers/contactController.js';
import { publicFormLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Public (no auth) — the marketing site has no session. Its OWN limiter
// (10/h per IP) keeps spam bounded; the controller adds a honeypot on top.
// It used to share the 5/h strict bucket with password reset, so a few contact
// submissions from one NAT could 429 a stranger's account recovery.
router.post('/', publicFormLimiter, submitContact);

export default router;

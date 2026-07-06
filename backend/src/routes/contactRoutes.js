import express from 'express';
import { submitContact } from '../controllers/contactController.js';
import { strictLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Public (no auth) — the marketing site has no session. strictLimiter (5/h
// per IP) keeps spam bounded; the controller adds a honeypot on top.
router.post('/', strictLimiter, submitContact);

export default router;

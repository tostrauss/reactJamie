import express from 'express';
import { getVapidKey, subscribe, unsubscribe, saveApnsToken } from '../controllers/pushController.js';
import { authenticate } from '../middleware/auth.js';
import { generalLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Public — frontend needs the VAPID public key before subscribing
router.get('/vapid-key', generalLimiter, getVapidKey);

// Authenticated
router.post('/subscribe', authenticate, subscribe);
router.post('/unsubscribe', authenticate, unsubscribe);
router.post('/apns-token', authenticate, saveApnsToken);

export default router;

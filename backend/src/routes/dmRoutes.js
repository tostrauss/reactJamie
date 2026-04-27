import express from 'express';
import rateLimit from 'express-rate-limit';
import { sendDM, getConversation, getConversations, markDMRead } from '../controllers/dmController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Tight per-user DM send limit: 10 messages/minute prevents spam & harassment
const dmSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => `dm_send_${req.userId || req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Nachrichten. Bitte warte eine Minute.' },
});

router.post('/', authenticate, dmSendLimiter, sendDM);
router.get('/conversations', authenticate, getConversations);
router.get('/:userId', authenticate, getConversation);
router.post('/:userId/read', authenticate, markDMRead);

export default router;
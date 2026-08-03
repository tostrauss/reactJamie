import express from 'express';
import { sendDM, getConversation, getConversations, markDMRead, setConversationArchived } from '../controllers/dmController.js';
import { authenticate } from '../middleware/auth.js';
import { dmSendLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/', authenticate, dmSendLimiter, sendDM);
router.get('/conversations', authenticate, getConversations);
router.get('/:userId', authenticate, getConversation);
router.post('/:userId/read', authenticate, markDMRead);
// Hide/unhide a DM conversation from the chat list (per-user)
router.put('/:userId/archive', authenticate, setConversationArchived);

export default router;
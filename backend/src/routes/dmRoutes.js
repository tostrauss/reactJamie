import express from 'express';
import { sendDM, getConversation, getConversations, markDMRead, setConversationArchived, deleteDM } from '../controllers/dmController.js';
import { authenticate } from '../middleware/auth.js';
import { dmSendLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/', authenticate, dmSendLimiter, sendDM);
router.get('/conversations', authenticate, getConversations);
// Admin takedown of one DM. Registered BEFORE '/:userId' — "message" would
// otherwise be swallowed as a userId by the conversation routes.
router.delete('/message/:id', authenticate, deleteDM);
router.get('/:userId', authenticate, getConversation);
router.post('/:userId/read', authenticate, markDMRead);
// Hide/unhide a DM conversation from the chat list (per-user)
router.put('/:userId/archive', authenticate, setConversationArchived);

export default router;
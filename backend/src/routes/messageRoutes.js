import express from 'express';
import { sendMessage, getMessages, deleteMessage, markChatRead } from '../controllers/messageController.js';
import { authenticate } from '../middleware/auth.js';
import { messageLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/', authenticate, messageLimiter, sendMessage);
router.get('/:groupId', authenticate, getMessages);
// Declared before DELETE /:messageId on purpose — distinct method, but keep
// the read-marker route visually next to its GET sibling.
router.post('/:groupId/read', authenticate, markChatRead);
router.delete('/:messageId', authenticate, deleteMessage);

export default router;

import express from 'express';
import { sendMessage, getMessages, deleteMessage } from '../controllers/messageController.js';
import { authenticate } from '../middleware/auth.js';
import { messageLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/', authenticate, messageLimiter, sendMessage);
router.get('/:groupId', authenticate, getMessages);
router.delete('/:messageId', authenticate, deleteMessage);

export default router;

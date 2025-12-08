import express from 'express';
import { sendMessage, getMessages, deleteMessage } from '../controllers/messageController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.post('/', authenticate, sendMessage);
router.get('/:groupId', getMessages);
router.delete('/:messageId', authenticate, deleteMessage);

export default router;

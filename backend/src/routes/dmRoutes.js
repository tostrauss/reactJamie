import express from 'express';
import { sendDM, getConversation, getConversations, markDMRead } from '../controllers/dmController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.post('/', authenticate, sendDM);
router.get('/conversations', authenticate, getConversations);
router.get('/:userId', authenticate, getConversation);
router.post('/:userId/read', authenticate, markDMRead);

export default router;
import express from 'express';
import { getNotifications, markRead } from '../controllers/notificationController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticate, getNotifications);
router.post('/mark-read', authenticate, markRead);

export default router;
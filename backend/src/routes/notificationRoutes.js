import express from 'express';
import { getNotifications, markRead, markSingleRead } from '../controllers/notificationController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticate, getNotifications);
router.post('/mark-read', authenticate, markRead);
router.post('/:id/read', authenticate, markSingleRead)

export default router;
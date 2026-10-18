import express from 'express';
import { getNotifications, getUnreadCount, markRead, markSingleRead } from '../controllers/notificationController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticate, getNotifications);
// The bell on Home (18.10.2026) — badge count only, capped server-side.
router.get('/unread-count', authenticate, getUnreadCount);
router.post('/mark-read', authenticate, markRead);
router.post('/:id/read', authenticate, markSingleRead)

export default router;

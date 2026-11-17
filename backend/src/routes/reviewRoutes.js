import express from 'express';
import { getPendingReviews, submitReview, dismissReview, getReviewForGroup, getMyAttendance } from '../controllers/reviewController.js';
import { getPendingConnect, dismissConnect } from '../controllers/connectController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/pending',            authenticate, getPendingReviews);
router.post('/',                  authenticate, submitReview);
router.post('/dismiss',           authenticate, dismissReview);
router.get('/for-group/:groupId', authenticate, getReviewForGroup);
router.get('/attendance',         authenticate, getMyAttendance);

// „Aus Fremden können Freundschaften werden!“ — the friends list after an
// event, for everybody but its creator (Tina 17.11.2026).
router.get('/connect/pending',    authenticate, getPendingConnect);
router.post('/connect/dismiss',   authenticate, dismissConnect);

export default router;

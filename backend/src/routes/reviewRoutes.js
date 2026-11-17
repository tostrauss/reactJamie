import express from 'express';
import { getPendingReviews, submitReview, dismissReview, getReviewForGroup, getMyAttendance } from '../controllers/reviewController.js';
import { getPendingConnect, dismissConnect } from '../controllers/connectController.js';
import { getPendingRatings, submitRating, dismissRating, getRatingsAdmin } from '../controllers/eventRatingController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { eventRatingLimiter } from '../middleware/rateLimiter.js';

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

// „Wie war’s bei X?“ — stars + feedback (Tina 17.11.2026). authenticate must
// run BEFORE the limiter so req.userId is set (the limiter keys on it): rating
// and closing share 30 per hour per user. The list is for app admins only.
router.get('/ratings/pending',    authenticate, getPendingRatings);
router.post('/ratings',           authenticate, eventRatingLimiter, submitRating);
router.post('/ratings/dismiss',   authenticate, eventRatingLimiter, dismissRating);
router.get('/ratings/admin',      authenticate, requireAdmin, getRatingsAdmin);

export default router;

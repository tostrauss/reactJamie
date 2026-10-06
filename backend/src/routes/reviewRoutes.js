import express from 'express';
import { getPendingReviews, submitReview, dismissReview, getReviewForGroup, getMyAttendance } from '../controllers/reviewController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/pending',            authenticate, getPendingReviews);
router.post('/',                  authenticate, submitReview);
router.post('/dismiss',           authenticate, dismissReview);
router.get('/for-group/:groupId', authenticate, getReviewForGroup);
router.get('/attendance',         authenticate, getMyAttendance);

export default router;

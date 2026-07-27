import express from 'express';
import { getPendingReviews, submitReview, dismissReview, getReviewForGroup } from '../controllers/reviewController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/pending',            authenticate, getPendingReviews);
router.post('/',                  authenticate, submitReview);
router.post('/dismiss',           authenticate, dismissReview);
router.get('/for-group/:groupId', authenticate, getReviewForGroup);

export default router;

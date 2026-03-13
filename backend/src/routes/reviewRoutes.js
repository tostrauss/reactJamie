import express from 'express';
import { getPendingReviews, submitReview } from '../controllers/reviewController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/pending', authenticate, getPendingReviews);
router.post('/',       authenticate, submitReview);

export default router;

import express from 'express';
import { joinWaitlist, getCountryVotes } from '../controllers/waitlistController.js';
import { publicFormLimiter, generalLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/', publicFormLimiter, joinWaitlist);
router.get('/votes', generalLimiter, getCountryVotes);

export default router;

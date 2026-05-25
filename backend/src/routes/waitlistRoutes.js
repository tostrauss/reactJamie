import express from 'express';
import { joinWaitlist, getCountryVotes } from '../controllers/waitlistController.js';
import { strictLimiter, generalLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/', strictLimiter, joinWaitlist);
router.get('/votes', generalLimiter, getCountryVotes);

export default router;

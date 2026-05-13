import express from 'express';
import { joinWaitlist, getCountryVotes } from '../controllers/waitlistController.js';
import { strictLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/', strictLimiter, joinWaitlist);
router.get('/votes', getCountryVotes);

export default router;

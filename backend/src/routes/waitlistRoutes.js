import express from 'express';
import { joinWaitlist, getCountryVotes } from '../controllers/waitlistController.js';

const router = express.Router();

router.post('/', joinWaitlist);
router.get('/votes', getCountryVotes);

export default router;

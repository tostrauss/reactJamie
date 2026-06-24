import express from 'express';
import { registerInterest, getInterest } from '../controllers/featureInterestController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticate, getInterest);
router.post('/', authenticate, registerInterest);

export default router;

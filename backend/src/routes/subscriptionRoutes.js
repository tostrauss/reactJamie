import express from 'express';
import { getStatus, createSubscription, cancelSubscription } from '../controllers/subscriptionController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/status', authenticate, getStatus);
router.post('/create', authenticate, createSubscription);
router.post('/cancel', authenticate, cancelSubscription);

export default router;

import express from 'express';
import { getUserById, searchUsers } from '../controllers/userController.js';
import { getUserHallOfFame } from '../controllers/hallOfFameController.js';
import { authenticate } from '../middleware/auth.js';
import { userSearchLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// The limiter is keyed on req.userId — after authenticate, never before.
router.get('/search', authenticate, userSearchLimiter, searchUsers)
// Events someone took part in — own (id "me") or another profile's public ones.
router.get('/:id/hall-of-fame', authenticate, getUserHallOfFame);
router.get('/:id', authenticate, getUserById);

export default router;
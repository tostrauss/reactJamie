import express from 'express';
import { getUserById, searchUsers } from '../controllers/userController.js';
import { getUserHallOfFame } from '../controllers/hallOfFameController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/search', authenticate, searchUsers)
// Events someone took part in — own (id "me") or another profile's public ones.
router.get('/:id/hall-of-fame', authenticate, getUserHallOfFame);
router.get('/:id', authenticate, getUserById);

export default router;
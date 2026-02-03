import express from 'express';
import { getUserById, searchUsers } from '../controllers/userController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/search', authenticate, searchUsers)
router.get('/:id', authenticate, getUserById);

export default router;
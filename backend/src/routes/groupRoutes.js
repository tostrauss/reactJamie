import express from 'express';
import { 
  createGroup, 
  getGroups, 
  getGroupById, 
  joinGroup, 
  leaveGroup, 
  toggleFavorite,
  getUserFavorites,
  getUserGroups
} from '../controllers/groupController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.post('/', authenticate, createGroup);
router.get('/', getGroups);
router.get('/user/favorites', authenticate, getUserFavorites);
router.get('/user/joined', authenticate, getUserGroups);
router.get('/:id', getGroupById);
router.post('/:id/join', authenticate, joinGroup);
router.post('/:id/leave', authenticate, leaveGroup);
router.post('/:id/favorite', authenticate, toggleFavorite);

export default router;

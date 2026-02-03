import express from 'express';
import {
  sendFriendRequest,
  respondFriendRequest,
  getPendingRequests,
  getSentRequests,
  getFriends,
  removeFriend,
  checkFriendship
} from '../controllers/friendshipController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Friend request actions
router.post('/request', authenticate, sendFriendRequest);
router.post('/request/:requestId', authenticate, respondFriendRequest);

// View requests
router.get('/requests/pending', authenticate, getPendingRequests);
router.get('/requests/sent', authenticate, getSentRequests);

// Friends list
router.get('/', authenticate, getFriends);

// Check & manage friendship
router.get('/status/:userId', authenticate, checkFriendship);
router.delete('/:friendId', authenticate, removeFriend);

export default router;
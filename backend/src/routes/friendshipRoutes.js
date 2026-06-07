import express from 'express';
import {
  sendFriendRequest,
  respondFriendRequest,
  getPendingRequests,
  getSentRequests,
  getFriends,
  removeFriend,
  checkFriendship,
  blockUser,
  unblockUser,
  getBlockedUsers
} from '../controllers/friendshipController.js';
import { authenticate } from '../middleware/auth.js';
import { friendRequestLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Friend request actions — friendRequestLimiter caps outbound at 20/hour per user
// so one bad actor can't spam push-notification-triggering requests at a victim.
// authenticate must run BEFORE the limiter so req.userId is set (the limiter keys on it).
router.post('/request', authenticate, friendRequestLimiter, sendFriendRequest);
router.post('/request/:requestId', authenticate, respondFriendRequest);

// View requests
router.get('/requests/pending', authenticate, getPendingRequests);
router.get('/requests/sent', authenticate, getSentRequests);

// Friends list
router.get('/', authenticate, getFriends);

// Check & manage friendship
router.get('/status/:userId', authenticate, checkFriendship);
router.delete('/:friendId', authenticate, removeFriend);

// Block / unblock — listed under /friends because the data lives in the
// friendships table; semantically distinct from the friend operations above.
router.post('/block', authenticate, blockUser);
router.delete('/block/:userId', authenticate, unblockUser);
router.get('/blocked', authenticate, getBlockedUsers);

export default router;
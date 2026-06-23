import express from 'express';
import {
  createGroup,
  getGroups,
  getGroupById,
  joinGroup,
  leaveGroup,
  toggleFavorite,
  getUserFavorites,
  toggleLike,
  getMyLikes,
  getGroupMembers,
  getUserGroups,
  getJoinRequests,
  handleJoinRequest,
  updateGroup,
  deleteGroup,
  getCategories,
  kickMember,
  cancelGroup,
  joinWaitlist,
  leaveWaitlist,
  getWaitlist,
  getUserWaitlistStatus,
  getGroupMemberAvatars,
  inviteMember,
  setGroupChatArchived
} from '../controllers/groupController.js';
import { authenticate, optionalAuth, requireCompleteProfile } from '../middleware/auth.js';
import { generalLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// ==========================================
// PUBLIC ROUTES (with optional auth for personalization)
// ==========================================
router.get('/', optionalAuth, getGroups);
router.get('/categories', generalLimiter, getCategories);

// ==========================================
// USER-SPECIFIC ROUTES (require auth)
// ==========================================
router.get('/user/favorites', authenticate, getUserFavorites);
router.get('/likes/mine', authenticate, getMyLikes);
router.get('/user/joined', authenticate, getUserGroups);
// Hide/unhide a group-or-club chat from the chat list (per-user)
router.put('/:id/archive', authenticate, setGroupChatArchived);

// ==========================================
// GROUP CRUD ROUTES
// ==========================================
router.post('/', authenticate, requireCompleteProfile, createGroup);
router.get('/:id', optionalAuth, getGroupById);
router.put('/:id', authenticate, updateGroup);
router.delete('/:id', authenticate, deleteGroup);

// ==========================================
// GROUP MEMBERSHIP ROUTES
// ==========================================
router.get('/:id/members', authenticate, getGroupMembers);
router.post('/:id/join', authenticate, requireCompleteProfile, joinGroup);
router.post('/:id/leave', authenticate, leaveGroup);
router.post('/:id/favorite', authenticate, toggleFavorite);
router.post('/:id/like', authenticate, toggleLike);

// ==========================================
// JOIN REQUEST ROUTES (for private groups)
// ==========================================
router.get('/:id/requests', authenticate, getJoinRequests);
router.post('/:id/requests/:requestId', authenticate, handleJoinRequest);

// ==========================================
// WAITLIST ROUTES (for full groups)
// ==========================================
router.post('/:id/waitlist/join', authenticate, requireCompleteProfile, joinWaitlist);
router.post('/:id/waitlist/leave', authenticate, leaveWaitlist);
router.get('/:id/waitlist', authenticate, getWaitlist);
router.get('/:id/waitlist/status', authenticate, getUserWaitlistStatus);

// ==========================================
// MEMBER AVATARS (for card display)
// ==========================================
router.get('/:id/members/avatars', optionalAuth, getGroupMemberAvatars);

// ==========================================
// ADMIN ACTIONS (owner only)
// ==========================================
router.delete('/:id/members/:userId', authenticate, kickMember);
router.post('/:id/invite/:friendId', authenticate, inviteMember);
router.post('/:id/cancel', authenticate, cancelGroup);

export default router;
import express from 'express';
import {
  createClub,
  getClubs,
  getClubById,
  joinClub,
  leaveClub,
  toggleClubFavorite,
  getUserFavoriteClubs,
  getClubMembers,
  getUserClubs,
  getClubJoinRequests,
  handleClubJoinRequest,
  updateClub,
  deleteClub,
  kickClubMember,
  addClubManager,
  removeClubManager,
  cancelClub,
  getCategories,
  getClubEvents,
  getDiscoverEvents,
  createClubEvent,
  deleteClubEvent,
} from '../controllers/clubController.js';
import {
  joinWaitlist,
  leaveWaitlist,
  getWaitlist,
  getUserWaitlistStatus,
  getGroupMemberAvatars
} from '../controllers/groupController.js';
import { authenticate, optionalAuth, requireCompleteProfile } from '../middleware/auth.js';
import { generalLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// ==========================================
// PUBLIC ROUTES (with optional auth for personalization)
// ==========================================
router.get('/', optionalAuth, getClubs);
router.get('/categories', generalLimiter, getCategories);
// Discover events from public clubs — declared before '/:id' so the literal
// path is never swallowed by the club-by-id param route.
router.get('/events/discover', optionalAuth, getDiscoverEvents);

// ==========================================
// USER-SPECIFIC ROUTES (require auth)
// ==========================================
router.get('/user/favorites', authenticate, getUserFavoriteClubs);
router.get('/user/joined', authenticate, getUserClubs);

// ==========================================
// CLUB CRUD ROUTES
// ==========================================
router.post('/', authenticate, requireCompleteProfile, createClub);
router.get('/:id', optionalAuth, getClubById);
router.put('/:id', authenticate, updateClub);
router.delete('/:id', authenticate, deleteClub);

// ==========================================
// CLUB MEMBERSHIP ROUTES
// ==========================================
router.get('/:id/members', authenticate, getClubMembers);
router.post('/:id/join', authenticate, requireCompleteProfile, joinClub);
router.post('/:id/leave', authenticate, leaveClub);
router.post('/:id/favorite', authenticate, toggleClubFavorite);

// ==========================================
// JOIN REQUEST ROUTES (for private clubs)
// ==========================================
router.get('/:id/requests', authenticate, getClubJoinRequests);
router.post('/:id/requests/:requestId', authenticate, handleClubJoinRequest);

// ==========================================
// WAITLIST ROUTES (for full clubs)
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
// CLUB EVENTS
// ==========================================
router.get('/:id/events', optionalAuth, getClubEvents);
router.post('/:id/events', authenticate, requireCompleteProfile, createClubEvent);
router.delete('/:id/events/:eventId', authenticate, deleteClubEvent);

// ==========================================
// CO-MANAGER ROUTES (owner only) — shared management for paid managed clubs
// ==========================================
router.post('/:id/managers', authenticate, addClubManager);
router.delete('/:id/managers/:userId', authenticate, removeClubManager);

// ==========================================
// ADMIN ACTIONS (owner only)
// ==========================================
router.delete('/:id/members/:userId', authenticate, kickClubMember);
router.post('/:id/cancel', authenticate, cancelClub);

export default router;


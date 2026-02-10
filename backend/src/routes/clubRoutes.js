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
  cancelClub,
  getCategories
} from '../controllers/clubController.js';
import { authenticate, optionalAuth, requireCompleteProfile } from '../middleware/auth.js';

const router = express.Router();

// ==========================================
// PUBLIC ROUTES (with optional auth for personalization)
// ==========================================
router.get('/', optionalAuth, getClubs);
router.get('/categories', getCategories);

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
// ADMIN ACTIONS (owner only)
// ==========================================
router.delete('/:id/members/:userId', authenticate, kickClubMember);
router.post('/:id/cancel', authenticate, cancelClub);

export default router;


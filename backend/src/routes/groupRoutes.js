import express from 'express';
import { 
  createGroup, 
  getGroups, 
  getGroupById, 
  joinGroup, 
  leaveGroup, 
  toggleFavorite,
  getUserFavorites,
  getGroupMembers,
  getUserGroups,
  getJoinRequests,
  handleJoinRequest,
  updateGroup,
  deleteGroup,
  getCategories,
  kickMember,
  cancelGroup
} from '../controllers/groupController.js';
import { authenticate, optionalAuth, requireCompleteProfile } from '../middleware/auth.js';

const router = express.Router();

// ==========================================
// PUBLIC ROUTES (with optional auth for personalization)
// ==========================================
router.get('/', optionalAuth, getGroups);
router.get('/categories', getCategories);

// ==========================================
// USER-SPECIFIC ROUTES (require auth)
// ==========================================
router.get('/user/favorites', authenticate, getUserFavorites);
router.get('/user/joined', authenticate, getUserGroups);

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

// ==========================================
// JOIN REQUEST ROUTES (for private groups)
// ==========================================
router.get('/:id/requests', authenticate, getJoinRequests);
router.post('/:id/requests/:requestId', authenticate, handleJoinRequest);

// ==========================================
// ADMIN ACTIONS (owner only)
// ==========================================
router.delete('/:id/members/:userId', authenticate, kickMember);
router.post('/:id/cancel', authenticate, cancelGroup);

export default router;
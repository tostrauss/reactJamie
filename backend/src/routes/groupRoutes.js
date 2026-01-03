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
  getCategories
} from '../controllers/groupController.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';

const router = express.Router();

// ==========================================
// PUBLIC ROUTES (with optional auth for personalization)
// ==========================================

// Get all groups (filters: type, category, search, location, upcoming)
router.get('/', optionalAuth, getGroups);

// Get categories list
router.get('/categories', getCategories);

// ==========================================
// USER-SPECIFIC ROUTES (require auth)
// ==========================================

// User's favorites
router.get('/user/favorites', authenticate, getUserFavorites);

// User's joined groups
router.get('/user/joined', authenticate, getUserGroups);

// ==========================================
// GROUP CRUD ROUTES
// ==========================================

// Create new group/club
router.post('/', authenticate, createGroup);

// Get single group details
router.get('/:id', optionalAuth, getGroupById);

// Update group (owner only)
router.put('/:id', authenticate, updateGroup);

// Delete group (owner only)
router.delete('/:id', authenticate, deleteGroup);

// ==========================================
// GROUP MEMBERSHIP ROUTES
// ==========================================

// Get group members
router.get('/:id/members', authenticate, getGroupMembers);

// Join group
router.post('/:id/join', authenticate, joinGroup);

// Leave group
router.post('/:id/leave', authenticate, leaveGroup);

// Toggle favorite
router.post('/:id/favorite', authenticate, toggleFavorite);

// ==========================================
// JOIN REQUEST ROUTES (for private groups)
// ==========================================

// Get pending join requests (owner only)
router.get('/:id/requests', authenticate, getJoinRequests);

// Handle join request (accept/reject)
router.post('/:id/requests/:requestId', authenticate, handleJoinRequest);

export default router;

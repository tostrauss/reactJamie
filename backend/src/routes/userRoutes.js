import express from 'express';
import { getUserById, searchUsers } from '../controllers/userController.js';
import {
  getUserHallOfFame, getMyProfileStats, hideMemory, unhideMemory,
} from '../controllers/hallOfFameController.js';
import { setMyClubOrder } from '../controllers/clubController.js';
import { getMyCommunityNudges, dismissCommunityNudge } from '../controllers/communityNudgeController.js';
import { authenticate } from '../middleware/auth.js';
import { userSearchLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// The limiter is keyed on req.userId — after authenticate, never before.
router.get('/search', authenticate, userSearchLimiter, searchUsers)
// Own profile only (26.10.2026): the stats row and taking a memory out of
// the own grid (+ undo). Literal /me paths, registered before /:id.
router.get('/me/profile-stats', authenticate, getMyProfileStats);
router.post('/me/hall-of-fame/:groupId/hide', authenticate, hideMemory);
router.delete('/me/hall-of-fame/:groupId/hide', authenticate, unhideMemory);
// „Sortieren“ of the profile's club bubbles (16.11.2026); read back through
// GET /api/clubs/user/joined.
router.put('/me/clubs/order', authenticate, setMyClubOrder);
// „Hey, [Community] hat Potenzial! ✨“ (17.11.2026): the creator's own
// communities that still have no meetup — the card on the home screen and
// its X. Literal /me paths, registered before /:id.
router.get('/me/community-nudges', authenticate, getMyCommunityNudges);
router.post('/me/community-nudges/:clubId/dismiss', authenticate, dismissCommunityNudge);
// Events someone took part in — own (id "me") or another profile's public ones.
router.get('/:id/hall-of-fame', authenticate, getUserHallOfFame);
router.get('/:id', authenticate, getUserById);

export default router;

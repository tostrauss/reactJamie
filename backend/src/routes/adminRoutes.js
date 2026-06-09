import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  getStats,
  getRecentUsers,
  getScreenTime,
  exportUsers,
  exportScreens,
  exportSuggestions,
  getPendingClubs,
  approveClub,
  rejectClub,
  deleteUser,
} from '../controllers/adminController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Rate limit on admin routes: 200 req/15min per IP. Admins are already gated
// by JWT + is_admin column, so this is just a brute-force/runaway-loop safety
// net. The previous limit of 30 locked a real admin out after a few minutes
// of normal dashboard navigation + CSV exports.
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Admin-Anfragen. Bitte warte 15 Minuten.' },
});

// All admin routes: must be authenticated + is_admin = true
router.use(adminLimiter, authenticate, requireAdmin);

router.get('/stats',       getStats);
router.get('/users',       getRecentUsers);
router.delete('/users/:id', deleteUser);
router.get('/screen-time', getScreenTime);
router.get('/export/users',       exportUsers);
router.get('/export/screens',     exportScreens);
router.get('/export/suggestions', exportSuggestions);

// Club approval queue
router.get('/clubs/pending',         getPendingClubs);
router.post('/clubs/:id/approve',    approveClub);
router.post('/clubs/:id/reject',     rejectClub);

export default router;

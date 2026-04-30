import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  getStats,
  getRecentUsers,
  getScreenTime,
  exportUsers,
  exportScreens,
  exportSuggestions,
} from '../controllers/adminController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Tight rate limit on admin routes: 30 requests/15min per IP
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Admin-Anfragen. Bitte warte 15 Minuten.' },
});

// All admin routes: must be authenticated + is_admin = true
router.use(adminLimiter, authenticate, requireAdmin);

router.get('/stats',       getStats);
router.get('/users',       getRecentUsers);
router.get('/screen-time', getScreenTime);
router.get('/export/users',       exportUsers);
router.get('/export/screens',     exportScreens);
router.get('/export/suggestions', exportSuggestions);

export default router;

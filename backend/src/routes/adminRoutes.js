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

const router = express.Router();

// Tight rate limit on admin routes: 30 requests/15min per IP
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Admin-Anfragen. Bitte warte 15 Minuten.' },
});

// All admin routes protected by X-Admin-Secret header + access logging
const adminAuth = (req, res, next) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers['x-admin-secret'] !== secret) {
    console.warn(`[admin] Unauthorized access attempt from ${req.ip} — ${req.method} ${req.path}`);
    return res.status(403).json({ error: 'Forbidden' });
  }
  console.log(`[admin] Access granted to ${req.ip} — ${req.method} ${req.path}`);
  next();
};

router.use(adminLimiter, adminAuth);

router.get('/stats',       getStats);
router.get('/users',       getRecentUsers);
router.get('/screen-time', getScreenTime);
router.get('/export/users',       exportUsers);
router.get('/export/screens',     exportScreens);
router.get('/export/suggestions', exportSuggestions);

export default router;

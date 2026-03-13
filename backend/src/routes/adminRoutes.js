import express from 'express';
import {
  getStats,
  getRecentUsers,
  getScreenTime,
  exportUsers,
  exportScreens,
  exportSuggestions,
} from '../controllers/adminController.js';

const router = express.Router();

// All admin routes protected by X-Admin-Secret header
const adminAuth = (req, res, next) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers['x-admin-secret'] !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
};

router.use(adminAuth);

router.get('/stats',       getStats);
router.get('/users',       getRecentUsers);
router.get('/screen-time', getScreenTime);
router.get('/export/users',       exportUsers);
router.get('/export/screens',     exportScreens);
router.get('/export/suggestions', exportSuggestions);

export default router;

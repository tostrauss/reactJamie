import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { createReport, getReports } from '../controllers/reportController.js';

const router = express.Router();

// Submit a report (any authenticated user)
router.post('/', authenticate, createReport);

// List reports — protected by ADMIN_SECRET header for now
// (until a proper admin role system is built in Phase 3)
router.get('/', (req, res, next) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers['x-admin-secret'] !== secret) {
    return res.status(403).json({ error: 'Zugriff verweigert' });
  }
  next();
}, getReports);

export default router;

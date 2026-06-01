import express from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { reportLimiter } from '../middleware/rateLimiter.js';
import { createReport, getReports } from '../controllers/reportController.js';

const router = express.Router();

// Submit a report (any authenticated user, capped at 10/hour to prevent flood)
router.post('/', authenticate, reportLimiter, createReport);

// List reports — admin only
router.get('/', authenticate, requireAdmin, getReports);

export default router;

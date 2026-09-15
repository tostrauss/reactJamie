import express from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { reportLimiter } from '../middleware/rateLimiter.js';
import { createReport, getReports, updateReportStatus } from '../controllers/reportController.js';

const router = express.Router();

// Submit a report (any authenticated user, capped at 10/hour to prevent flood)
router.post('/', authenticate, reportLimiter, createReport);

// List reports — admin only
router.get('/', authenticate, requireAdmin, getReports);

// Move a report through the queue (pending → reviewed/resolved/dismissed).
// Admin only, and deliberately NOT behind reportLimiter: that limiter caps a
// USER at 10 reports/hour to stop flooding, and would throttle an admin
// working through a backlog.
router.patch('/:id', authenticate, requireAdmin, updateReportStatus);

export default router;

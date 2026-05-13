import express from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { createReport, getReports } from '../controllers/reportController.js';

const router = express.Router();

// Submit a report (any authenticated user)
router.post('/', authenticate, createReport);

// List reports — admin only
router.get('/', authenticate, requireAdmin, getReports);

export default router;

import express from 'express';
import { getDeals, getDeal, createDeal, updateDeal, deleteDeal } from '../controllers/dealController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Pro-user routes
router.get('/',    authenticate, getDeals);
router.get('/:id', authenticate, getDeal);

// Admin routes
router.post('/',    authenticate, requireAdmin, createDeal);
router.put('/:id',  authenticate, requireAdmin, updateDeal);
router.delete('/:id', authenticate, requireAdmin, deleteDeal);

export default router;

import express from 'express';
import {
  getDeals, getDeal, createDeal, updateDeal, deleteDeal,
  getRedemptionStatus, redeemDeal,
  getDealsForAdmin, getDealRedemptions,
} from '../controllers/dealController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Admin routes — declared BEFORE the parametric `/:id` matchers so a path
// like `/admin/list` doesn't get swallowed as `:id = "admin"`.
router.get('/admin/list',           authenticate, requireAdmin, getDealsForAdmin);
router.get('/admin/:id/redemptions', authenticate, requireAdmin, getDealRedemptions);
router.post('/',    authenticate, requireAdmin, createDeal);
router.put('/:id',  authenticate, requireAdmin, updateDeal);
router.delete('/:id', authenticate, requireAdmin, deleteDeal);

// Pro-user routes
router.get('/',    authenticate, getDeals);
router.get('/:id', authenticate, getDeal);

// Redemption — once per (deal, user)
router.get('/:id/redemption', authenticate, getRedemptionStatus);
router.post('/:id/redeem',    authenticate, redeemDeal);

export default router;

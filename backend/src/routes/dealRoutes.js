import express from 'express';
import {
  getDeals, getDeal, createDeal, updateDeal, deleteDeal,
  getRedemptionStatus, redeemDeal,
  getDealsForAdmin, getDealRedemptions, startNewRound, setEventDeal, setEventDealFeed,
  getClubDeals, createClubDeal, updateClubDeal, deleteClubDeal,
} from '../controllers/dealController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Admin routes — declared BEFORE the parametric `/:id` matchers so a path
// like `/admin/list` doesn't get swallowed as `:id = "admin"`.
router.get('/admin/list',           authenticate, requireAdmin, getDealsForAdmin);
router.get('/admin/:id/redemptions', authenticate, requireAdmin, getDealRedemptions);
router.post('/admin/:id/new-round',  authenticate, requireAdmin, startNewRound);
// Hang a deal on an event / take it off (P4 v1, 16.11.2026) — admins, and
// since P4 v2 a club's managers for their own events and deals. The handler
// decides who may, so no requireAdmin here.
router.put('/event/:groupId',       authenticate, setEventDeal);
// „Im Gruppen-Feed zeigen“ for the club deal on an event (D-1, 18.11.2026) —
// app admins only.
router.put('/event/:groupId/feed',  authenticate, requireAdmin, setEventDealFeed);
// A club's own deals (P4 v2, 16.11.2026) — its owner and co-managers; the
// handlers check the club and, to put something up, JAMIE Pro.
router.get('/club/:clubId',            authenticate, getClubDeals);
router.post('/club/:clubId',           authenticate, createClubDeal);
router.put('/club/:clubId/:dealId',    authenticate, updateClubDeal);
router.delete('/club/:clubId/:dealId', authenticate, deleteClubDeal);
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

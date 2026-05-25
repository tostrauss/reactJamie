import express from 'express';
import { getMapPins } from '../controllers/mapController.js';
import { generalLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Public — no auth required (map is discoverable)
router.get('/pins', generalLimiter, getMapPins);

export default router;

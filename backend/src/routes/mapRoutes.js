import express from 'express';
import { getMapPins, geocodeQuery } from '../controllers/mapController.js';
import { generalLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Public — no auth required (map is discoverable)
router.get('/pins', generalLimiter, getMapPins);
// Launch-region geocode verifier — fallback for the create-group/club location field
router.get('/geocode', generalLimiter, geocodeQuery);

export default router;

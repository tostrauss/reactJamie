import express from 'express';
import { getMapPins, geocodeQuery } from '../controllers/mapController.js';
import { generalLimiter } from '../middleware/rateLimiter.js';
import { optionalAuth } from '../middleware/auth.js';

const router = express.Router();

// Still public — optionalAuth only READS the token when one is present so the
// pins can honour the same target-age gate the group feed applies. Guests (no
// token) keep seeing every public pin exactly as before.
router.get('/pins', generalLimiter, optionalAuth, getMapPins);
// Launch-region geocode verifier — fallback for the create-group/club location field
router.get('/geocode', generalLimiter, geocodeQuery);

export default router;

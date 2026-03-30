import express from 'express';
import { getMapPins } from '../controllers/mapController.js';

const router = express.Router();

// Public — no auth required (map is discoverable)
router.get('/pins', getMapPins);

export default router;

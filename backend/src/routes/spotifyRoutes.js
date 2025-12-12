import express from 'express';
import { searchTracks } from '../controllers/spotifyController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Define the search endpoint
router.get('/search', authenticate, searchTracks);

export default router;
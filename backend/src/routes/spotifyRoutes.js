import express from 'express';
import {
  searchTracks,
  getAuthUrl,
  handleCallback,
  getTopTracks,
  getRecentlyPlayed,
  disconnect,
  getStatus
} from '../controllers/spotifyController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Public search (uses Client Credentials)
router.get('/search', authenticate, searchTracks);

// Authorization Code Flow
router.get('/auth-url', authenticate, getAuthUrl);
router.post('/callback', authenticate, handleCallback);

// User-specific endpoints (require Spotify connection)
router.get('/top-tracks', authenticate, getTopTracks);
router.get('/recently-played', authenticate, getRecentlyPlayed);

// Connection management
router.get('/status', authenticate, getStatus);
router.post('/disconnect', authenticate, disconnect);

export default router;

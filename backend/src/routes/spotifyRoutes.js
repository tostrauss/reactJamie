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
import { authenticate, optionalAuth } from '../middleware/auth.js';

const router = express.Router();

// Public search (uses Client Credentials)
router.get('/search', authenticate, searchTracks);

// Authorization Code Flow
router.get('/auth-url', authenticate, getAuthUrl);
// optionalAuth: identity is derived from the OAuth state, so this completes
// even from an isolated in-app browser (iOS PWA) that lacks the auth cookie.
router.post('/callback', optionalAuth, handleCallback);

// User-specific endpoints (require Spotify connection)
router.get('/top-tracks', authenticate, getTopTracks);
router.get('/recently-played', authenticate, getRecentlyPlayed);

// Connection management
router.get('/status', authenticate, getStatus);
router.post('/disconnect', authenticate, disconnect);

export default router;

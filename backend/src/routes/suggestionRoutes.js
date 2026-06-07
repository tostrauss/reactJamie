import express from 'express';
import { getSuggestions } from '../controllers/suggestionController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Personalized suggestions — require auth so we can compute the score.
router.get('/', authenticate, getSuggestions);

export default router;

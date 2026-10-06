import express from 'express';
import { sendMessage, getMessages, deleteMessage, markChatRead, getMessageReceipts, setMessageReaction } from '../controllers/messageController.js';
import { authenticate } from '../middleware/auth.js';
import { createPoll, votePoll, closePoll } from '../controllers/pollController.js';
import { messageLimiter, reactionLimiter, pollCreateLimiter, pollVoteLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/', authenticate, messageLimiter, sendMessage);
// BEFORE '/:groupId' — otherwise "receipts" is swallowed as a group id.
// Author-only "Nachrichteninfo": who read this message, who merely received it.
router.get('/receipts/:id', authenticate, getMessageReceipts);
router.get('/:groupId', authenticate, getMessages);
// Declared before DELETE /:messageId on purpose — distinct method, but keep
// the read-marker route visually next to its GET sibling.
router.post('/:groupId/read', authenticate, markChatRead);
// Emoji reaction. PUT (not POST/DELETE): setting, replacing and clearing are
// one state change — `{ emoji: null }` removes.
router.put('/:messageId/reaction', authenticate, reactionLimiter, setMessageReaction);
// Chat polls (B1) — see controllers/pollController.js. POST / keeps rejecting
// message_type 'poll': a poll row only ever comes from here, with its data.
router.post('/:groupId/polls', authenticate, messageLimiter, pollCreateLimiter, createPoll);
router.put('/:messageId/poll/vote', authenticate, pollVoteLimiter, votePoll);
router.post('/:messageId/poll/close', authenticate, pollVoteLimiter, closePoll);
router.delete('/:messageId', authenticate, deleteMessage);

export default router;

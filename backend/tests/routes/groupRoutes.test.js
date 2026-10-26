import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

// ROUTE ORDER: the Hall-of-Fame / Memories reads sit next to '/:id' routes —
// answered by the wrong handler they would 500 (or leak a group by id). Every
// controller is a stub that names itself, so the assertion is simply "which
// handler answered" (pattern of featuredRoutes.test.js).
const stub = (name) => (_req, res) => res.json({ handler: name });
const stubs = (names) => Object.fromEntries(names.map((n) => [n, stub(n)]));
const pass = (_req, _res, next) => next();

vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: pass, optionalAuth: pass, requireCompleteProfile: pass,
}));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ generalLimiter: pass }));
vi.mock('../../src/controllers/groupController.js', () => stubs([
  'createGroup', 'getGroups', 'getGroupById', 'joinGroup', 'leaveGroup', 'toggleFavorite',
  'getUserFavorites', 'toggleLike', 'getMyLikes', 'getGroupMembers', 'getUserGroups',
  'getJoinRequests', 'getAllJoinRequests', 'handleJoinRequest', 'bulkAcceptJoinRequests',
  'updateGroup', 'deleteGroup', 'getCategories', 'kickMember', 'cancelGroup', 'joinWaitlist',
  'leaveWaitlist', 'getWaitlist', 'getUserWaitlistStatus', 'getGroupMemberAvatars',
  'inviteMember', 'setGroupChatArchived', 'setGroupNotifications', 'getHallOfFame',
]));
vi.mock('../../src/controllers/hallOfFameController.js', () => stubs([
  'getEventPhotos', 'addEventPhoto', 'deleteEventPhoto', 'getMemoryPrompts', 'getHallOfFameFriends',
]));

const groupRoutes = (await import('../../src/routes/groupRoutes.js')).default;
const app = express();
app.use(express.json());
app.use('/api/groups', groupRoutes);

const handlerOf = async (req) => (await req.expect(200)).body.handler;

describe('group routes — Memories', () => {
  it('the wall, its prompts and the friends feed reach their own handlers', async () => {
    expect(await handlerOf(request(app).get('/api/groups/hall-of-fame'))).toBe('getHallOfFame');
    expect(await handlerOf(request(app).get('/api/groups/hall-of-fame/prompts'))).toBe('getMemoryPrompts');
    expect(await handlerOf(request(app).get('/api/groups/hall-of-fame/friends'))).toBe('getHallOfFameFriends');
  });

  it('the neighbours still route as before', async () => {
    expect(await handlerOf(request(app).get('/api/groups/42'))).toBe('getGroupById');
    expect(await handlerOf(request(app).get('/api/groups/42/photos'))).toBe('getEventPhotos');
    expect(await handlerOf(request(app).get('/api/groups/likes/mine'))).toBe('getMyLikes');
  });
});

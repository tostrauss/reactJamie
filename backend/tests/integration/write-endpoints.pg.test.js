// ─────────────────────────────────────────────────────────────────────────────
// Real-Postgres integration smoke test for the WRITE endpoints.
//
// WHY: the unit tests mock `db.query`, so they pass on SQL a real Postgres
// rejects — type-deduction errors (the 42P08 that 500'd every profile save
// since 05.08), bad casts, constraint violations. This suite runs the actual
// controllers against a real database so that whole class of bug is caught
// before deploy. External I/O (geocoding, moderation) is mocked; the DB is real.
//
// RUN: needs a throwaway Postgres. Set SMOKE_DATABASE_URL and run
//   npm run test:smoke
// or use the one-shot local runner (spins up Docker, fresh DB, tears down):
//   npm run test:smoke:local
// Without SMOKE_DATABASE_URL the whole suite is skipped, so plain
// `vitest run` / CI without a database stays green.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SMOKE_URL = process.env.SMOKE_DATABASE_URL;

// Point the pool at the smoke DB BEFORE any module that imports database.js.
if (SMOKE_URL) {
  process.env.DATABASE_URL = SMOKE_URL;
  process.env.NODE_ENV = 'test'; // ssl off; no moderation keys → fail-open blocklist only
}

// Mock external geocoding so the create/update paths never hit the network.
vi.mock('../../src/utils/geocode.js', () => ({
  resolveCreateLocation: vi.fn(async () => ({ ok: true, coords: { lat: 48.2, lng: 16.37 } })),
  geocodeAllowedRegion: vi.fn(async () => ({ lat: 48.2, lng: 16.37, country: 'AT' })),
  geocodeLocation: vi.fn(async () => ({ lat: 48.2, lng: 16.37 })),
}));

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; return res; };
  return res;
};
const call = async (fn, req) => { const res = makeRes(); await fn(req, res, () => {}); return res; };
const avatar = 'https://app.jamie-app.com/media/uploads/a.webp';

const suite = SMOKE_URL ? describe : describe.skip;

suite('write endpoints against real Postgres', () => {
  let db, ctrl = {}, userId, groupId;

  beforeAll(async () => {
    db = (await import('../../src/config/database.js')).default;
    const { runStartupMigrations } = await import('../../src/config/migrations.js');

    // Production-faithful schema: canonical schema.sql THEN the real migrations.
    const schema = fs.readFileSync(path.join(__dirname, '../../src/config/schema.sql'), 'utf8');
    await db.query(schema);
    await runStartupMigrations();

    // Seed an owner WITH an avatar (create paths gate on creatorHasAvatar).
    const u = await db.query(
      `INSERT INTO users (email, name, date_of_birth, gender, avatar_url, onboarding_completed, auth_provider)
       VALUES ('smoke@x.com','Smoke','1995-03-03','female',$1, TRUE, 'email') RETURNING id`,
      [avatar]
    );
    userId = u.rows[0].id;

    const a = await import('../../src/controllers/authController.js');
    const g = await import('../../src/controllers/groupController.js');
    const c = await import('../../src/controllers/clubController.js');
    ctrl = { updateProfile: a.updateProfile, completeOnboarding: a.completeOnboarding,
             createGroup: g.createGroup, updateGroup: g.updateGroup, createClub: c.createClub };
  }, 90000);

  afterAll(async () => { await db?.pool?.end?.(); });

  it('updateProfile saves with a location (the 42P08 regression)', async () => {
    const res = await call(ctrl.updateProfile, { userId, body: {
      name: 'Smoke', bio: null, location: 'Wien', date_of_birth: '1995-03-03', gender: 'female',
      interests: ['Yoga'], avatar_url: avatar, photos: [], pinnwand: [], favorite_song: null } });
    expect(res.statusCode, JSON.stringify(res.body)).toBeLessThan(400);
  });

  it('updateProfile saves with location = null', async () => {
    const res = await call(ctrl.updateProfile, { userId, body: {
      name: 'Smoke', bio: null, location: null, date_of_birth: '1995-03-03', gender: 'female',
      interests: ['Yoga'], avatar_url: avatar, photos: [], pinnwand: [], favorite_song: null } });
    expect(res.statusCode, JSON.stringify(res.body)).toBeLessThan(400);
  });

  it('completeOnboarding saves', async () => {
    const res = await call(ctrl.completeOnboarding, { userId, body: {
      gender: 'female', location: 'Graz', interests: ['Wandern'], bio: 'hallo', photos: [],
      avatar_url: avatar, favorite_song: null } });
    expect(res.statusCode, JSON.stringify(res.body)).toBeLessThan(400);
  });

  it('createGroup inserts a group', async () => {
    const future = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const res = await call(ctrl.createGroup, { userId, body: {
      name: 'Smoke Group', description: 'desc', type: 'group', category: 'Sport',
      date: future, time: '18:00', location: 'Wien', max_members: 10 } });
    expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
    groupId = res.body?.id;
    expect(groupId).toBeTruthy();
  });

  it('updateGroup updates it (name + location)', async () => {
    const res = await call(ctrl.updateGroup, { userId, params: { id: String(groupId) }, body: {
      name: 'Smoke Group Renamed', location: 'Salzburg' } });
    expect(res.statusCode, JSON.stringify(res.body)).toBeLessThan(400);
  });

  it('createClub inserts a club', async () => {
    const res = await call(ctrl.createClub, { userId, body: {
      name: 'Smoke Club', description: 'a club', category: 'Sport', location: 'Wien', max_members: 50 } });
    expect(res.statusCode, JSON.stringify(res.body)).toBe(201);
  });
});

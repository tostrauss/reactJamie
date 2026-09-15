import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';

process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

// Everything the route does with the bytes is mocked — this suite is about the
// ROUTE: does a healthy upload get a response at all, and is the admission
// slot handed back on every exit path. That is precisely what had no coverage
// when a `req.destroyed` guard silently broke 100% of uploads (2026-09-15).
vi.mock('../../src/config/redis.js', () => ({ redisClient: null, redisSubscriber: null }));
vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
// The per-user hourly caps are real and correct; they just answer 429 long
// before these cases finish, and they are not what this file is testing.
// Voice has its OWN counter since 2026-09-15 — sharing the image budget meant
// 30 voice notes also locked you out of changing your avatar.
vi.mock('../../src/middleware/rateLimiter.js', () => ({
  uploadLimiter: (_req, _res, next) => next(),
  voiceUploadLimiter: (_req, _res, next) => next(),
}));
vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.userId = 1; next(); },
  extractToken: () => null,
  JWT_VERIFY_OPTS: {},
}));
vi.mock('../../src/config/storage.js', () => ({
  isCloudStorageEnabled: () => true,
  uploadToCloud: vi.fn(async () => '/media/uploads/test.webp'),
  putObjectToCloud: vi.fn(async () => {}),
  getObjectFromCloud: vi.fn(),
}));
vi.mock('../../src/config/moderation.js', () => ({
  checkImageSafety: vi.fn(async () => ({ safe: true, reason: null })),
}));
vi.mock('../../src/config/imageProcessor.js', () => ({
  processImage: vi.fn(async (buf) => ({ buffer: buf, mimetype: 'image/webp', extension: '.webp' })),
  generateThumbnail: vi.fn(async () => null),
  checkImageQuality: vi.fn(async () => ({ ok: true })),
}));

const uploadRoutes = (await import('../../src/routes/uploadRoutes.js')).default;

let server, baseUrl;
beforeAll(async () => {
  const app = express();
  app.use('/api/upload', uploadRoutes);
  await new Promise((r) => { server = app.listen(0, r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

// A minimal but REAL JPEG magic-byte prefix — detectMime reads the first bytes.
const jpeg = (bytes = 4096) => {
  const b = Buffer.alloc(bytes, 0x20);
  b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF;
  return b;
};

const postImage = (buf, field = 'image') => {
  const fd = new FormData();
  fd.append(field, new Blob([buf], { type: 'image/jpeg' }), 'photo.jpg');
  return fetch(`${baseUrl}/api/upload`, { method: 'POST', body: fd });
};

describe('POST /api/upload', () => {
  // THE regression this file exists for. `req.destroyed` is true on a healthy
  // request the moment multer finishes reading the body (IncomingMessage is a
  // Readable with autoDestroy), so guarding on it returned without sending
  // ANY response — every upload hung until the client's 10 s timeout, and an
  // avatar is a server-enforced precondition for joining anything.
  it('answers a healthy upload with a url', async () => {
    const res = await postImage(jpeg());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe('/media/uploads/test.webp');
  });

  it('answers repeated uploads — the admission slot is handed back', async () => {
    // More requests than MAX_UPLOADS_IN_FLIGHT (24). A leaked slot would make
    // the 25th hang or 503 rather than answer.
    for (let i = 0; i < 30; i++) {
      const res = await postImage(jpeg(1024));
      expect(res.status, `request ${i}`).toBe(200);
    }
  });

  it('answers concurrent uploads without deadlocking', async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => postImage(jpeg(1024))));
    for (const r of results) expect([200, 503]).toContain(r.status);
    // ...and the gate recovers afterwards.
    expect((await postImage(jpeg(1024))).status).toBe(200);
  });

  it('rejects a non-image and still frees its slot', async () => {
    const fd = new FormData();
    fd.append('image', new Blob([Buffer.from('not an image')], { type: 'text/plain' }), 'x.txt');
    const bad = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: fd });
    expect(bad.status).toBe(400);
    // The multer error branch returns without reaching the handler's finally —
    // the release has to come from the response lifecycle, not that finally.
    expect((await postImage(jpeg(1024))).status).toBe(200);
  });

  it('rejects a request with no file', async () => {
    const res = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: new FormData() });
    expect(res.status).toBe(400);
  });

  it('rejects bytes that only CLAIM to be an image', async () => {
    // Header says image/jpeg, magic bytes say otherwise.
    const fd = new FormData();
    fd.append('image', new Blob([Buffer.alloc(64, 0x41)], { type: 'image/jpeg' }), 'fake.jpg');
    const res = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: fd });
    expect(res.status).toBe(400);
  });

  it('survives a client that aborts mid-upload, and keeps serving after', async () => {
    const ctrl = new AbortController();
    const fd = new FormData();
    fd.append('image', new Blob([jpeg(2 * 1024 * 1024)], { type: 'image/jpeg' }), 'big.jpg');
    const p = fetch(`${baseUrl}/api/upload`, { method: 'POST', body: fd, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toBeTruthy();
    // The aborted request must not have kept its slot.
    expect((await postImage(jpeg(1024))).status).toBe(200);
  });
});

describe('POST /api/upload/voice', () => {
  const webm = (bytes = 2048) => {
    const b = Buffer.alloc(bytes, 0x11);
    // EBML header — what detectVoiceMime looks for.
    b[0] = 0x1A; b[1] = 0x45; b[2] = 0xDF; b[3] = 0xA3;
    return b;
  };

  const postVoice = (buf, durationMs = 4200, type = 'audio/webm') => {
    const fd = new FormData();
    fd.append('duration_ms', String(durationMs));
    fd.append('audio', new Blob([buf], { type }), 'voice.webm');
    return fetch(`${baseUrl}/api/upload/voice`, { method: 'POST', body: fd });
  };

  it('stores a recording and returns its url + duration', async () => {
    const res = await postVoice(webm());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe('/media/uploads/test.webp');   // mocked storage
    expect(body.duration_ms).toBe(4200);
    expect(body.mimetype).toBe('audio/webm');
  });

  it('detects an iOS MP4 recording by its ftyp box', async () => {
    const mp4 = Buffer.alloc(2048, 0);
    Buffer.from('ftyp').copy(mp4, 4);
    const res = await postVoice(mp4, 1000, 'audio/mp4');
    expect(res.status).toBe(200);
    expect((await res.json()).mimetype).toBe('audio/mp4');
  });

  it('clamps an absurd client-reported duration', async () => {
    const res = await postVoice(webm(), 999_999_999);
    expect((await res.json()).duration_ms).toBe(120_000);
  });

  it('rejects bytes that are not audio we produce', async () => {
    const res = await postVoice(Buffer.alloc(64, 0x41));
    expect(res.status).toBe(400);
  });

  it('rejects a non-audio content type outright', async () => {
    const fd = new FormData();
    fd.append('audio', new Blob([webm()], { type: 'image/jpeg' }), 'x.jpg');
    const res = await fetch(`${baseUrl}/api/upload/voice`, { method: 'POST', body: fd });
    expect(res.status).toBe(400);
  });

  it('keeps answering after a rejection — no leaked slot', async () => {
    await postVoice(Buffer.alloc(64, 0x41));
    expect((await postVoice(webm())).status).toBe(200);
  });
});

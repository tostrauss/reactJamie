import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { Readable } from 'node:stream';

process.env.NODE_ENV = 'test';

// The /media proxy in front of R2. Storage and sharp are mocked: this suite is
// about what the ROUTE answers when a derived variant cannot be produced.
//
// Tester report 06.10.2026, "einige konnten die Fotos nicht sehen": a chat
// bubble requests ?size=chat, and every non-404 failure on that path — an R2
// hiccup on the derived key, a sharp error, a failed shared generation — used
// to come back as 502. The bubble turned that single 502 into a permanent
// "Foto nicht verfügbar" for whoever had the chat open at that moment, while
// everybody else saw the photo. A variant is an optimisation; the original
// must still be served.
vi.mock('../../src/config/storage.js', () => ({
  isCloudStorageEnabled: () => true,
  getObjectFromCloud: vi.fn(),
  putObjectToCloud: vi.fn(async () => {}),
}));
vi.mock('../../src/config/imageProcessor.js', () => ({
  generateThumbnail: vi.fn(),
  generateChatVariant: vi.fn(),
}));

const storage = await import('../../src/config/storage.js');
const imageProcessor = await import('../../src/config/imageProcessor.js');
const mediaRoutes = (await import('../../src/routes/mediaRoutes.js')).default;

const missing = () => Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' });
const r2Down = () => Object.assign(new Error('We encountered an internal error.'), {
  name: 'InternalError', $metadata: { httpStatusCode: 500 },
});
const object = (text, type = 'image/webp') => ({
  Body: Readable.from([Buffer.from(text)]),
  ContentType: type,
  ContentLength: Buffer.byteLength(text),
});

let server, baseUrl;
beforeAll(async () => {
  const app = express();
  app.use('/media', mediaRoutes);
  await new Promise((r) => { server = app.listen(0, r); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

let errSpy;
beforeEach(() => {
  vi.mocked(storage.getObjectFromCloud).mockReset();
  vi.mocked(storage.putObjectToCloud).mockReset().mockResolvedValue(undefined);
  vi.mocked(imageProcessor.generateChatVariant).mockReset();
  errSpy?.mockRestore();
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

const get = (path) => fetch(`${baseUrl}/media/uploads/${path}`);

describe('GET /media/uploads/:file?size=chat', () => {
  it('streams the stored chat variant when it exists', async () => {
    vi.mocked(storage.getObjectFromCloud).mockImplementation(async (key) => {
      if (key === 'uploads/chat/p.webp') return object('VARIANT');
      throw missing();
    });
    const res = await get('p.webp?size=chat');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('VARIANT');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('serves the ORIGINAL (not 502) when generating the variant fails', async () => {
    vi.mocked(storage.getObjectFromCloud).mockImplementation(async (key) => {
      if (key === 'uploads/p.webp') return object('ORIGINAL');
      throw missing(); // no derived variant yet
    });
    vi.mocked(imageProcessor.generateChatVariant).mockRejectedValue(new Error('Input buffer contains unsupported image format'));

    const res = await get('p.webp?size=chat');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ORIGINAL');
    // Short-lived, NOT immutable: the URL still says ?size=chat, and pinning
    // the full original to it for a year would keep this browser from ever
    // picking up the real variant once the failure clears.
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('serves the original when reading the stored variant fails with a non-404 error', async () => {
    vi.mocked(storage.getObjectFromCloud).mockImplementation(async (key) => {
      if (key === 'uploads/chat/p.webp') throw r2Down();
      if (key === 'uploads/p.webp') return object('ORIGINAL');
      throw missing();
    });
    const res = await get('p.webp?size=chat');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ORIGINAL');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('still answers 404 when the original itself is gone', async () => {
    vi.mocked(storage.getObjectFromCloud).mockRejectedValue(missing());
    const res = await get('gone.webp?size=chat');
    expect(res.status).toBe(404);
  });

  it('a GIF (not re-encodable) falls through to the full object with the normal immutable cache', async () => {
    vi.mocked(storage.getObjectFromCloud).mockImplementation(async (key) => {
      if (key === 'uploads/a.gif') return object('GIF', 'image/gif');
      throw missing();
    });
    const res = await get('a.gif?size=chat');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('GIF');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(imageProcessor.generateChatVariant).not.toHaveBeenCalled();
  });

  it('generates, serves and writes back a missing variant', async () => {
    vi.mocked(storage.getObjectFromCloud).mockImplementation(async (key) => {
      if (key === 'uploads/p.webp') return object('ORIGINAL');
      throw missing();
    });
    vi.mocked(imageProcessor.generateChatVariant).mockResolvedValue({
      buffer: Buffer.from('MADE'), mimetype: 'image/webp',
    });
    const res = await get('p.webp?size=chat');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('MADE');
    expect(storage.putObjectToCloud).toHaveBeenCalledWith('uploads/chat/p.webp', expect.any(Buffer), 'image/webp');
  });

  it('a failed generation shared by concurrent requests serves every one of them', async () => {
    vi.mocked(storage.getObjectFromCloud).mockImplementation(async (key) => {
      if (key === 'uploads/p.webp') return object('ORIGINAL');
      throw missing();
    });
    vi.mocked(imageProcessor.generateChatVariant).mockRejectedValue(new Error('sharp died'));
    const all = await Promise.all([get('p.webp?size=chat'), get('p.webp?size=chat'), get('p.webp?size=chat')]);
    for (const res of all) {
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ORIGINAL');
    }
  });
});

describe('GET /media/uploads/:file (no variant)', () => {
  it('rejects traversal-shaped names', async () => {
    const res = await get('..%2Fsecret.webp');
    expect(res.status).toBe(400);
  });

  it('502 when R2 fails on the original itself', async () => {
    vi.mocked(storage.getObjectFromCloud).mockRejectedValue(r2Down());
    const res = await get('p.webp');
    expect(res.status).toBe(502);
  });
});

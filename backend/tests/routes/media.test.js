import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { Readable } from 'node:stream';

process.env.NODE_ENV = 'test';
// The variant source-read deadline (10 s in production), short for the tests.
process.env.MEDIA_SOURCE_DEADLINE_MS = '200';

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

// A stalled R2 read must not pin the shared generation: the SDK's request
// timeout ends at the response headers, so the proxy sets its own deadline
// over the GET + the body, then serves the original (short cache) and lets
// the next viewer start a fresh generation.
describe('variant source reads have a deadline', () => {
  const abortable = (signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });

  it('a GET that never answers: the original arrives in time, and the next request generates anew', async () => {
    let generations = 0;
    vi.mocked(storage.getObjectFromCloud).mockImplementation(async (key, opts) => {
      if (key === 'uploads/chat/h.webp') throw missing();
      if (opts?.abortSignal) { generations += 1; return abortable(opts.abortSignal); }
      return object('ORIGINAL');
    });
    const started = Date.now();
    const res = await get('h.webp?size=chat');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ORIGINAL');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(Date.now() - started).toBeLessThan(2_000);
    await (await get('h.webp?size=chat')).text();
    expect(generations).toBe(2); // the in-flight entry was released
  });

  it('a body that stalls mid-transfer is destroyed at the deadline', async () => {
    const stalled = new Readable({ read() {} }); // headers arrived, bytes never do
    vi.mocked(storage.getObjectFromCloud).mockImplementation(async (key, opts) => {
      if (key === 'uploads/chat/s.webp') throw missing();
      if (opts?.abortSignal) return { Body: stalled, ContentType: 'image/webp', ContentLength: 10 };
      return object('ORIGINAL');
    });
    const res = await get('s.webp?size=chat');
    expect(await res.text()).toBe('ORIGINAL');
    expect(stalled.destroyed).toBe(true);
  });
});

describe('a viewer who leaves while R2 is still answering', () => {
  it('does not leak the R2 stream', async () => {
    let answer;
    vi.mocked(storage.getObjectFromCloud).mockImplementation(() => new Promise((r) => { answer = r; }));
    const ac = new AbortController();
    const pending = fetch(`${baseUrl}/media/uploads/gone.webp`, { signal: ac.signal }).catch(() => null);
    while (!answer) await new Promise((r) => setTimeout(r, 5));
    ac.abort();
    await pending;
    await new Promise((r) => setTimeout(r, 50)); // let the server see the close
    const body = new Readable({ read() {} });
    answer({ Body: body, ContentType: 'image/webp', ContentLength: 4 });
    await new Promise((r) => setTimeout(r, 50));
    expect(body.destroyed).toBe(true);
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

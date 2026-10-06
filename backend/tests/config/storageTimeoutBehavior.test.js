import { describe, it, expect, afterAll } from 'vitest';
import net from 'node:net';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// What the R2 timeouts DO, against the real SDK (no mocks): a server that
// accepts the connection and never answers — a stalled R2 — must end in a
// TimeoutError. With requestTimeout alone the installed
// @smithy/node-http-handler only logs a warning and the GET hangs forever,
// which is exactly how a chat photo stayed a grey box (tester 06.10.2026).
const { STORAGE_TIMEOUTS } = await import('../../src/config/storage.js');

const sockets = new Set();
const server = net.createServer((s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
afterAll(() => {
  for (const s of sockets) s.destroy();
  return new Promise((r) => server.close(r));
});

const client = (handler) => new S3Client({
  region: 'auto',
  endpoint: `http://127.0.0.1:${server.address().port}`,
  forcePathStyle: true,
  credentials: { accessKeyId: 'k', secretAccessKey: 's' },
  maxAttempts: 1,
  requestHandler: handler,
});

describe('R2 timeouts abort a stalled request', () => {
  it('the shipped config turns the request timeout into an error', () => {
    expect(STORAGE_TIMEOUTS.throwOnRequestTimeout).toBe(true);
  });

  it('a GET against a server that never answers fails with TimeoutError', async () => {
    const started = Date.now();
    const err = await client({ ...STORAGE_TIMEOUTS, requestTimeout: 300 })
      .send(new GetObjectCommand({ Bucket: 'b', Key: 'uploads/p.webp' }))
      .then(() => null, (e) => e);
    expect(err?.name).toBe('TimeoutError');
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

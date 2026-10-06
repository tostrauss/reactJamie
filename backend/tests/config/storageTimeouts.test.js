import { describe, it, expect, vi } from 'vitest';

// The R2 client must time out: every photo, avatar and voice note is read
// through the /media proxy, and a stalled GET without a timeout was a chat
// photo that stayed a grey box forever (tester 06.10.2026, "einige konnten die
// Fotos nicht sehen"). Captures the S3Client config instead of hitting R2.
const configs = [];
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor(cfg) { configs.push(cfg); }
    async send() { return { Body: null }; }
  },
  PutObjectCommand: class {},
  GetObjectCommand: class {},
}));

process.env.STORAGE_ENDPOINT = 'https://account.r2.cloudflarestorage.com';
process.env.STORAGE_ACCESS_KEY = 'key';
process.env.STORAGE_SECRET_KEY = 'secret';
process.env.STORAGE_BUCKET = 'jamie-uploads';

const { getObjectFromCloud, STORAGE_TIMEOUTS } = await import('../../src/config/storage.js');

describe('R2 client timeouts', () => {
  it('passes the connection + request timeouts (which abort, see storageTimeoutBehavior) to the request handler', async () => {
    await getObjectFromCloud('uploads/p.webp');
    expect(configs).toHaveLength(1);
    expect(configs[0].requestHandler).toEqual(STORAGE_TIMEOUTS);
    expect(STORAGE_TIMEOUTS.connectionTimeout).toBeGreaterThan(0);
    expect(STORAGE_TIMEOUTS.requestTimeout).toBeGreaterThan(0);
  });
});

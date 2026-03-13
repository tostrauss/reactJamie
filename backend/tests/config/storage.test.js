import { describe, it, expect, beforeEach } from 'vitest';
import { isCloudStorageEnabled } from '../../src/config/storage.js';

describe('isCloudStorageEnabled', () => {
  const VARS = ['STORAGE_ENDPOINT', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY', 'STORAGE_BUCKET'];

  const setAll = () => {
    process.env.STORAGE_ENDPOINT   = 'https://account.r2.cloudflarestorage.com';
    process.env.STORAGE_ACCESS_KEY = 'key';
    process.env.STORAGE_SECRET_KEY = 'secret';
    process.env.STORAGE_BUCKET     = 'jamie-uploads';
  };

  const clearAll = () => VARS.forEach(k => delete process.env[k]);

  beforeEach(clearAll);

  it('returns false when no storage vars are set', () => {
    expect(isCloudStorageEnabled()).toBe(false);
  });

  it('returns false when only some vars are set', () => {
    process.env.STORAGE_ENDPOINT = 'https://example.com';
    process.env.STORAGE_ACCESS_KEY = 'key';
    expect(isCloudStorageEnabled()).toBe(false);
  });

  it('returns true when all required vars are set', () => {
    setAll();
    expect(isCloudStorageEnabled()).toBe(true);
  });
});

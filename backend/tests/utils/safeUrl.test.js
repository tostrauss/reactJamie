import { describe, it, expect, beforeAll } from 'vitest';

// Set before the module computes its allowlist.
process.env.STORAGE_PUBLIC_URL = 'https://cdn.jamie-app.com';
process.env.OLD_STORAGE_PUBLIC_URL = 'https://old-r2.example.com';
process.env.FRONTEND_URL = 'https://app.jamie-app.com,https://www.jamie-app.com';

const { isSafeImageUrl, isSafeVoiceUrl, checkImageField, allowedImageOrigins, _resetImageOrigins } =
  await import('../../src/utils/safeUrl.js');

beforeAll(() => { _resetImageOrigins(); });

describe('isSafeImageUrl origin allowlist (audit 2026-09-15, finding 17)', () => {
  it('accepts same-origin upload paths', () => {
    expect(isSafeImageUrl('/media/uploads/a.webp')).toBe(true);
    expect(isSafeImageUrl('/uploads/a.jpg')).toBe(true);
  });

  it('accepts the absolute URLs production actually mints', () => {
    // Rejecting these is the regression that broke every profile save in the
    // 42P08 incident — pinned so it cannot come back.
    expect(isSafeImageUrl('https://app.jamie-app.com/media/uploads/x.webp')).toBe(true);
    expect(isSafeImageUrl('https://cdn.jamie-app.com/uploads/x.webp')).toBe(true);
    expect(isSafeImageUrl('https://old-r2.example.com/uploads/x.webp')).toBe(true);
    expect(isSafeImageUrl('https://lh3.googleusercontent.com/a/abc123')).toBe(true);
  });

  it('REJECTS an arbitrary external host', () => {
    // The whole point: such a URL skipped Sightengine, skipped the entropy
    // backstop, and still counted as "has a profile photo".
    expect(isSafeImageUrl('https://attacker.tld/porn.jpg')).toBe(false);
    expect(isSafeImageUrl('http://192.0.2.1/x.png')).toBe(false);
    expect(isSafeImageUrl('https://cdn.jamie-app.com.attacker.tld/x.jpg')).toBe(false);
  });

  it('still rejects the non-http(s) and protocol-relative forms', () => {
    expect(isSafeImageUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeImageUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isSafeImageUrl('//attacker.tld/x.jpg')).toBe(false);
    expect(isSafeImageUrl('/\attacker.tld/x.jpg')).toBe(false);
    expect(isSafeImageUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeImageUrl('x'.repeat(1100))).toBe(false);
    expect(isSafeImageUrl(null)).toBe(false);
  });

  it('checkImageField treats absent as "no change" and rejects a bad value', () => {
    expect(checkImageField(undefined)).toBe(null);
    expect(checkImageField('')).toBe(null);
    expect(checkImageField('/media/uploads/a.webp')).toBe(null);
    expect(checkImageField('https://attacker.tld/x.jpg')).toMatch(/Ungültige/);
  });

  it('allowedImageOrigins reads every configured origin', () => {
    const o = allowedImageOrigins();
    expect(o.has('https://app.jamie-app.com')).toBe(true);
    expect(o.has('https://www.jamie-app.com')).toBe(true);
    expect(o.has('https://cdn.jamie-app.com')).toBe(true);
    expect(o.has('https://lh3.googleusercontent.com')).toBe(true);
  });
});

describe('unconfigured fallback', () => {
  // A hardening change must not be able to brick profile saving because an env
  // var is missing — that is the 42P08 regression class. With nothing
  // configured we degrade to "our own upload PATHS on any host", which is
  // still narrower than the old "any http(s) URL at all".
  it('accepts our upload paths but still rejects a foreign path', async () => {
    // Only FRONTEND_URL is removed: the fallback is keyed on the APP's own
    // origin specifically. STORAGE_PUBLIC_URL staying set is the realistic
    // half-configured case, and counting total list size instead would have
    // called that "configured" and silently rejected our own URLs.
    const saved = { o: process.env.OLD_STORAGE_PUBLIC_URL, f: process.env.FRONTEND_URL };
    delete process.env.OLD_STORAGE_PUBLIC_URL;
    delete process.env.FRONTEND_URL;
    _resetImageOrigins();
    try {
      expect(isSafeImageUrl('https://whatever.example/media/uploads/x.webp')).toBe(true);
      expect(isSafeImageUrl('https://attacker.tld/porn.jpg')).toBe(false);
      expect(isSafeImageUrl('https://attacker.tld/x/media/uploads/a.jpg')).toBe(false);
    } finally {
      process.env.OLD_STORAGE_PUBLIC_URL = saved.o;
      process.env.FRONTEND_URL = saved.f;
      _resetImageOrigins();
    }
  });

  it('once configured, a foreign host serving /media is rejected again', () => {
    _resetImageOrigins();
    expect(isSafeImageUrl('https://whatever.example/media/uploads/x.webp')).toBe(false);
  });
});

// Voice messages store a URL in `content`, which the client feeds straight to
// an <audio> element — so this is the boundary that keeps a chat message from
// becoming a way to point every group member's browser at arbitrary bytes.
describe('isSafeVoiceUrl', () => {
  it('accepts the two shapes the upload route mints', () => {
    expect(isSafeVoiceUrl('/media/uploads/abc123.webm')).toBe(true);   // cloud
    expect(isSafeVoiceUrl('/media/uploads/abc123.m4a')).toBe(true);    // iOS
    expect(isSafeVoiceUrl('/uploads/voice-1-ab12.webm')).toBe(true);   // local dev
    expect(isSafeVoiceUrl('https://app.jamie-app.com/media/uploads/u.webm')).toBe(true);
  });

  it('rejects a foreign host even with a plausible path', () => {
    // Stricter than the image check on purpose: a voice URL is never typed by
    // a user, it is always one this server minted seconds earlier.
    expect(isSafeVoiceUrl('https://attacker.tld/evil.webm')).toBe(false);
    expect(isSafeVoiceUrl('https://attacker.tld/media/uploads/evil.webm')).toBe(false);
  });

  it('rejects anything that is not an audio file we produce', () => {
    expect(isSafeVoiceUrl('/media/uploads/x.exe')).toBe(false);
    expect(isSafeVoiceUrl('/media/uploads/x.webp')).toBe(false);
    expect(isSafeVoiceUrl('nur ein text')).toBe(false);
    expect(isSafeVoiceUrl('javascript:alert(1)//x.webm')).toBe(false);
    expect(isSafeVoiceUrl(null)).toBe(false);
  });

  it('rejects traversal and extra path segments', () => {
    expect(isSafeVoiceUrl('/media/uploads/../../etc/passwd.webm')).toBe(false);
    expect(isSafeVoiceUrl('/media/uploads/a/b.webm')).toBe(false);
    expect(isSafeVoiceUrl('/media/x.webm')).toBe(false);
  });
});

// The shape production actually runs (config/storage.js documents
// STORAGE_PUBLIC_URL as the app's own origin + /media). The first version of
// this allowlist keyed its "configured?" marker on whether FRONTEND_URL GREW
// the origin set — which it does not here, because the storage value already
// contributed the same origin. The marker stayed false, the weak fallback took
// over, and the hardening was silently off in production only.
describe('production env shape (STORAGE_PUBLIC_URL is the app origin)', () => {
  it('stays configured, and still rejects a foreign host serving /media', () => {
    const saved = { s: process.env.STORAGE_PUBLIC_URL, o: process.env.OLD_STORAGE_PUBLIC_URL, f: process.env.FRONTEND_URL };
    process.env.STORAGE_PUBLIC_URL = 'https://app.jamie-app.com/media';
    delete process.env.OLD_STORAGE_PUBLIC_URL;
    process.env.FRONTEND_URL = 'https://app.jamie-app.com';
    _resetImageOrigins();
    try {
      expect(allowedImageOrigins()._hasAppOrigin).toBe(true);
      expect(isSafeImageUrl('https://app.jamie-app.com/media/uploads/x.webp')).toBe(true);
      // The bypass finding 17 exists to close.
      expect(isSafeImageUrl('https://attacker.tld/media/porn.jpg')).toBe(false);
      expect(isSafeVoiceUrl('https://attacker.tld/media/uploads/x.webm')).toBe(false);
    } finally {
      process.env.STORAGE_PUBLIC_URL = saved.s;
      process.env.OLD_STORAGE_PUBLIC_URL = saved.o;
      process.env.FRONTEND_URL = saved.f;
      _resetImageOrigins();
    }
  });

  it('a bare-path STORAGE_PUBLIC_URL ("/media") still leaves FRONTEND_URL as the marker', () => {
    const saved = { s: process.env.STORAGE_PUBLIC_URL, f: process.env.FRONTEND_URL };
    process.env.STORAGE_PUBLIC_URL = '/media';
    process.env.FRONTEND_URL = 'https://app.jamie-app.com';
    _resetImageOrigins();
    try {
      expect(allowedImageOrigins()._hasAppOrigin).toBe(true);
      expect(isSafeImageUrl('https://attacker.tld/media/porn.jpg')).toBe(false);
    } finally {
      process.env.STORAGE_PUBLIC_URL = saved.s;
      process.env.FRONTEND_URL = saved.f;
      _resetImageOrigins();
    }
  });
});

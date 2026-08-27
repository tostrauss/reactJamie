import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { checkImageQuality } from '../../src/config/imageProcessor.js';

// Real sharp images (no mocks) — the entropy floor is the whole point, so we
// verify it against actual pixels. Guards against a threshold change that would
// either let a solid-colour block through (Tina 2026-08-27) or start rejecting
// real photos.

const flatBlock = (rgb) =>
  sharp({ create: { width: 128, height: 128, channels: 3, background: rgb } })
    .webp()
    .toBuffer();

// Deterministic pseudo-random RGB noise (no Math.random → stable across runs)
// as a stand-in for a detail-rich real photo.
const noise = () => {
  const w = 128, h = 128, px = new Uint8Array(w * h * 3);
  let seed = 1234567;
  for (let i = 0; i < px.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    px[i] = seed & 0xff;
  }
  return sharp(Buffer.from(px), { raw: { width: w, height: h, channels: 3 } })
    .webp()
    .toBuffer();
};

describe('checkImageQuality (avatar entropy gate)', () => {
  it('rejects a solid-colour block (the "lila Bild")', async () => {
    const res = await checkImageQuality(await flatBlock({ r: 120, g: 8, b: 200 }), 'image/webp');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/einfarbige Fläche/);
    expect(res.entropy).toBeLessThan(1.8);
  });

  it('rejects a solid white block too', async () => {
    const res = await checkImageQuality(await flatBlock({ r: 255, g: 255, b: 255 }), 'image/webp');
    expect(res.ok).toBe(false);
  });

  it('accepts a detail-rich (high-entropy) image', async () => {
    const res = await checkImageQuality(await noise(), 'image/webp');
    expect(res.ok).toBe(true);
    expect(res.entropy).toBeGreaterThan(1.8);
  });

  it('passes GIFs through without analysis (animation preserved)', async () => {
    // A tiny buffer that is never a valid image — proves the gif branch returns
    // early instead of trying to decode.
    const res = await checkImageQuality(Buffer.from([0x47, 0x49, 0x46]), 'image/gif');
    expect(res.ok).toBe(true);
  });

  it('fails open on an undecodable buffer (never blocks on a decode error)', async () => {
    const res = await checkImageQuality(Buffer.from([0x00, 0x01, 0x02, 0x03]), 'image/webp');
    expect(res.ok).toBe(true);
  });
});

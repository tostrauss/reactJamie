// Image processing pipeline: resize + convert to WebP for efficient delivery.
// Most user uploads are 3-10 MB phone photos. We re-encode to ~80% quality WebP
// at sane max dimensions, which typically reduces size 10-50x with no visible loss.
import sharp from 'sharp';

// Animated GIFs are passed through unchanged — sharp would lose the animation
// in single-frame mode, and they're rare enough that the size hit is acceptable.
const PASSTHROUGH_MIMES = new Set(['image/gif']);

/**
 * Re-encode an uploaded image to WebP at the given max dimension.
 * Maintains aspect ratio, never upscales.
 *
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @param {object} opts
 * @param {number} [opts.maxDimension=1600]  Longest edge in px
 * @param {number} [opts.quality=80]         WebP quality 1-100
 * @returns {Promise<{buffer: Buffer, mimetype: string, extension: string}>}
 */
export async function processImage(buffer, mimetype, opts = {}) {
  const { maxDimension = 1600, quality = 80 } = opts;

  if (PASSTHROUGH_MIMES.has(mimetype)) {
    return { buffer, mimetype, extension: '.gif' };
  }

  const processed = await sharp(buffer, { failOn: 'truncated' })
    .rotate() // honor EXIF orientation, strip the tag
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality, effort: 4 })
    .toBuffer();

  return { buffer: processed, mimetype: 'image/webp', extension: '.webp' };
}

/**
 * Generate a small thumbnail variant for list/grid views.
 * Used alongside the full-size image so lists can load fast without
 * pulling down 200KB per card.
 */
export async function generateThumbnail(buffer, mimetype) {
  if (PASSTHROUGH_MIMES.has(mimetype)) return null;
  const buf = await sharp(buffer, { failOn: 'truncated' })
    .rotate()
    .resize({ width: 320, height: 320, fit: 'cover', position: 'attention' })
    .webp({ quality: 72, effort: 4 })
    .toBuffer();
  return { buffer: buf, mimetype: 'image/webp', extension: '.webp' };
}

// Minimum Shannon entropy (bits) an avatar must have. Measured on this sharp
// build: a solid colour block = 0.0, a two/three-tone fill ≈ 1.0, and even a
// dark/minimalist real photo ≈ 4.2 — so an entropy floor of 1.8 kills the
// "einfarbige Fläche" case (Tina 2026-08-27: someone used a plain purple block
// as their profile picture) with a wide margin above real photos. We gate on
// entropy ALONE on purpose: per-channel stdev is not a safe secondary — that
// same dark photo measured stdev 5.88, so an "OR stdev < 6" rule would wrongly
// reject it. stdev is returned for logging/tuning only, never to block.
const MIN_AVATAR_ENTROPY = 1.8;

/**
 * Quality gate for profile photos: reject visually-empty images (a solid
 * colour or near-blank block) so a flat fill can't satisfy the "has avatar"
 * requirement. Intended for avatar/profile-photo uploads only — group/club/
 * event banners may legitimately be a flat colour and must NOT run this.
 *
 * Fails OPEN (returns ok) if the image can't be analysed, mirroring the
 * moderation pipeline: a decode hiccup should not block a legitimate upload.
 * GIFs pass through (animated; stats() would read only the first frame).
 *
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @returns {Promise<{ok: boolean, reason?: string, entropy?: number, maxStdev?: number}>}
 */
export async function checkImageQuality(buffer, mimetype) {
  if (PASSTHROUGH_MIMES.has(mimetype)) return { ok: true };
  try {
    const stats = await sharp(buffer, { failOn: 'truncated' }).stats();
    const entropy = stats.entropy ?? 0;
    const maxStdev = Math.max(0, ...stats.channels.map((c) => c.stdev ?? 0));
    if (entropy < MIN_AVATAR_ENTROPY) {
      return {
        ok: false,
        reason: 'Dieses Bild wirkt wie eine einfarbige Fläche. Bitte lade ein echtes Foto von dir hoch.',
        entropy,
        maxStdev,
      };
    }
    return { ok: true, entropy, maxStdev };
  } catch (err) {
    // Fail-open: don't block an upload just because analysis threw.
    console.error('checkImageQuality failed (allowing upload):', err?.message || err);
    return { ok: true };
  }
}

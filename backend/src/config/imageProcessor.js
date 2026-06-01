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

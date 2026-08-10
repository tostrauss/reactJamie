/**
 * 320px card/list variant of an uploaded image (audit 2026-08-10).
 *
 * The /media proxy serves `?size=thumb` as a server-side 320px WebP
 * (generated once, then cached in R2 + browser). Lists were pulling the full
 * 1600px original (~100-300 KB) where ~15 KB does — the single biggest
 * bandwidth multiplier on cold-cache visitors.
 *
 * Use in CARD/LIST/AVATAR-ROW contexts only; detail views, profile pages and
 * the lightbox keep the original URL. Non-/media URLs (local dev /uploads,
 * external images, null) pass through untouched.
 */
export const thumbUrl = (url) =>
  typeof url === 'string' && url.includes('/media/uploads/') && !url.includes('?')
    ? `${url}?size=thumb`
    : url;

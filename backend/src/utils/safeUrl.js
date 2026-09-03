// Shared URL validators for user-supplied links that get rendered back to
// OTHER users. Kept in one place because the same check was previously
// duplicated in authController (avatar/photos) and dealController (booking_url)
// while the group/club entity image fields had no validation at all — those
// values render in the feed, on the map, in Discover Events and inside push
// deep-links, i.e. to every viewer.

// An image URL we are willing to store and re-serve.
//   - same-origin "/media/…" or "/uploads/…" (what our own upload route mints;
//     production serves R2 through the same-origin /media proxy)
//   - otherwise an absolute http(s) URL
// Everything else — javascript:, data:, file:, protocol-relative "//host" — is
// rejected. Mirrors isSafeImageUrl in authController, which guards avatars.
export const isSafeImageUrl = (u) => {
  if (typeof u !== 'string' || u.length > 1024) return false;
  // A single leading slash only: "//host" and "/\host" are protocol-relative
  // (they resolve to an EXTERNAL origin) and must not count as same-origin.
  if (/^\/(?:media|uploads)\/[^/\\]/.test(u)) return true;
  try {
    const proto = new URL(u).protocol;
    return proto === 'http:' || proto === 'https:';
  } catch {
    return false;
  }
};

// Express helper: validate an optional image field on a request body.
// Returns null when the value is absent/blank (meaning "don't change it") or
// valid; returns an error string when it must be rejected.
export const checkImageField = (value, label = 'Bild-URL') => {
  if (value === undefined || value === null || value === '') return null;
  return isSafeImageUrl(value) ? null : `Ungültige ${label}`;
};

// Shared URL validators for user-supplied links that get rendered back to
// OTHER users. Kept in one place because the same check was previously
// duplicated in authController (avatar/photos) and dealController (booking_url)
// while the group/club entity image fields had no validation at all — those
// values render in the feed, on the map, in Discover Events and inside push
// deep-links, i.e. to every viewer.

// Origins we are willing to store an image URL from. Built once at module load
// and EXPORTED so server.js can derive its CSP img-src from the same list —
// two separate answers to "where may an image come from?" would drift, and the
// CSP copy is the one that already existed.
//
// Why an allowlist at all (audit 2026-09-15, finding 17): this used to accept
// ANY parseable http(s) URL, and it is the only check applied to avatar_url,
// photos[], pinnwand[] and every group/club/event image_url. Sightengine
// moderation runs exclusively on the upload route and the entropy backstop
// only on same-origin uploads, so an external URL bypassed BOTH — and
// `creatorHasAvatar` is just "non-empty string", so such a URL also satisfied
// the server-enforced "you need a real profile photo" rule. One
// PUT /api/auth/profile could therefore put unmoderated content in front of
// every viewer, with the attacker's server logging each viewer's IP as a
// bonus. The CSP would have blocked the render on the web — but the iOS
// Capacitor build serves index.html from the local bundle and gets no CSP at
// all, and iOS is most of the install base.
export const allowedImageOrigins = () => {
  const origins = new Set();
  let sawAppOrigin = false;
  // Returns whether the value PARSED, not whether it was new. That distinction
  // is the whole point — see the marker below.
  const add = (raw) => {
    if (!raw) return false;
    const v = raw.trim();
    // STORAGE_PUBLIC_URL may be a bare path ("/media") in the proxy setup —
    // that is the same-origin branch below, not an origin.
    if (!v || v.startsWith('/')) return false;
    try {
      origins.add(new URL(v).origin);
      return true;
    } catch {
      return false;   // malformed env value — ignore rather than crash boot
    }
  };
  add(process.env.STORAGE_PUBLIC_URL);
  // Kept through a storage-domain migration: clients still hold OLD URLs in
  // cached API responses, and rows rewritten by migrations.js carry them too.
  add(process.env.OLD_STORAGE_PUBLIC_URL);
  // The app's own origin — production mints absolute
  // https://app.jamie-app.com/media/... URLs, and rejecting those is exactly
  // the regression that broke every profile save in the 42P08 incident.
  // Keyed on whether FRONTEND_URL PARSED, never on whether the Set grew.
  // Size-based was silently wrong in exactly the documented production shape:
  // STORAGE_PUBLIC_URL there is "https://app.jamie-app.com/media" — the app's
  // OWN origin — so it inserts that origin first and FRONTEND_URL then adds
  // nothing new. The marker stayed false, the server logged "FRONTEND_URL is
  // not set" while it very much was, and every image check took the weak
  // fallback branch. The entire finding-17 hardening would have been off in
  // production while looking configured.
  for (const o of (process.env.FRONTEND_URL || '').split(',')) {
    if (add(o)) sawAppOrigin = true;
  }
  // Google OAuth profile pictures, written server-side by googleLogin.
  origins.add('https://lh3.googleusercontent.com');
  // Marker read by `unconfigured()` below.
  origins._hasAppOrigin = sawAppOrigin;
  return origins;
};

// Resolved lazily and memoised: env vars are loaded before the first request
// but not necessarily before this module is first imported (tests import it
// directly), and a boot-time snapshot would freeze an empty set.
let _imageOrigins = null;
const imageOrigins = () => (_imageOrigins ??= allowedImageOrigins());

/** Test hook — re-read the env after changing it. */
export const _resetImageOrigins = () => { _imageOrigins = null; _warnedUnconfigured = false; };

// Keyed on FRONTEND_URL specifically, not on the total size of the list.
//
// Production mints absolute image URLs on the APP's own origin (the /media
// proxy is same-origin), so that origin is the one that must be present. If it
// is missing — a fresh env, a renamed service — tightening the allowlist would
// reject every production avatar URL and make profile saving impossible, which
// is the regression class of the 42P08 incident and not a trade worth making
// for a hardening change. So in that state only, fall back to accepting our own
// upload PATHS on any host (still narrower than the old "any http(s) URL") and
// say so loudly, once.
//
// Counting the whole set instead would have been worse than useless: with
// STORAGE_PUBLIC_URL set but FRONTEND_URL missing, the list looks "configured"
// and silently rejects the app's own URLs.
let _warnedUnconfigured = false;
const unconfigured = () => {
  const missing = !imageOrigins()._hasAppOrigin;
  if (missing && !_warnedUnconfigured) {
    _warnedUnconfigured = true;
    console.warn(
      '[safeUrl] FRONTEND_URL is not set — the image-origin allowlist cannot ' +
      'recognise this deployment\'s own URLs, so any host serving a /media or ' +
      '/uploads path is accepted. Set FRONTEND_URL to enable the allowlist.'
    );
  }
  return missing;
};

// An image URL we are willing to store and re-serve.
//   - same-origin "/media/…" or "/uploads/…" (what our own upload route mints;
//     production serves R2 through the same-origin /media proxy)
//   - an absolute http(s) URL on one of the allowed origins above
// Everything else — javascript:, data:, file:, protocol-relative "//host", and
// any third-party host — is rejected.
export const isSafeImageUrl = (u) => {
  if (typeof u !== 'string' || u.length > 1024) return false;
  // A single leading slash only: "//host" and "/\host" are protocol-relative
  // (they resolve to an EXTERNAL origin) and must not count as same-origin.
  if (/^\/(?:media|uploads)\/[^/\\]/.test(u)) return true;
  try {
    const url = new URL(u);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (imageOrigins().has(url.origin)) return true;
    // Unconfigured fallback — see `unconfigured()`. Still narrower than the
    // old "any http(s) URL": the path must be one of our own upload routes,
    // so https://attacker.tld/porn.jpg is rejected either way.
    return unconfigured() && /^\/(?:media|uploads)\/[^/\\]/.test(url.pathname);
  } catch {
    return false;
  }
};

// A voice-message URL we are willing to store and re-serve.
//
// Stricter than the image check on purpose: a voice message URL is never
// user-typed, it is ALWAYS minted by POST /api/upload/voice moments earlier. So
// there is no legitimate external case to accommodate, and the unconfigured
// fallback above does not apply — an absolute URL must be on an allowed origin,
// full stop. The extension must also be one the upload route actually produces,
// which keeps `content` from becoming a way to point an <audio> element at
// arbitrary bytes.
// Two shapes, both minted by POST /api/upload/voice and nothing else:
//   cloud: STORAGE_PUBLIC_URL (".../media") + the "uploads/<uuid>.ext" key
//          → /media/uploads/<uuid>.webm
//   local dev fallback (no STORAGE_* configured)
//          → /uploads/voice-<ts>-<rand>.webm
// Anchored at both ends and with no slash inside the filename, so no traversal
// and no extra path segments.
const AUDIO_PATH = /^\/(?:media\/uploads|uploads)\/[^/\\]+\.(?:webm|m4a|ogg)$/i;

// A CHAT PHOTO url we are willing to store and re-serve.
//
// Deliberately NOT isSafeImageUrl. That one gates stored avatar/banner fields,
// where the value can legitimately be a Google profile picture, so for an
// absolute URL it checks the ORIGIN ONLY and applies no path constraint at
// all. Reusing it for chat made the photo feature's central safety claim false:
// a chat photo is supposed to be a URL our own upload route minted, because
// that route is where Sightengine runs, so a photo is moderated BEFORE it can
// be sent. With the origin-only check, anyone could POST
// message_type='image' with any https://lh3.googleusercontent.com/... URL —
// their own Google profile picture, or any Google-hosted image — and it was
// stored and broadcast to the room without a single byte passing detectMime,
// processImage or checkImageSafety.
//
// So: same shape as isSafeVoiceUrl. Anchored path, no unconfigured() fallback
// (a chat photo is always minted by POST /api/upload seconds earlier — there
// is no legitimate external case), and lh3 rejected outright.
// Extensions: processImage emits .webp, or .gif passed through; the others are
// defensive breadth. The security property is the anchored path plus the
// origin allowlist, not the extension list.
const IMAGE_PATH = /^\/(?:media\/uploads|uploads)\/[^/\\]+\.(?:webp|gif|jpe?g|png)$/i;

export const isSafeChatImageUrl = (u) => {
  if (typeof u !== 'string' || u.length > 1024) return false;
  if (IMAGE_PATH.test(u)) return true;
  try {
    const url = new URL(u);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    // Google's avatar CDN is an allowed origin for AVATARS only. It serves
    // arbitrary user-controlled images, so it can never be a chat source.
    if (url.origin === 'https://lh3.googleusercontent.com') return false;
    return imageOrigins().has(url.origin) && IMAGE_PATH.test(url.pathname);
  } catch {
    return false;
  }
};

export const isSafeVoiceUrl = (u) => {
  if (typeof u !== 'string' || u.length > 1024) return false;
  if (AUDIO_PATH.test(u)) return true;
  try {
    const url = new URL(u);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return imageOrigins().has(url.origin) && AUDIO_PATH.test(url.pathname);
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

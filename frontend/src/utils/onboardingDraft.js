// ==========================================
// Onboarding draft — the wizard survives a WebView reload
// ==========================================
// Opening the camera or the photo library from the photo step can make iOS or
// Android kill the WebView under memory pressure. The app then cold-starts on
// /onboarding with every answer of the first three steps gone — exactly when
// the user is one tap from done. So the wizard mirrors its step and answers
// into localStorage and picks them up again for 24 hours.
//
// Plain data only: the answers plus the URLs of photos that were ALREADY
// uploaded (a File cannot be serialised; an upload in flight during the
// reload is lost either way). Keyed per user id, so a shared device never
// hands one account's half-finished profile to the next one — and wiped on
// logout / account deletion / expired session (clearAllOnboardingDrafts,
// called from AuthContext.clearAuth): birth date, gender and answers must not
// outlive the session on a shared device, nor the account on the server.
//
// Everything goes through safeStorage and is re-validated on the way in:
// storage-denied WebViews throw on any access, and a draft written by an
// older bundle (or edited by hand) must never crash or poison the wizard.
import { safeStorage } from './safeStorage';
import { MOTIVATION_KEYS } from './motivations';

export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Tolerated clock drift for a savedAt in the future (device clock moved).
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const DRAFT_VERSION = 1;

const DRAFT_PREFIX = 'jamie_onboarding_draft:';
export const draftKey = (userId) => `${DRAFT_PREFIX}${userId}`;

// Same caps as the server (authController: interests ≤ 30 × 50 chars,
// location ≤ 255, bio ≤ 500, photos ≤ 6, isSafeImageUrl ≤ 1024).
const LIMITS = { interests: 30, interestLen: 50, location: 255, bio: 500, photos: 6, url: 1024 };
const GENDERS = new Set(['male', 'female', 'diverse']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const uniqueStrings = (v, maxItems, maxLen) => (Array.isArray(v)
  ? [...new Set(v.filter((s) => typeof s === 'string' && s.trim() && s.length <= maxLen))].slice(0, maxItems)
  : []);

/** The stored formData, reduced to known fields with the right shapes. */
export function sanitizeDraftForm(raw) {
  const fd = raw && typeof raw === 'object' ? raw : {};
  const motivations = Array.isArray(fd.motivations)
    ? MOTIVATION_KEYS.filter((k) => fd.motivations.includes(k))
    : [];
  const photos = uniqueStrings(fd.photos, LIMITS.photos, LIMITS.url);
  return {
    motivations,
    interests: uniqueStrings(fd.interests, LIMITS.interests, LIMITS.interestLen),
    location: text(fd.location, LIMITS.location),
    bio: text(fd.bio, LIMITS.bio),
    gender: GENDERS.has(fd.gender) ? fd.gender : '',
    date_of_birth: typeof fd.date_of_birth === 'string' && ISO_DATE.test(fd.date_of_birth) ? fd.date_of_birth : '',
    photos,
    // Only ever a photo uploaded in that session — anything else would make
    // the final PUT send a URL this wizard never uploaded.
    avatar_url: typeof fd.avatar_url === 'string' && photos.includes(fd.avatar_url) ? fd.avatar_url : null,
  };
}

/**
 * The saved draft of `userId`, or null (none, expired, unreadable, or for a
 * step this wizard does not have). `stepIds` = the wizard's step ids.
 */
export function loadOnboardingDraft(userId, stepIds, now = Date.now()) {
  if (userId === undefined || userId === null || userId === '') return null;
  let parsed = null;
  try {
    parsed = JSON.parse(safeStorage.getItem(draftKey(userId)) || 'null');
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const age = now - Number(parsed.savedAt);
  const valid = parsed.v === DRAFT_VERSION
    && Number.isFinite(age) && age <= DRAFT_MAX_AGE_MS && age >= -FUTURE_SKEW_MS
    && Array.isArray(stepIds) && stepIds.includes(parsed.stepId);
  if (!valid) {
    clearOnboardingDraft(userId);
    return null;
  }
  return { stepId: parsed.stepId, formData: sanitizeDraftForm(parsed.formData) };
}

export function saveOnboardingDraft(userId, { stepId, formData }, now = Date.now()) {
  if (userId === undefined || userId === null || userId === '') return;
  try {
    safeStorage.setItem(draftKey(userId), JSON.stringify({
      v: DRAFT_VERSION,
      savedAt: now,
      stepId,
      formData: sanitizeDraftForm(formData),
    }));
  } catch { /* quota / serialisation — the wizard works without a draft */ }
}

export function clearOnboardingDraft(userId) {
  if (userId === undefined || userId === null || userId === '') return;
  safeStorage.removeItem(draftKey(userId));
}

/**
 * Every account's draft on this device. By prefix rather than by the current
 * user's id: the id in a logout closure can be stale (null right after
 * register), and drafts other accounts left behind go too. safeStorage cannot
 * list keys, so this walks localStorage itself — backwards, since removing
 * shifts the indexes — inside one try: storage-denied WebViews throw on any
 * access, and there is nothing to clear then anyway.
 */
export function clearAllOnboardingDrafts() {
  try {
    const ls = window.localStorage;
    for (let i = ls.length - 1; i >= 0; i -= 1) {
      const k = ls.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) ls.removeItem(k);
    }
  } catch { /* denied storage — nothing was written either */ }
}

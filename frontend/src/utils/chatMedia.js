/**
 * The playable/renderable URL of a voice or photo message.
 *
 * The server keeps the payload in `media_url` and a human-readable label in
 * `content` (see MEDIA_LABEL in backend/src/controllers/messageController.js),
 * so a client that does not understand `message_type` still shows
 * "🎤 Sprachnachricht" rather than a raw storage URL. That matters because the
 * iOS app bundles the web build inside its binary — iPhones keep running the
 * App Store build's renderer until a new binary ships.
 *
 * The `content` fallback is for rows written during the few hours the original
 * URL-in-content shape was live. The migration backfills those, but the
 * fallback means this component never depends on the migration having run.
 * It only applies when `content` actually looks like a media path: since the
 * split, `content` of a media row is the label, and handing "📷 Foto" to an
 * <img> as its src was a guaranteed broken request.
 */
const MEDIA_PATH = /^(?:https?:\/\/|\/(?:media|uploads)\/)/;

export const mediaUrl = (msg) => {
  if (msg?.media_url) return msg.media_url;
  const c = msg?.content;
  return typeof c === 'string' && MEDIA_PATH.test(c) ? c : '';
};

/**
 * How close to the bottom (px) a reader has to be for a photo that finishes
 * loading late to pull the chat down to the newest message again.
 */
export const NEAR_BOTTOM_PX = 400;

/**
 * A photo finishes loading AFTER the chat's auto-scroll has run and grows the
 * list under the reader — the newest photo ended up below the visible area,
 * so members opening the chat simply did not see it (tester 06.10.2026:
 * "einige konnten die Fotos nicht sehen"). Re-pin to the bottom, but only for
 * someone who is already there: photos are lazy-loaded, and a reader scrolling
 * back through history must not be yanked down whenever an older photo loads.
 */
export const repinIfNearBottom = (el) => {
  if (!el) return;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) {
    el.scrollTop = el.scrollHeight;
  }
};

export default mediaUrl;

import { useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { chatImageUrl } from '../utils/images';

/**
 * A photo inside a chat bubble.
 *
 * Renders the `?size=chat` variant the /media proxy generates: 900px longest
 * edge, aspect ratio intact. A chat full of photos must not pull full-size
 * originals — the single biggest bandwidth multiplier this app has (audit
 * 2026-08-10) — but it must also not CROP them, which is why this is not
 * `thumbUrl`: that variant is a 320x320 square cut for card tiles, and it
 * removed a quarter of a portrait photo and most of a 9:16 screenshot.
 * Tapping opens the full image in the existing lightbox.
 *
 * The aspect-ratio box reserves space only while the image is loading, so the
 * chat does not jump under the reader's thumb as photos arrive; once loaded,
 * the photo sizes to its own proportions and nothing is cut off.
 *
 * Load failures degrade in steps instead of giving up (tester 06.10.2026:
 * "einige konnten die Fotos nicht sehen"). One failed request used to flip the
 * bubble to a permanent "Foto nicht verfügbar" for that viewer, for the whole
 * chat session — whoever opened the chat during a proxy or R2 hiccup lost the
 * photo while everybody else saw it. Now: variant → original (the variant can
 * fail where the original is fine) → a tappable "reload" that starts over.
 */
const VARIANT = 0;
const ORIGINAL = 1;
const FAILED = 2;

export function ImageMessage({ url, onOpen, onLoad, mine = false }) {
  const { t } = useTranslation();
  const [stage, setStage] = useState(VARIANT);
  const [loaded, setLoaded] = useState(false);

  // A different photo in this slot starts over. Reset during render (React's
  // "adjust state on prop change" pattern), not in an effect: an effect runs
  // after paint, and a photo served from cache can fire `load` before it —
  // the reset would then knock a finished image back into the 4:3 loading box.
  const [seenUrl, setSeenUrl] = useState(url);
  if (seenUrl !== url) {
    setSeenUrl(url);
    setStage(VARIANT);
    setLoaded(false);
  }

  // No usable url at all (a malformed row) — nothing to load or retry.
  if (!url) {
    return <div className={`img-msg-failed${mine ? ' img-msg-failed--mine' : ''}`}>{t('chat.photo.unavailable')}</div>;
  }

  if (stage === FAILED) {
    return (
      <button
        type="button"
        className={`img-msg-failed img-msg-failed--retry${mine ? ' img-msg-failed--mine' : ''}`}
        onClick={(e) => { e.stopPropagation(); setLoaded(false); setStage(VARIANT); }}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <span>{t('chat.photo.unavailable')}</span>
        <span className="img-msg-failed__retry">{t('chat.photo.retry')}</span>
      </button>
    );
  }

  const variantSrc = chatImageUrl(url);
  // When there is no separate variant (local dev /uploads, external URL), the
  // "original" step would just repeat the same request.
  const src = stage === VARIANT ? variantSrc : url;
  const next = stage === VARIANT && variantSrc !== url ? ORIGINAL : FAILED;

  return (
    <button
      type="button"
      className={`img-msg${loaded ? ' img-msg--loaded' : ''}`}
      onClick={(e) => { e.stopPropagation(); onOpen?.(url); }}
      // The bubble carries a long-press handler for reply/report — a press that
      // starts on the photo must not open that sheet as well.
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      aria-label={t('chat.photo.open')}
    >
      <img
        // A new element per stage, so the retry is a fresh request rather than
        // React patching `src` on an element the browser already gave up on.
        key={stage}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        // Commit img-msg--loaded (the photo's own proportions) BEFORE telling
        // the chat: its re-pin measures the scroll height, and React 18
        // commits a plain load-event update only in a later task — the chat
        // measured the 240×180 loading box, and a portrait photo then grew
        // ~140px below the fold. A browser event is never inside render or
        // commit, so flushing synchronously here is safe.
        onLoad={() => { flushSync(() => setLoaded(true)); onLoad?.(); }}
        onError={() => setStage(next)}
      />
    </button>
  );
}

export default ImageMessage;

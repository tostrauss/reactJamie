import { useState } from 'react';
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
 */
export function ImageMessage({ url, onOpen, mine = false }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (failed) {
    return <div className={`img-msg-failed${mine ? ' img-msg-failed--mine' : ''}`}>{t('chat.photo.unavailable')}</div>;
  }

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
        src={chatImageUrl(url)}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </button>
  );
}

export default ImageMessage;

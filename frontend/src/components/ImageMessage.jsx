import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { thumbUrl } from '../utils/images';

/**
 * A photo inside a chat bubble.
 *
 * Renders the 320px thumbnail variant the /media proxy already generates —
 * a chat full of photos must not pull full-size originals, which is the single
 * biggest bandwidth multiplier this app has (audit 2026-08-10). Tapping opens
 * the full image in the existing lightbox.
 *
 * `aspect-ratio` on the wrapper reserves the space before the image loads, so
 * the chat does not jump under the reader's thumb as photos arrive.
 */
export function ImageMessage({ url, onOpen, mine = false }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <div className={`img-msg-failed${mine ? ' img-msg-failed--mine' : ''}`}>{t('chat.photo.unavailable')}</div>;
  }

  return (
    <button
      type="button"
      className="img-msg"
      onClick={(e) => { e.stopPropagation(); onOpen?.(url); }}
      // The bubble carries a long-press handler for reply/report — a press that
      // starts on the photo must not open that sheet as well.
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      aria-label={t('chat.photo.open')}
    >
      <img
        src={thumbUrl(url)}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </button>
  );
}

export default ImageMessage;

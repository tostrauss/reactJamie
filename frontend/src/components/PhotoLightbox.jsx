import React, { useEffect, useCallback } from 'react';

/**
 * Full-screen photo viewer. Tap a thumbnail anywhere → see the photo large.
 *
 * Props:
 *   photos    - string[] of image URLs
 *   index     - currently shown index (controlled)
 *   onIndex   - (newIndex) => void   — move to another photo
 *   onClose   - () => void           — dismiss
 *
 * Render nothing when index is null/undefined. Supports:
 *   • tap backdrop / ✕ to close
 *   • on-screen ‹ › arrows + ← → keys when there's more than one photo
 *   • Esc to close
 */
export function PhotoLightbox({ photos, index, onIndex, onClose }) {
  const open = index != null && Array.isArray(photos) && photos.length > 0;
  const count = photos?.length || 0;

  const go = useCallback((dir) => {
    if (!open) return;
    const next = (index + dir + count) % count;
    onIndex(next);
  }, [open, index, count, onIndex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    // Lock body scroll while open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, go, onClose]);

  if (!open) return null;

  return (
    <div className="lightbox-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <button className="lightbox-close" onClick={onClose} aria-label="Schließen">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>

      {count > 1 && (
        <button
          className="lightbox-nav lightbox-nav--prev"
          onClick={(e) => { e.stopPropagation(); go(-1); }}
          aria-label="Vorheriges Foto"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
      )}

      {/* Stop propagation on the image so tapping it doesn't close */}
      <img
        className="lightbox-img"
        src={photos[index]}
        alt=""
        onClick={(e) => e.stopPropagation()}
      />

      {count > 1 && (
        <button
          className="lightbox-nav lightbox-nav--next"
          onClick={(e) => { e.stopPropagation(); go(1); }}
          aria-label="Nächstes Foto"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      )}

      {count > 1 && (
        <div className="lightbox-counter">{index + 1} / {count}</div>
      )}
    </div>
  );
}

export default PhotoLightbox;

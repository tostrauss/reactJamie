import { useRef, useState } from 'react';

/**
 * Tinder-style swipeable photo gallery for profile headers.
 *
 *   • native horizontal scroll-snap → smooth touch swiping in the Capacitor WebView
 *   • segmented indicator bars at the top (one per photo, like Tinder/Instagram)
 *   • tapping a photo (without swiping) calls onPhotoTap(index) — the host page
 *     uses this to open the fullscreen PhotoLightbox at the matching index
 *
 * `photos` must be a non-empty string[] of image URLs. The host renders its own
 * placeholder when the user has no photos yet.
 *
 * Designed to be dropped in as an absolute-fill background inside an existing
 * position:relative header — the page keeps its own gradient/buttons on top.
 */
export function ProfilePhotoCarousel({ photos, onPhotoTap, imgClassName = '' }) {
  const trackRef = useRef(null);
  const [active, setActive] = useState(0);

  // Distinguish a tap from a swipe so a swipe never opens the lightbox.
  const startX = useRef(0);
  const moved = useRef(false);

  const handleScroll = () => {
    const el = trackRef.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== active) setActive(i);
  };

  const multiple = photos.length > 1;

  return (
    <div className="ppc">
      <div
        className="ppc-track"
        ref={trackRef}
        onScroll={multiple ? handleScroll : undefined}
        style={multiple ? undefined : { overflowX: 'hidden' }}
      >
        {photos.map((url, i) => (
          <div className="ppc-slide" key={`${i}-${url}`}>
            <img
              src={url}
              alt=""
              className={`ppc-img ${imgClassName}`}
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
              draggable={false}
              onPointerDown={(e) => { startX.current = e.clientX; moved.current = false; }}
              onPointerMove={(e) => { if (Math.abs(e.clientX - startX.current) > 8) moved.current = true; }}
              onClick={() => { if (!moved.current) onPhotoTap?.(i); }}
            />
          </div>
        ))}
      </div>

      {multiple && (
        <div className="ppc-bars" aria-hidden="true">
          {photos.map((_, i) => (
            <span key={i} className={`ppc-bar ${i === active ? 'is-active' : ''}`} />
          ))}
        </div>
      )}
    </div>
  );
}

export default ProfilePhotoCarousel;

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// ── Crop-before-upload modal ────────────────────────────────────────────────
// Give it a File and a target `aspect` (width / height). The user pans + zooms
// the image inside a fixed-aspect frame ("Vorlage") and we return a cropped
// JPEG File via onConfirm — so photos sit perfectly in the profile carousel /
// cover banners instead of being blindly centre-cropped by object-fit.
//
// Self-contained: no cropping library, just pointer events + a canvas export.
export function ImageCropModal({ file, aspect = 1, title, onConfirm, onCancel }) {
  const { t } = useTranslation();
  const [imgEl, setImgEl]   = useState(null);          // loaded HTMLImageElement
  const [frame, setFrame]   = useState({ w: 0, h: 0 }); // crop viewport size (px)
  const [zoom, setZoom]     = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // image top-left vs frame top-left
  const [busy, setBusy]     = useState(false);

  const pointers = useRef(new Map()); // active pointers for drag / pinch
  const pinchRef = useRef(null);      // last two-finger distance

  // Load the picked file into an Image element (object URL revoked on cleanup).
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setImgEl(img);
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Size the frame to the largest box that fits the screen at the target aspect,
  // leaving room for the controls. Recomputed on rotate / resize.
  useEffect(() => {
    const calc = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const maxW = Math.min(vw * 0.92, 520);
      const maxH = vh * 0.58;
      let w = maxW, h = w / aspect;
      if (h > maxH) { h = maxH; w = h * aspect; }
      setFrame({ w: Math.round(w), h: Math.round(h) });
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, [aspect]);

  // Baseline "cover" scale — the image fills the frame at zoom = 1.
  const base = (imgEl && frame.w)
    ? Math.max(frame.w / imgEl.naturalWidth, frame.h / imgEl.naturalHeight)
    : 1;

  // Keep the image covering the frame (no empty gutters) after any pan / zoom.
  const clampOff = useCallback((o, z) => {
    if (!imgEl || !frame.w) return o;
    const dispW = imgEl.naturalWidth * base * z;
    const dispH = imgEl.naturalHeight * base * z;
    const minX = frame.w - dispW, minY = frame.h - dispH;
    return {
      x: Math.min(0, Math.max(minX, o.x)),
      y: Math.min(0, Math.max(minY, o.y)),
    };
  }, [imgEl, frame.w, frame.h, base]);

  // Centre the image whenever a new one loads or the frame is (re)sized.
  useEffect(() => {
    if (!imgEl || !frame.w) return;
    const dispW = imgEl.naturalWidth * base;
    const dispH = imgEl.naturalHeight * base;
    setZoom(1);
    setOffset({ x: (frame.w - dispW) / 2, y: (frame.h - dispH) / 2 });
  }, [imgEl, frame.w, frame.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pointer gestures: 1 finger pans, 2 fingers pinch-zoom ──
  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 1) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      setOffset(o => clampOff({ x: o.x + dx, y: o.y + dy }, zoom));
    } else if (pts.length >= 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchRef.current) {
        const nz = Math.min(5, Math.max(1, zoom * (dist / pinchRef.current)));
        setZoom(nz);
        setOffset(o => clampOff(o, nz));
      }
      pinchRef.current = dist;
    }
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
  };

  const onSlider = (e) => {
    const nz = parseFloat(e.target.value);
    setZoom(nz);
    setOffset(o => clampOff(o, nz));
  };

  // Render the cropped region to a canvas and hand back a JPEG File.
  const handleConfirm = async () => {
    if (!imgEl || busy) return;
    setBusy(true);
    try {
      const scale = base * zoom;
      const sx = (0 - offset.x) / scale;
      const sy = (0 - offset.y) / scale;
      const sW = frame.w / scale;
      const sH = frame.h / scale;
      // Cap the long edge so we don't ship multi-MB canvases.
      const MAX = 1440;
      let outW = sW, outH = sH;
      const longest = Math.max(outW, outH);
      if (longest > MAX) { const r = MAX / longest; outW *= r; outH *= r; }

      const canvas = document.createElement('canvas');
      canvas.width  = Math.max(1, Math.round(outW));
      canvas.height = Math.max(1, Math.round(outH));
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(imgEl, sx, sy, sW, sH, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
      const baseName = (file?.name || 'image').replace(/\.[^.]+$/, '');
      const cropped = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
      onConfirm(cropped);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 'max(env(safe-area-inset-top,0px),16px) 16px max(env(safe-area-inset-bottom,0px),16px)',
        backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <h3 style={{ color: '#fff', fontSize: 17, fontWeight: 800, margin: '0 0 4px', textAlign: 'center' }}>
        {title || t('imageCrop.title')}
      </h3>
      <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, margin: '0 0 16px', textAlign: 'center' }}>
        {t('imageCrop.hint')}
      </p>

      {/* Crop viewport ("Vorlage") */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'relative',
          width: frame.w, height: frame.h,
          borderRadius: 14, overflow: 'hidden',
          background: '#000',
          touchAction: 'none', cursor: 'grab',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.18), 0 24px 60px rgba(0,0,0,0.5)',
        }}
      >
        {imgEl && (
          <img
            src={imgEl.src}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              left: offset.x, top: offset.y,
              width: imgEl.naturalWidth * base * zoom,
              height: imgEl.naturalHeight * base * zoom,
              maxWidth: 'none',
              pointerEvents: 'none', userSelect: 'none', WebkitUserDrag: 'none',
            }}
          />
        )}
        {/* Rule-of-thirds guides */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: '33.33%', width: 1, background: 'rgba(255,255,255,0.18)' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: '66.66%', width: 1, background: 'rgba(255,255,255,0.18)' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, top: '33.33%', height: 1, background: 'rgba(255,255,255,0.18)' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, top: '66.66%', height: 1, background: 'rgba(255,255,255,0.18)' }} />
        </div>
      </div>

      {/* Zoom slider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: frame.w, maxWidth: 520, margin: '20px 0 4px' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M20 20l-3.5-3.5"/>
        </svg>
        <input
          type="range" min="1" max="4" step="0.01" value={zoom}
          onChange={onSlider}
          aria-label={t('imageCrop.zoom')}
          style={{ flex: 1, accentColor: '#FD7666' }}
        />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, width: frame.w, maxWidth: 520, marginTop: 16 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{
            flex: 1, padding: '13px 0', borderRadius: 100, border: 'none',
            background: 'rgba(255,255,255,0.1)', color: '#fff',
            fontSize: 15, fontWeight: 700, cursor: 'pointer',
          }}
        >
          {t('imageCrop.cancel')}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy || !imgEl}
          style={{
            flex: 1, padding: '13px 0', borderRadius: 100, border: 'none',
            background: '#FD7666', color: '#fff',
            fontSize: 15, fontWeight: 800, cursor: 'pointer',
            opacity: (busy || !imgEl) ? 0.6 : 1,
          }}
        >
          {busy ? t('imageCrop.processing') : t('imageCrop.confirm')}
        </button>
      </div>
    </div>
  );
}

export default ImageCropModal;

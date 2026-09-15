/**
 * 320px card/list variant of an uploaded image (audit 2026-08-10).
 *
 * The /media proxy serves `?size=thumb` as a server-side 320px WebP
 * (generated once, then cached in R2 + browser). Lists were pulling the full
 * 1600px original (~100-300 KB) where ~15 KB does — the single biggest
 * bandwidth multiplier on cold-cache visitors.
 *
 * Use in CARD/LIST/AVATAR-ROW contexts only; detail views, profile pages and
 * the lightbox keep the original URL. Non-/media URLs (local dev /uploads,
 * external images, null) pass through untouched.
 */
export const thumbUrl = (url) =>
  typeof url === 'string' && url.includes('/media/uploads/') && !url.includes('?')
    ? `${url}?size=thumb`
    : url;

/**
 * Downscale an image File in the browser before uploading it.
 *
 * Camera-roll photos off a modern phone are 5-10 MB; the server downsizes them
 * to ~80-200 KB with sharp and throws the rest away. Sending the original
 * anyway costs the user their mobile uplink AND is what makes the server-side
 * upload path expensive: multer buffers the WHOLE body into memory before the
 * request can even wait for a processing slot, so a signup wave of 300 avatars
 * was ~2 GB of resident Buffers (audit 2026-09-15, finding 8). This is the
 * cheapest 10-20x reduction available and it needs no backend change.
 *
 * 1600px / JPEG q0.85 is comfortably above what the server keeps, so nothing
 * visible is lost. ImageCropModal already does its own (1440px, q0.9) — this
 * is for the paths that have no crop step.
 *
 * Fails OPEN: anything unexpected (GIF, huge dimensions, a browser without
 * canvas.toBlob, an image that will not decode) returns the ORIGINAL file, so
 * an upload never breaks because the optimisation could not run.
 */
const MAX_UPLOAD_DIMENSION = 1600;
const UPLOAD_JPEG_QUALITY = 0.85;

export async function downscaleImageFile(file, {
  maxDimension = MAX_UPLOAD_DIMENSION,
  quality = UPLOAD_JPEG_QUALITY,
} = {}) {
  // Animated GIFs would lose their animation — a canvas round trip keeps only
  // the first frame. Pass them through untouched.
  if (!file || !file.type?.startsWith('image/') || file.type === 'image/gif') return file;

  let url;
  try {
    url = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });

    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    if (!longest) return file;
    // Already small enough AND already reasonably sized on disk: leave it be,
    // since re-encoding a small PNG as JPEG can make it bigger.
    if (longest <= maxDimension && file.size <= 1_000_000) return file;

    const scale = Math.min(1, maxDimension / longest);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;   // never upload MORE bytes

    const baseName = (file.name || 'upload').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

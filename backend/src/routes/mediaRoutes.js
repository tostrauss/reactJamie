import express from 'express';
import { getObjectFromCloud, isCloudStorageEnabled } from '../config/storage.js';

// ─────────────────────────────────────────────────────────────────────────────
// /media — same-origin image proxy in front of the R2 bucket.
//
// WHY THIS EXISTS (2026-07-29): uploads were served straight from the
// pub-*.r2.dev public dev URL. That domain family is (a) rate-limited and
// documented by Cloudflare as not for production, and (b) on common
// content-blocker filter lists — the Android app is a TWA that runs in the
// device's default browser, on Samsung Galaxys that's Samsung Internet with
// its blocker ecosystem, so Samsung users saw NO images at all (real-user
// report, S24). An R2 custom domain needs the DNS zone in the same Cloudflare
// account; jamie-app.com lives at IONOS (mail + Resend DKIM attached), so a
// nameserver move the night before a store release was ruled out. Serving
// images from the app's own origin sidesteps every blocklist for good.
//
// Set STORAGE_PUBLIC_URL=https://app.jamie-app.com/media so uploadToCloud
// mints URLs pointing here; the startup rewrite migration (server.js) moves
// the stored URLs over.
//
// Load profile: objects are UUID-named and never overwritten, so responses are
// immutable — the browser caches each image for a year and re-requests are
// rare. The instance streams each object through without buffering it fully.
// If image traffic ever becomes a real cost, the escape hatch is the proper
// R2 custom domain after the planned IONOS→Cloudflare DNS move.
// ─────────────────────────────────────────────────────────────────────────────

const router = express.Router();

// UUID-ish basename + known image extension. Rejects path traversal, nested
// paths, dotfiles, query tricks — the only thing this route will ever fetch
// is a flat key directly under uploads/.
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(webp|jpe?g|png|gif)$/i;

router.get('/uploads/:file', async (req, res) => {
  const { file } = req.params;
  if (!SAFE_FILE.test(file) || file.includes('..')) {
    return res.status(400).end();
  }
  if (!isCloudStorageEnabled()) {
    // Dev without STORAGE_* runs on local /uploads static serving instead.
    return res.status(404).end();
  }

  try {
    const obj = await getObjectFromCloud(`uploads/${file}`);
    res.setHeader('Content-Type', obj.ContentType || 'application/octet-stream');
    if (obj.ContentLength != null) res.setHeader('Content-Length', obj.ContentLength);
    if (obj.ETag) res.setHeader('ETag', obj.ETag);
    // Objects are content-addressed by UUID and never overwritten → immutable.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    obj.Body.on('error', (err) => {
      console.error('[media] stream error:', err.message);
      res.destroy();
    });
    // If the client disconnects mid-stream, stop pulling from R2.
    res.on('close', () => obj.Body.destroy?.());
    obj.Body.pipe(res);
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (err?.name === 'NoSuchKey' || status === 404) return res.status(404).end();
    console.error('[media] proxy error:', err?.name || '', err?.message);
    res.status(502).end();
  }
});

export default router;

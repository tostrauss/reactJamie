import express from 'express';
import { getObjectFromCloud, putObjectToCloud, isCloudStorageEnabled } from '../config/storage.js';
import { generateThumbnail } from '../config/imageProcessor.js';
import { createSemaphore, QUEUE_FULL } from '../utils/semaphore.js';

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
// ?size=thumb (audit 2026-08-10): list/card views were pulling the full
// 1600px/100-300KB WebP where ~15KB does — the single biggest egress
// multiplier on a cold-cache signup wave. A thumb request serves the derived
// key uploads/thumbs/<file>; on a miss the variant is generated ONCE from the
// original (sharp, on the threadpool), served, and written back to R2 so
// every image — including all pre-existing ones — self-migrates on first
// request. GIFs and oversized originals fall back to the full object.
//
// Load profile: objects are UUID-named and never overwritten, so responses are
// immutable — the browser caches each image for a year and re-requests are
// rare. The instance streams each object through without buffering it fully
// (thumbnail generation buffers the one original, bounded below).
// If image traffic ever becomes a real cost, the escape hatch is the proper
// R2 custom domain after the planned IONOS→Cloudflare DNS move.
// ─────────────────────────────────────────────────────────────────────────────

const router = express.Router();

// UUID-ish basename + known image extension. Rejects path traversal, nested
// paths, dotfiles, query tricks — the only thing this route will ever fetch
// is a flat key directly under uploads/.
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(webp|jpe?g|png|gif)$/i;

// Don't buffer originals beyond this for thumbnailing (animated GIFs pass
// through anyway; processed uploads are ≤ ~400 KB).
const THUMB_SOURCE_MAX_BYTES = 5 * 1024 * 1024;

// One concurrent generation per file: N simultaneous cold requests for the
// same image (a fresh feed full of viewers) share a single resize.
const thumbInFlight = new Map(); // file → Promise<{buffer, mimetype} | null>

// Cross-file cap: without it, a cold-cache feed wave of N DISTINCT images runs
// N concurrent sharp pipelines (each buffering up to 5 MB) on the same libuv
// threadpool bcrypt logins hash on. Mirrors MAX_CONCURRENT_UPLOADS on the
// upload path; joiners of an in-flight generation don't consume a slot.
// The slot deliberately spans the R2 fetch + buffering too — it bounds
// transient RSS (4 × 5 MB max), not just CPU. maxQueue: past 30 waiting
// generations the request falls back to serving the FULL object (existing
// null path) instead of hanging unboundedly behind a degraded R2.
const thumbSlots = createSemaphore(4, { maxQueue: 30 });

const streamObject = (res, obj) => {
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
};

const isMissing = (err) =>
  err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404;

const bufferBody = async (body) => {
  const chunks = [];
  for await (const c of body) chunks.push(c);
  return Buffer.concat(chunks);
};

// Generate (or join the in-flight generation of) the thumb for `file`.
// Resolves null when the original shouldn't be thumbed (GIF, too big) —
// the caller then serves the full object. Writes the variant back to R2
// fire-and-forget so the next request hits the derived key directly.
const getOrCreateThumb = (file, thumbKey) => {
  let p = thumbInFlight.get(file);
  if (p) return p;
  p = thumbSlots.run(async () => {
    return generateOne(file, thumbKey);
  }).catch((err) => {
    // Queue saturated → null → the route serves the full object this once;
    // the thumb self-heals on a later, calmer request. Real generation
    // errors keep propagating to the route's 404/502 handling.
    if (err?.code === QUEUE_FULL) return null;
    throw err;
  });
  thumbInFlight.set(file, p);
  p.finally(() => thumbInFlight.delete(file));
  return p;
};

const generateOne = async (file, thumbKey) => {
  const orig = await getObjectFromCloud(`uploads/${file}`);
  if (
    (orig.ContentLength ?? 0) > THUMB_SOURCE_MAX_BYTES ||
    orig.ContentType === 'image/gif'
  ) {
    orig.Body.destroy?.();
    return null;
  }
  const buf = await bufferBody(orig.Body);
  const thumb = await generateThumbnail(buf, orig.ContentType || 'image/webp');
  if (!thumb) return null;
  putObjectToCloud(thumbKey, thumb.buffer, thumb.mimetype).catch((err) => {
    console.error('[media] thumb write-back failed:', err?.message);
  });
  return { buffer: thumb.buffer, mimetype: thumb.mimetype };
};

router.get('/uploads/:file', async (req, res) => {
  const { file } = req.params;
  if (!SAFE_FILE.test(file) || file.includes('..')) {
    return res.status(400).end();
  }
  if (!isCloudStorageEnabled()) {
    // Dev without STORAGE_* runs on local /uploads static serving instead.
    return res.status(404).end();
  }

  const wantThumb = req.query.size === 'thumb';

  try {
    if (wantThumb) {
      try {
        return streamObject(res, await getObjectFromCloud(`uploads/thumbs/${file}`));
      } catch (err) {
        if (!isMissing(err)) throw err; // original missing too → 404 below
        const thumb = await getOrCreateThumb(file, `uploads/thumbs/${file}`);
        if (thumb) {
          res.setHeader('Content-Type', thumb.mimetype);
          res.setHeader('Content-Length', thumb.buffer.length);
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return res.end(thumb.buffer);
        }
        // Not thumbable (GIF/oversized) → fall through to the full object.
      }
    }

    streamObject(res, await getObjectFromCloud(`uploads/${file}`));
  } catch (err) {
    if (isMissing(err)) return res.status(404).end();
    console.error('[media] proxy error:', err?.name || '', err?.message);
    res.status(502).end();
  }
});

export default router;

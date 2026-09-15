import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeFile, mkdir } from 'fs/promises';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { uploadLimiter, voiceUploadLimiter } from '../middleware/rateLimiter.js';
import { uploadToCloud, putObjectToCloud, isCloudStorageEnabled } from '../config/storage.js';
import { checkImageSafety } from '../config/moderation.js';
import { processImage, generateThumbnail, checkImageQuality } from '../config/imageProcessor.js';
import { createSemaphore, QUEUE_FULL } from '../utils/semaphore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Validate actual file bytes — never trust the Content-Type header alone
const MAGIC = {
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/png':  [[0x89, 0x50, 0x4E, 0x47]],
  'image/gif':  [[0x47, 0x49, 0x46, 0x38]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF header — followed by 'WEBP' at offset 8
};
const MIME_TO_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };

function detectMime(buffer) {
  for (const [mime, signatures] of Object.entries(MAGIC)) {
    for (const sig of signatures) {
      if (sig.every((byte, i) => buffer[i] === byte)) return mime;
    }
  }
  return null;
}

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

// Memory storage — we handle the final destination (cloud or disk) ourselves.
// Limit raised from 5 MB → 15 MB because iPhone photos are routinely 5–10 MB
// straight off the camera roll. Sharp downsizes to ~80–200 KB before we store.
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Global concurrency cap for the expensive section (moderation Blob copy +
// two sharp passes + cloud upload ≈ 2-3× file size of transient RSS each).
// The per-USER uploadLimiter doesn't help when a signup wave has hundreds of
// DIFFERENT users adding avatars at once — 50 concurrent 15 MB uploads was a
// multi-GB spike on a container that must also keep sockets alive. Excess
// requests queue (FIFO) instead of OOM-ing the instance.
const MAX_CONCURRENT_UPLOADS = 4;
// maxQueue so this can never park more waiters than the admission gate below
// admits. Without it the queue was Infinity — see semaphore.js.
const uploadSlots = createSemaphore(MAX_CONCURRENT_UPLOADS, { maxQueue: 60 });

// ── Admission gate: BYTES in flight, not CPU (finding 8) ──────────────────
// The slot semaphore above is acquired inside the final handler, i.e. AFTER
// multer has already buffered the entire body into memory. So it bounded the
// sharp/moderation working set but not the base buffers at all — 300 people
// uploading camera-roll photos in one signup-wave minute meant ~2 GB of
// Buffers resident with four of them actually being processed, and the rest
// parked in an unbounded FIFO still holding their buffers. That is the exact
// failure the comment above says this design prevents.
//
// This gate sits BEFORE multer, so a rejected request never allocates.
// Deliberately NOT the same semaphore moved earlier: with only 4 slots, a
// slot would then be held across the whole network transfer, and a 5 MB body
// on a mobile uplink occupies it for tens of seconds — during the very wave
// this protects, nearly every user would time out. 24 concurrent transfers
// × 10 MB ≈ 240 MB worst case is survivable; past the queue cap, say so.
const MAX_UPLOADS_IN_FLIGHT = 24;
const admission = createSemaphore(MAX_UPLOADS_IN_FLIGHT, { maxQueue: 50 });

const admitUpload = async (req, res, next) => {
  // Registered BEFORE awaiting a slot, deliberately. A client that gives up
  // while its request is parked in the queue fires res 'close' before
  // acquire() ever resolves — a handler attached afterwards would simply never
  // run, and the slot it then took would be held for the lifetime of the
  // process. Enough of those and every upload 503s with nothing running.
  //
  // `writableFinished` is what separates "the response was sent" from "the
  // socket went away": it is true inside the 'finish' handler and false on an
  // abort, which is also how the request handler learns the client is gone
  // (req._clientGone). `req.destroyed` cannot be used for that — on an
  // IncomingMessage it means "body fully read" and is already true by then.
  let slotHeld = false;
  let released = false;
  let clientGone = false;
  const done = () => {
    if (!res.writableFinished) {
      clientGone = true;
      req._clientGone = true;
    }
    if (slotHeld && !released) {
      released = true;
      admission.release();
    }
  };
  res.on('finish', done);
  res.on('close', done);

  try {
    await admission.acquire();
  } catch (err) {
    if (err.code === QUEUE_FULL) {
      // 503 + Retry-After so the client backs off instead of hammering.
      res.set('Retry-After', '5');
      return res.status(503).json({
        error: 'Zu viele Uploads gerade. Bitte kurz warten und erneut versuchen.',
        code: 'UPLOAD_BUSY',
      });
    }
    return next(err);
  }
  slotHeld = true;

  // The client went away while we were queued. Hand the slot straight back to
  // the next waiter instead of spending it parsing a body nobody will read.
  if (clientGone) {
    released = true;
    admission.release();
    return;
  }
  next();
};

// Surface multer errors (file-too-large, wrong mimetype) as JSON so the
// frontend can show a useful message instead of a generic "upload failed".
const handleUpload = upload.single('image');
router.post('/', authenticate, uploadLimiter, admitUpload, (req, res, next) => {
  handleUpload(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Bild ist zu groß (max. 15 MB).' });
      }
      if (err.message === 'Only image files are allowed') {
        return res.status(400).json({ error: 'Nur Bilder werden unterstützt (JPG, PNG, GIF, WebP).' });
      }
      console.error('Multer error:', err);
      return res.status(400).json({ error: 'Upload fehlgeschlagen: ' + err.message });
    }
    next();
  });
}, async (req, res) => {
  let slotHeld = false;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Kein Bild ausgewählt.' });
    }
    try {
      await uploadSlots.acquire();
    } catch (err) {
      if (err.code === QUEUE_FULL) {
        res.set('Retry-After', '5');
        return res.status(503).json({
          error: 'Zu viele Uploads gerade. Bitte kurz warten und erneut versuchen.',
          code: 'UPLOAD_BUSY',
        });
      }
      throw err;
    }
    slotHeld = true;

    // The client may have given up while this request sat in the queue. Doing
    // sharp + moderation + a cloud PUT for a response nobody will read spends
    // a slot that a waiting user needs — and an aborted-and-retried upload
    // would otherwise cost two.
    //
    // NOT `req.destroyed`: on an http.IncomingMessage that is a "body fully
    // read" signal, never a "client gave up" one. The stream is a Readable
    // with autoDestroy, so it self-destructs the moment multer finishes
    // consuming the multipart body — meaning `req.destroyed` is ALREADY true
    // here on every healthy upload. Guarding on it returned from the handler
    // without sending any response at all, so every single upload hung until
    // the client's 10 s timeout. Verified against this repo's own express +
    // multer: healthy request → req.destroyed=true, res.destroyed=false.
    // `req._clientGone` is set by admitUpload's own close handler, which can
    // tell an abort from a completed response via res.writableFinished.
    if (req._clientGone || res.writableEnded) return;

    // Validate actual file bytes — reject if magic bytes don't match a known image format
    const detectedMime = detectMime(req.file.buffer);
    if (!detectedMime) {
      return res.status(400).json({ error: 'Ungültiger Dateityp. Nur Bilder erlaubt.' });
    }
    // Use the detected (safe) extension, never the user-supplied filename
    const safeExt = MIME_TO_EXT[detectedMime];
    const safeOriginalname = `upload${safeExt}`;

    // Avatar quality gate — only when the client marks this as a profile photo
    // (purpose:'avatar'). Rejects a solid-colour / near-blank block that would
    // otherwise satisfy the "has avatar" join requirement (Tina 2026-08-27).
    // Scoped so group/club/event banners — which may be flat by design — are
    // untouched. Runs before the external moderation call, so junk avatars are
    // rejected without spending a Sightengine request.
    if (req.body?.purpose === 'avatar') {
      const quality = await checkImageQuality(req.file.buffer, detectedMime);
      if (!quality.ok) {
        return res.status(422).json({ error: quality.reason });
      }
    }

    // Moderation check — runs on the original buffer before processing
    const { safe, reason } = await checkImageSafety(
      req.file.buffer,
      detectedMime,
      safeOriginalname
    );
    if (!safe) {
      return res.status(422).json({ error: reason });
    }

    // Resize + re-encode to WebP. Phone uploads are typically 3-10 MB; this
    // brings them down to ~80-200 KB with no visible quality loss.
    const processed = await processImage(req.file.buffer, detectedMime);
    const processedName = `upload${processed.extension}`;

    // Optional thumbnail for cards/lists. Failure here is non-fatal.
    let thumbUrl = null;
    const thumbnail = await generateThumbnail(req.file.buffer, detectedMime).catch(() => null);

    let imageUrl;

    if (isCloudStorageEnabled()) {
      imageUrl = await uploadToCloud(processed.buffer, processed.mimetype, processedName);
      if (thumbnail) {
        // Store the variant under uploads/thumbs/<same basename> — the derived
        // key the /media proxy serves for ?size=thumb, so the thumb is
        // addressable from the main URL alone (no second UUID to persist).
        const basename = imageUrl.split('/').pop();
        thumbUrl = await putObjectToCloud(`uploads/thumbs/${basename}`, thumbnail.buffer, thumbnail.mimetype)
          .then(() => `${imageUrl}?size=thumb`)
          .catch(() => null);
      }
    } else {
      // Development fallback: write to local /uploads directory
      const uploadsDir = path.join(__dirname, '../../uploads');
      await mkdir(uploadsDir, { recursive: true });
      const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
      const filename = `image-${uniqueSuffix}${processed.extension}`;
      await writeFile(path.join(uploadsDir, filename), processed.buffer);
      imageUrl = `/uploads/${filename}`;
      if (thumbnail) {
        const thumbFilename = `thumb-${uniqueSuffix}${thumbnail.extension}`;
        await writeFile(path.join(uploadsDir, thumbFilename), thumbnail.buffer);
        thumbUrl = `/uploads/${thumbFilename}`;
      }
    }

    res.json({ url: imageUrl, thumbnail: thumbUrl });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  } finally {
    if (slotHeld) uploadSlots.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/upload/voice — voice messages (2026-09-15)
//
// A SEPARATE route rather than a `purpose` on the image one, because almost
// nothing about that pipeline applies: no sharp, no WebP re-encode, no
// thumbnail, and no Sightengine call (it scores images; handing it an audio
// buffer would burn a request to learn nothing).
//
// Moderation posture, stated plainly: recorded speech cannot be scanned the way
// text and images are. Voice messages are moderated REACTIVELY — they are
// reportable like any other message (the long-press report shipped the same
// day), the admin queue plays them back, and an admin can soft-delete. That is
// the same posture every consumer chat app takes, and it only became a real
// posture today, because before this there was no way to report a message and
// no way for an admin to remove one.
//
// Format: the browser picks what it can record. Chrome/Android produce
// audio/webm;codecs=opus, iOS WKWebView and Safari produce audio/mp4 (AAC).
// Both are accepted and stored as-is; the /media proxy serves them back with
// their own content type. We deliberately do NOT transcode — ffmpeg on the API
// container during a signup wave is exactly the kind of CPU the upload
// semaphore exists to avoid.
const VOICE_MAGIC = {
  // WebM/Matroska EBML header.
  'audio/webm': [[0x1A, 0x45, 0xDF, 0xA3]],
  // ISO-BMFF: 'ftyp' at byte offset 4. Checked separately below.
  'audio/mp4': [],
  // Ogg Opus, in case a browser prefers it.
  'audio/ogg': [[0x4F, 0x67, 0x67, 0x53]],
};
const VOICE_EXT = { 'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/ogg': '.ogg' };

function detectVoiceMime(buffer) {
  if (!buffer || buffer.length < 12) return null;
  for (const [mime, sigs] of Object.entries(VOICE_MAGIC)) {
    for (const sig of sigs) {
      if (sig.every((byte, i) => buffer[i] === byte)) return mime;
    }
  }
  // ISO base media file format: bytes 4-7 are 'ftyp'. Covers m4a/mp4/3gp,
  // which is what iOS hands us.
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    return 'audio/mp4';
  }
  return null;
}

// 2 minutes of Opus voice is well under 1 MB; 8 MB is generous headroom for a
// browser that records at a high bitrate, while still bounding what a client
// can push. MAX_VOICE_MS is enforced on the client (the recorder auto-stops)
// AND here, because the duration is client-reported.
const MAX_VOICE_BYTES = 8 * 1024 * 1024;
export const MAX_VOICE_MS = 120_000;

const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VOICE_BYTES },
  fileFilter: (req, file, cb) => {
    // The header is a hint only — detectVoiceMime re-checks the bytes below.
    if (/^audio\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only audio files are allowed'), false);
  },
}).single('audio');

router.post('/voice', authenticate, voiceUploadLimiter, admitUpload, (req, res, next) => {
  voiceUpload(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Sprachnachricht ist zu lang.', code: 'VOICE_TOO_LARGE' });
      }
      if (err.message === 'Only audio files are allowed') {
        return res.status(400).json({ error: 'Nur Audio-Dateien werden unterstützt.' });
      }
      console.error('Voice multer error:', err);
      return res.status(400).json({ error: 'Upload fehlgeschlagen.' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Keine Aufnahme empfangen.' });

    const mime = detectVoiceMime(req.file.buffer);
    if (!mime) {
      return res.status(400).json({ error: 'Ungültiges Audioformat.' });
    }
    const ext = VOICE_EXT[mime];

    // Clamp the client-reported length. It is display metadata for the player's
    // progress bar, so a wrong value is cosmetic — but an absurd one would
    // render a broken control, and an unbounded one lands in the DB.
    const rawMs = parseInt(req.body?.duration_ms, 10);
    const durationMs = Number.isFinite(rawMs) ? Math.min(Math.max(rawMs, 0), MAX_VOICE_MS) : null;

    let url;
    if (isCloudStorageEnabled()) {
      url = await uploadToCloud(req.file.buffer, mime, `voice${ext}`);
    } else {
      const uploadsDir = path.join(__dirname, '../../uploads');
      await mkdir(uploadsDir, { recursive: true });
      const filename = `voice-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      await writeFile(path.join(uploadsDir, filename), req.file.buffer);
      url = `/uploads/${filename}`;
    }

    res.json({ url, duration_ms: durationMs, mimetype: mime });
  } catch (error) {
    console.error('Voice upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
  // No uploadSlots here: there is no sharp/moderation section to protect. The
  // admission gate above still bounds bytes in flight, and releases on
  // res 'finish'/'close'.
});

export default router;

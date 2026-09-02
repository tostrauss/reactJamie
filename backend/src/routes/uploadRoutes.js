import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeFile, mkdir } from 'fs/promises';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { uploadToCloud, putObjectToCloud, isCloudStorageEnabled } from '../config/storage.js';
import { checkImageSafety } from '../config/moderation.js';
import { processImage, generateThumbnail, checkImageQuality } from '../config/imageProcessor.js';
import { createSemaphore } from '../utils/semaphore.js';

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
const uploadSlots = createSemaphore(MAX_CONCURRENT_UPLOADS);

// Surface multer errors (file-too-large, wrong mimetype) as JSON so the
// frontend can show a useful message instead of a generic "upload failed".
const handleUpload = upload.single('image');
router.post('/', authenticate, uploadLimiter, (req, res, next) => {
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
    await uploadSlots.acquire();
    slotHeld = true;

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

export default router;

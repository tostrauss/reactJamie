import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeFile, mkdir } from 'fs/promises';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rateLimiter.js';
import { uploadToCloud, isCloudStorageEnabled } from '../config/storage.js';
import { checkImageSafety } from '../config/moderation.js';
import { processImage, generateThumbnail } from '../config/imageProcessor.js';

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
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Kein Bild ausgewählt.' });
    }

    // Validate actual file bytes — reject if magic bytes don't match a known image format
    const detectedMime = detectMime(req.file.buffer);
    if (!detectedMime) {
      return res.status(400).json({ error: 'Ungültiger Dateityp. Nur Bilder erlaubt.' });
    }
    // Use the detected (safe) extension, never the user-supplied filename
    const safeExt = MIME_TO_EXT[detectedMime];
    const safeOriginalname = `upload${safeExt}`;

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
        thumbUrl = await uploadToCloud(thumbnail.buffer, thumbnail.mimetype, `thumb${thumbnail.extension}`).catch(() => null);
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
  }
});

export default router;

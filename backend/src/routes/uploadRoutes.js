import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeFile, mkdir } from 'fs/promises';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth.js';
import { uploadToCloud, isCloudStorageEnabled } from '../config/storage.js';
import { checkImageSafety } from '../config/moderation.js';

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

// Memory storage — we handle the final destination (cloud or disk) ourselves
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

router.post('/', authenticate, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Validate actual file bytes — reject if magic bytes don't match a known image format
    const detectedMime = detectMime(req.file.buffer);
    if (!detectedMime) {
      return res.status(400).json({ error: 'Ungültiger Dateityp. Nur Bilder erlaubt.' });
    }
    // Use the detected (safe) extension, never the user-supplied filename
    const safeExt = MIME_TO_EXT[detectedMime];
    const safeOriginalname = `upload${safeExt}`;

    // Moderation check — runs before anything is saved (cloud or disk)
    const { safe, reason } = await checkImageSafety(
      req.file.buffer,
      detectedMime,
      safeOriginalname
    );
    if (!safe) {
      return res.status(422).json({ error: reason });
    }

    let imageUrl;

    if (isCloudStorageEnabled()) {
      // Production: stream to Cloudflare R2 / AWS S3
      imageUrl = await uploadToCloud(req.file.buffer, detectedMime, safeOriginalname);
    } else {
      // Development fallback: write to local /uploads directory
      const uploadsDir = path.join(__dirname, '../../uploads');
      await mkdir(uploadsDir, { recursive: true });
      const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
      const filename = `image-${uniqueSuffix}${safeExt}`;
      await writeFile(path.join(uploadsDir, filename), req.file.buffer);
      imageUrl = `/uploads/${filename}`;
    }

    res.json({ url: imageUrl });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

export default router;

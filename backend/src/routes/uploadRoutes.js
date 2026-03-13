import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeFile, mkdir } from 'fs/promises';
import { authenticate } from '../middleware/auth.js';
import { uploadToCloud, isCloudStorageEnabled } from '../config/storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

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

    let imageUrl;

    if (isCloudStorageEnabled()) {
      // Production: stream to Cloudflare R2 / AWS S3
      imageUrl = await uploadToCloud(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      );
    } else {
      // Development fallback: write to local /uploads directory
      const uploadsDir = path.join(__dirname, '../../uploads');
      await mkdir(uploadsDir, { recursive: true });
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = path.extname(req.file.originalname) || '.jpg';
      const filename = `image-${uniqueSuffix}${ext}`;
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

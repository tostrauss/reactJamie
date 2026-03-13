// Cloud storage module — supports Cloudflare R2 and AWS S3 (S3-compatible)
// Falls back to local disk when STORAGE_ENDPOINT is not configured (dev mode)
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';
import { randomUUID } from 'crypto';

let _s3Client = null;

const getS3Client = () => {
  if (!_s3Client) {
    _s3Client = new S3Client({
      region: process.env.STORAGE_REGION || 'auto',
      endpoint: process.env.STORAGE_ENDPOINT,
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY,
        secretAccessKey: process.env.STORAGE_SECRET_KEY,
      },
    });
  }
  return _s3Client;
};

/**
 * Returns true when all required cloud storage env vars are set.
 */
export const isCloudStorageEnabled = () =>
  !!(
    process.env.STORAGE_ENDPOINT &&
    process.env.STORAGE_ACCESS_KEY &&
    process.env.STORAGE_SECRET_KEY &&
    process.env.STORAGE_BUCKET
  );

/**
 * Upload a file buffer to S3 / Cloudflare R2.
 * @param {Buffer} buffer     - File contents
 * @param {string} mimetype   - MIME type, e.g. 'image/jpeg'
 * @param {string} originalname - Original filename (used only for the extension)
 * @returns {Promise<string>} Full public URL of the uploaded object
 */
export const uploadToCloud = async (buffer, mimetype, originalname) => {
  if (!isCloudStorageEnabled()) {
    throw new Error('Cloud storage is not configured — set STORAGE_* env vars');
  }

  const ext = path.extname(originalname) || '.jpg';
  const key = `uploads/${randomUUID()}${ext}`;
  const bucket = process.env.STORAGE_BUCKET;

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimetype,
    })
  );

  // STORAGE_PUBLIC_URL: e.g. "https://pub-xxx.r2.dev" (R2 public bucket domain)
  // Falls back to AWS-style URL if not set
  const base =
    process.env.STORAGE_PUBLIC_URL ||
    `https://${bucket}.s3.${process.env.STORAGE_REGION || 'us-east-1'}.amazonaws.com`;

  return `${base}/${key}`;
};

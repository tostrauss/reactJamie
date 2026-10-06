// Cloud storage module — supports Cloudflare R2 and AWS S3 (S3-compatible)
// Falls back to local disk when STORAGE_ENDPOINT is not configured (dev mode)
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';
import { randomUUID } from 'crypto';

let _s3Client = null;

// Without these the SDK waits on a stalled R2 socket indefinitely. Every
// photo, avatar and voice note is read through the same-origin /media proxy,
// so one stuck GET was a chat photo that stayed a grey box — no error, no
// retry, nothing in the logs — and a stuck variant generation also held one
// of the proxy's four sharp slots.
// In @smithy/node-http-handler 4.4 requestTimeout is the time until the
// response HEADERS arrive (its timers end there; a body has no deadline of its
// own — the proxy's variant generation sets one, see mediaRoutes), and without
// throwOnRequestTimeout it only logs a warning and aborts NOTHING. Uploads
// (≤ 5 MB, one request) get the same 15 s to R2's answer; the SDK retries a
// TimeoutError up to 3 times.
export const STORAGE_TIMEOUTS = Object.freeze({
  connectionTimeout: 5_000,
  requestTimeout: 15_000,
  throwOnRequestTimeout: true,
});

const getS3Client = () => {
  if (!_s3Client) {
    _s3Client = new S3Client({
      region: process.env.STORAGE_REGION || 'auto',
      endpoint: process.env.STORAGE_ENDPOINT,
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY,
        secretAccessKey: process.env.STORAGE_SECRET_KEY,
      },
      requestHandler: { ...STORAGE_TIMEOUTS },
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
      // Each object has a UUID name and is never overwritten — safe to mark immutable for a year
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );

  // STORAGE_PUBLIC_URL: either a public bucket domain ("https://pub-xxx.r2.dev",
  // custom domain) or the app's own /media proxy ("https://app.jamie-app.com/media",
  // served by routes/mediaRoutes.js → getObjectFromCloud below). The proxy path
  // exists because pub-*.r2.dev sits on content-blocker filter lists (Samsung
  // Internet runs the Android TWA on Galaxys → no images) and jamie-app.com's
  // DNS lives at IONOS, so an R2 custom domain wasn't possible without a risky
  // pre-release nameserver move (2026-07-29).
  // Falls back to AWS-style URL if not set
  const base =
    process.env.STORAGE_PUBLIC_URL ||
    `https://${bucket}.s3.${process.env.STORAGE_REGION || 'us-east-1'}.amazonaws.com`;

  return `${base}/${key}`;
};

/**
 * Put a buffer at an EXPLICIT key (derived variants like thumbnails — unlike
 * uploadToCloud, which mints a fresh UUID key). Immutable cache headers: the
 * variant is derived from an immutable original and never changes either.
 */
export const putObjectToCloud = async (key, buffer, mimetype) => {
  if (!isCloudStorageEnabled()) {
    throw new Error('Cloud storage is not configured — set STORAGE_* env vars');
  }
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: process.env.STORAGE_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimetype,
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );
};

/**
 * Fetch an object from the bucket (used by the /media proxy route).
 * Returns the raw SDK response: `.Body` is a Node Readable stream,
 * plus ContentType / ContentLength / ETag passthrough metadata.
 * Throws NoSuchKey (surfaced as 404 by the route) when the key is absent.
 * `abortSignal` cancels the request (the proxy's variant deadline).
 */
export const getObjectFromCloud = async (key, { abortSignal } = {}) => {
  if (!isCloudStorageEnabled()) {
    throw new Error('Cloud storage is not configured — set STORAGE_* env vars');
  }
  return getS3Client().send(
    new GetObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: key }),
    abortSignal ? { abortSignal } : undefined
  );
};

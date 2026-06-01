/**
 * Input sanitization middleware
 * Strips HTML tags and trims whitespace from all string inputs
 * Prevents XSS attacks via user-submitted content
 */
const stripHtml = (str) => {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))  // decimal numeric entities
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))  // hex numeric entities
    .replace(/<[^>]*>/g, '')       // Remove HTML tags
    .replace(/&lt;/g, '<')         // Decode named entities for re-strip
    .replace(/&gt;/g, '>')
    .replace(/<[^>]*>/g, '')       // Re-strip after decode
    .trim();
};

// Fields that must NEVER be HTML-stripped:
//  - password fields: stripping <, > characters silently breaks login + register
//    for users whose passwords contain those characters
//  - tokens / codes / credentials: must be passed through byte-for-byte
//  - signature/webhook payloads: tampering invalidates HMAC verification
const SKIP_KEYS = new Set([
  'password', 'newPassword', 'currentPassword',
  'token', 'code', 'credential', 'refresh_token', 'access_token',
  'p256dh', 'auth', 'endpoint',
  'stripe-signature',
]);

const sanitizeValue = (value, key) => {
  if (key && SKIP_KEYS.has(key)) return value;
  if (typeof value === 'string') {
    return stripHtml(value);
  }
  if (Array.isArray(value)) {
    return value.map(v => sanitizeValue(v));
  }
  if (value && typeof value === 'object') {
    return sanitizeObject(value);
  }
  return value;
};

const sanitizeObject = (obj) => {
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = sanitizeValue(value, key);
  }
  return sanitized;
};

export const sanitizeInputs = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObject(req.query);
  }
  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeObject(req.params);
  }
  next();
};

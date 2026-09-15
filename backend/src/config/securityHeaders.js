/**
 * Permissions-Policy for the app's own documents.
 *
 * Extracted from server.js so it can be asserted in a test. The value here is
 * a browser capability switch that no unit or integration test can otherwise
 * observe — it only shows up as a feature silently refusing to work in a real
 * browser, which is exactly how it bit us.
 *
 * `microphone=(self)` — NOT `microphone=()`. An EMPTY allowlist disables the
 * feature for EVERY origin including our own, so `getUserMedia({ audio: true })`
 * is refused. That broke voice messages on the day they shipped, and
 * inconsistently: the header middleware runs after the static handler for `/`,
 * so navigating from the root worked while landing directly on /chat/:id (a
 * push deep link, a shared link, a reload inside a chat) did not.
 *
 * Everything else stays denied, including `camera`: photo messages use
 * <input type="file">, which goes through the OS picker out-of-process and
 * needs no camera permission. Enabling it would be a deliberate decision for
 * in-app capture, not a side effect.
 */
export const PERMISSIONS_POLICY = [
  'microphone=(self)',
  'camera=()',
  'display-capture=()',
  'usb=()',
  'serial=()',
  'battery=()',
].join(', ');

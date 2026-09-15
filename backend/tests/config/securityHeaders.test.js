import { describe, it, expect } from 'vitest';
import { PERMISSIONS_POLICY } from '../../src/config/securityHeaders.js';

// A browser capability switch no other test can observe: it does not fail a
// request, it makes a feature silently refuse to work in a real browser. Voice
// messages shipped broken on 2026-09-15 because this said `microphone=()`.
describe('Permissions-Policy', () => {
  it('allows the microphone for OUR OWN origin — voice messages need it', () => {
    // `microphone=()` is an EMPTY allowlist: denied for every origin including
    // self. `(self)` is what permits same-origin getUserMedia.
    expect(PERMISSIONS_POLICY).toContain('microphone=(self)');
    expect(PERMISSIONS_POLICY).not.toContain('microphone=()');
  });

  it('keeps everything else denied', () => {
    // Photo messages use <input type="file"> (OS picker, out of process), so
    // the camera stays off until someone deliberately wants in-app capture.
    for (const feature of ['camera', 'display-capture', 'usb', 'serial', 'battery']) {
      expect(PERMISSIONS_POLICY).toContain(`${feature}=()`);
    }
  });

  it('is a single well-formed header value', () => {
    expect(PERMISSIONS_POLICY).not.toMatch(/[\r\n]/);
    for (const part of PERMISSIONS_POLICY.split(', ')) {
      expect(part).toMatch(/^[a-z-]+=\((self)?\)$/);
    }
  });
});

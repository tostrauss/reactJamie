import { describe, it, expect, vi } from 'vitest';

// The controller pulls in the DB pool + moderation config at import time; the
// other controller suites stub the same way.
vi.mock('../../src/config/database.js', () => ({
  default: { query: vi.fn(), pool: { connect: vi.fn() } },
}));

const { normalizeTicketUrl } = await import('../../src/controllers/clubController.js');

// Ticket links are rendered as an <a href> on the event page, so anything that
// isn't plain http(s) must be rejected — a javascript:/data: URL there would be
// stored XSS against every attendee viewing the event.
describe('normalizeTicketUrl', () => {
  it('accepts http and https links', () => {
    expect(normalizeTicketUrl('https://shop.example.com/e/1')).toBe('https://shop.example.com/e/1');
    expect(normalizeTicketUrl('http://shop.example.com/e/1')).toBe('http://shop.example.com/e/1');
  });

  it('upgrades a scheme-less host to https (organisers paste bare domains)', () => {
    expect(normalizeTicketUrl('shop.example.com/tickets')).toBe('https://shop.example.com/tickets');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeTicketUrl('  https://shop.example.com/e  ')).toBe('https://shop.example.com/e');
  });

  it('rejects javascript: and data: URLs (XSS vectors)', () => {
    expect(normalizeTicketUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeTicketUrl('JavaScript:alert(1)')).toBeNull();
    expect(normalizeTicketUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects other non-web schemes', () => {
    expect(normalizeTicketUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeTicketUrl('ftp://example.com/x')).toBeNull();
  });

  it('rejects empty, non-string and over-long input', () => {
    expect(normalizeTicketUrl('')).toBeNull();
    expect(normalizeTicketUrl('   ')).toBeNull();
    expect(normalizeTicketUrl(null)).toBeNull();
    expect(normalizeTicketUrl(undefined)).toBeNull();
    expect(normalizeTicketUrl(123)).toBeNull();
    expect(normalizeTicketUrl(`https://example.com/${'a'.repeat(2100)}`)).toBeNull();
  });
});

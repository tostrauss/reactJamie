import { describe, it, expect, vi } from 'vitest';
import { sanitizeInputs } from '../../src/middleware/sanitize.js';

const makeReq = (overrides = {}) => ({
  body: {},
  query: {},
  params: {},
  ...overrides,
});

const makeRes = () => ({});
const next = vi.fn();

describe('sanitizeInputs middleware', () => {
  it('strips HTML tag markup, preserving text content between tags', () => {
    // Strips <script>...</script> wrapper; text content inside is kept
    const req = makeReq({ body: { name: '<script>alert(1)</script>Hello' } });
    sanitizeInputs(req, makeRes(), next);
    expect(req.body.name).toBe('alert(1)Hello');
    expect(next).toHaveBeenCalled();
  });

  it('strips simple inline formatting tags completely', () => {
    // Self-closing / void tags have no text content — only the tag is removed
    const req = makeReq({ body: { bio: '<b>Bold</b> text' } });
    sanitizeInputs(req, makeRes(), next);
    expect(req.body.bio).toBe('Bold text');
  });

  it('strips tags from nested objects', () => {
    const req = makeReq({ body: { user: { bio: '<b>Bold</b> text' } } });
    sanitizeInputs(req, makeRes(), next);
    expect(req.body.user.bio).toBe('Bold text');
  });

  it('strips tags from arrays', () => {
    const req = makeReq({ body: { tags: ['<em>sport</em>', 'musik'] } });
    sanitizeInputs(req, makeRes(), next);
    expect(req.body.tags).toEqual(['sport', 'musik']);
  });

  it('sanitizes query params', () => {
    const req = makeReq({ query: { search: '<img src=x onerror=alert(1)>cats' } });
    sanitizeInputs(req, makeRes(), next);
    expect(req.query.search).toBe('cats');
  });

  it('leaves non-string values untouched', () => {
    const req = makeReq({ body: { count: 42, active: true, nothing: null } });
    sanitizeInputs(req, makeRes(), next);
    expect(req.body.count).toBe(42);
    expect(req.body.active).toBe(true);
    expect(req.body.nothing).toBeNull();
  });

  it('decodes and re-strips encoded HTML', () => {
    const req = makeReq({ body: { text: '&lt;script&gt;xss&lt;/script&gt;clean' } });
    sanitizeInputs(req, makeRes(), next);
    expect(req.body.text).toBe('xssclean');
  });

  it('trims surrounding whitespace', () => {
    const req = makeReq({ body: { name: '   Jamie   ' } });
    sanitizeInputs(req, makeRes(), next);
    expect(req.body.name).toBe('Jamie');
  });

  // Regression — sanitizing the `password` field strips < > chars and
  // breaks login for users whose password legitimately contains them.
  it('does NOT touch the password field', () => {
    const req = makeReq({ body: { password: 'MyPass<x>1!' } });
    sanitizeInputs(req, makeRes(), next);
    expect(req.body.password).toBe('MyPass<x>1!');
  });

  it('does NOT touch token/code/credential fields', () => {
    const req = makeReq({ body: {
      token: 'pr_<abc>',
      code: '12<34>56',
      credential: 'g0o.gle<>token',
      currentPassword: 'old<P>1!',
      newPassword: 'new<P>1!',
    } });
    sanitizeInputs(req, makeRes(), next);
    expect(req.body.token).toBe('pr_<abc>');
    expect(req.body.code).toBe('12<34>56');
    expect(req.body.credential).toBe('g0o.gle<>token');
    expect(req.body.currentPassword).toBe('old<P>1!');
    expect(req.body.newPassword).toBe('new<P>1!');
  });

  it('does NOT touch push-subscription crypto fields', () => {
    const req = makeReq({ body: { endpoint: 'https://fcm.googleapis.com/x<y>', auth: 'a<b>', p256dh: 'p<q>' } });
    sanitizeInputs(req, makeRes(), next);
    expect(req.body.endpoint).toBe('https://fcm.googleapis.com/x<y>');
    expect(req.body.auth).toBe('a<b>');
    expect(req.body.p256dh).toBe('p<q>');
  });
});

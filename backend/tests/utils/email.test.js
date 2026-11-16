import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'team@example.com';
process.env.RESEND_API_KEY = 'test-key';
process.env.FRONTEND_URL = 'https://app.jamie-app.com';

// The admin e-mail „… wartet auf Freischaltung“ names the type like the
// approval queue does (Tina 16.11.2026: „im Admin auch als Club … und
// Community als Community“). Resend is reached through global fetch — the
// stub records the payload instead.
vi.mock('../../src/config/database.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../src/config/sentry.js', () => ({ Sentry: { captureMessage: vi.fn() } }));

const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'mail-1' }) }));
vi.stubGlobal('fetch', fetchMock);

const { sendAdminClubPendingEmail } = await import('../../src/utils/email.js');

const sentMail = () => JSON.parse(fetchMock.mock.calls[0][1].body);
const club = (over = {}) => ({
  id: 41, name: 'Lauftreff Prater', category: 'Sport', location: 'Wien', description: 'Jeden Dienstag', ...over,
});

beforeEach(() => {
  fetchMock.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => vi.unstubAllGlobals());

describe('sendAdminClubPendingEmail — says whether a club or a community waits', () => {
  it('an official club: „Neuer Club“, Typ Club', async () => {
    await sendAdminClubPendingEmail(club({ club_type: 'official' }), 7);
    const mail = sentMail();
    expect(mail.to).toBe('team@example.com');
    expect(mail.subject).toBe('[JAMIE] Neuer Club wartet auf Freischaltung: Lauftreff Prater');
    expect(mail.html).toContain('Neuer Club wartet auf Freischaltung</h2>');
    expect(mail.html).toContain('Ein User hat einen Club erstellt.');
    expect(mail.html).toMatch(/Typ:<\/td><td[^>]*>Club<\/td>/);
    expect(mail.html).toContain('https://app.jamie-app.com/admin#clubs-pending');
  });

  it('a community from an old bundle: „Neue Community“, Typ Community', async () => {
    await sendAdminClubPendingEmail(club({ club_type: 'community' }), 7);
    const mail = sentMail();
    expect(mail.subject).toBe('[JAMIE] Neue Community wartet auf Freischaltung: Lauftreff Prater');
    expect(mail.html).toContain('Neue Community wartet auf Freischaltung</h2>');
    expect(mail.html).toContain('Ein User hat eine Community erstellt.');
    expect(mail.html).toMatch(/Typ:<\/td><td[^>]*>Community<\/td>/);
  });

  it('no type at all reads as a community — the queue\'s rule (NULL = community)', async () => {
    await sendAdminClubPendingEmail(club({ club_type: null }), 7);
    expect(sentMail().subject).toBe('[JAMIE] Neue Community wartet auf Freischaltung: Lauftreff Prater');
  });

  it('the club name is escaped in the body', async () => {
    await sendAdminClubPendingEmail(club({ club_type: 'official', name: '<b>Bar</b>' }), 7);
    expect(sentMail().html).toContain('&lt;b&gt;Bar&lt;/b&gt;');
  });
});

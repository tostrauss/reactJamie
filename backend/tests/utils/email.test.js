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

const { sendAdminClubPendingEmail, sendPartnerLeadEmail } = await import('../../src/utils/email.js');

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

// „JAMIE Anfrage“ (Tina 17.11.2026): the request a club's manager sends from
// the partner message goes to the office inbox. Everything in it is typed by
// a user.
describe('sendPartnerLeadEmail — the partner request goes to the office', () => {
  const lead = (over = {}) => ({
    id: 11, user_id: 3, source: 'third', name: 'Tina Muster', company: 'Café Soleá GmbH',
    email: 'tina@solea.at', phone: '+43 660 1234567', contact: 'mail',
    created_at: '2026-11-17T09:05:00Z', ...over,
  });
  const cafe = { id: 41, name: 'Café Soleá' };

  it('goes to office@jamie-app.com, whatever ADMIN_EMAIL says', async () => {
    await sendPartnerLeadEmail(lead(), cafe);
    const mail = sentMail();
    expect(mail.to).toBe('office@jamie-app.com');
    expect(mail.subject).toBe('[JAMIE] Partner-Anfrage: Café Soleá');
  });

  it('carries the club, what raised it, the contact data and how they want to be reached', async () => {
    await sendPartnerLeadEmail(lead(), cafe);
    const { html } = sentMail();
    expect(html).toContain('href="https://app.jamie-app.com/club/41"');
    expect(html).toContain('Nachricht 2 · 3. Event');
    expect(html).toContain('Tina Muster');
    expect(html).toContain('Café Soleá GmbH');
    expect(html).toContain('href="mailto:tina@solea.at"');
    expect(html).toContain('href="tel:+436601234567"');
    expect(html).toContain('+43 660 1234567');
    expect(html).toMatch(/Kontaktwunsch:<\/td><td[^>]*>per Mail<\/td>/);
    expect(html).toContain('#3');
    expect(html).toContain('17.11.2026');                       // Vienna time
    expect(html).toContain('10:05');
    expect(html).toContain('https://app.jamie-app.com/admin#partner-leads');
  });

  it('names each of the four ways it was raised, and a call as a call', async () => {
    for (const [source, text] of [['concurrent', 'Nachricht 1 · 2. Event gleichzeitig'], ['ticket', 'Ticket-Event'], ['deal', 'Deal']]) {
      fetchMock.mockClear();
      await sendPartnerLeadEmail(lead({ source, contact: 'call', email: null }), cafe);
      const { html } = sentMail();
      expect(html).toContain(text);
      expect(html).toMatch(/Kontaktwunsch:<\/td><td[^>]*>per Anruf<\/td>/);
      expect(html).not.toContain('mailto:');
    }
  });

  it('everything a user typed is escaped', async () => {
    await sendPartnerLeadEmail(
      lead({ name: '<script>alert(1)</script>', company: '<img src=x onerror=alert(1)>', email: 'a"b@x.at' }),
      { id: 41, name: '<b>Bar</b>' });
    const { html } = sentMail();
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>Bar</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;Bar&lt;/b&gt;');
    expect(html).toContain('a&quot;b@x.at');
  });

  it('no line break reaches the subject', async () => {
    await sendPartnerLeadEmail(lead(), { id: 41, name: 'Café\r\nBcc: boese@x.at' });
    const { subject } = sentMail();
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toBe('[JAMIE] Partner-Anfrage: Café Bcc: boese@x.at');
  });

  it('names no price', async () => {
    for (const source of ['concurrent', 'third', 'ticket', 'deal']) {
      fetchMock.mockClear();
      await sendPartnerLeadEmail(lead({ source }), cafe);
      const mail = sentMail();
      expect(`${mail.subject} ${mail.html}`).not.toMatch(/€|\bEuro\b/);
    }
  });

  it('without a request or a club nothing is sent', async () => {
    await sendPartnerLeadEmail(null, cafe);
    await sendPartnerLeadEmail(lead(), null);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

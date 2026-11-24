import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { AuthContext } from '../context/AuthContext';

// Tina's two partner letters (document of 17.11.2026) in the „Tageslimit
// erreicht“ sheet, and the form „JAMIE Anfrage“ behind „Ja, meldet euch!“.
// Her wording, character for character — minus the two price sentences
// (Tobi 17.11.2026: no prices anywhere, on any platform). Real German i18n.
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../utils/api', () => ({ partnerApi: { requestPartner: vi.fn() } }));
const { partnerApi } = await import('../utils/api');
const { PartnerInviteSheet } = await import('../components/PartnerInviteSheet');

const USER = { id: 3, name: 'Tina Muster', email: 'tina@solea.at', is_admin: false };
const onClose = vi.fn();
const renderSheet = (props = {}) => render(
  <AuthContext.Provider value={{ user: USER }}>
    <PartnerInviteSheet clubId={7} clubName="Café Krie" onClose={onClose} {...props} />
  </AuthContext.Provider>,
);
const text = (s) => screen.getByText(s);
const openForm = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ja, meldet euch!' })); }); };
const input = (label) => screen.getByLabelText(label);
const type = (label, value) => fireEvent.change(input(label), { target: { value } });
const send = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Anfrage senden' })); }); };

beforeEach(() => {
  vi.clearAllMocks();
  partnerApi.requestPartner.mockResolvedValue({ data: { ok: true } });
});

describe('the letter when a second event is created while the first is still ahead', () => {
  it('Tina\'s words, in her order — with the club\'s name, without a price', () => {
    renderSheet({ reason: 'concurrent' });
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Hey Café Krie, ihr seid ja schnell! 🙌');
    text('Wir haben JAMIE gebaut, damit Menschen in Wien wieder echt zusammenkommen und am liebsten an Orten wie eurem!');
    text('Gratis geht 1 Event gleichzeitig. Wenn ihr mehr wollt, werdet unser Partner:');
    text('Bis zu 3 Events gleichzeitig');
    text('Eigene Deals für eure Gäste');
    text('Offizielles Partner Badge & mehr!');
    text('Ehrlich gesagt: Die Partnerschaft kostet etwas. Dafür entwickelt ihr JAMIE mit uns weiter. Hättet ihr Lust? Wir melden uns persönlich bei euch. 😊');
    // her three emojis, in her order
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent.indexOf('📅')).toBeGreaterThan(-1);
    expect(dialog.textContent.indexOf('📅')).toBeLessThan(dialog.textContent.indexOf('🎁'));
    expect(dialog.textContent.indexOf('🎁')).toBeLessThan(dialog.textContent.indexOf('⭐'));
    expect(dialog.textContent).not.toMatch(/€|\b19\b|\b49\b|Pilotpartner zahlt/);
    // the dialog is named by its title
    expect(dialog.getAttribute('aria-labelledby')).toBe(screen.getByRole('heading', { level: 2 }).id);
  });

  it('„Noch nicht bereit? …“ stands below the button and closes the sheet; so do the X and a tap beside it', () => {
    renderSheet({ reason: 'concurrent' });
    const cta = screen.getByRole('button', { name: 'Ja, meldet euch!' });
    const later = screen.getByRole('button', { name: 'Noch nicht bereit? Ein weiteres Event ist gratis, sobald euer erstes vorbei ist.' });
    expect(cta.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(later);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(document.querySelector('.partner-sheet-overlay'));
    expect(onClose).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('dialog'));          // inside the sheet: stays
    expect(onClose).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(4);
  });
});

describe('the letter at the third event', () => {
  it('Tina\'s words — no line below the button, only the X', () => {
    renderSheet({ reason: 'third' });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Hey Café Krie, schön, dass ihr wieder ein Event plant! 🙌');
    text('Wir haben JAMIE gebaut, damit Menschen in Wien wieder echt zusammenkommen, und es freut uns sehr, dass das schon zweimal bei euch passiert ist.');
    text('Ab dem dritten Event geht es als JAMIE Partner weiter. Damit könnt ihr:');
    text('bis zu 3 Events gleichzeitig planen');
    text('eigene Deals für eure Gäste anlegen');
    text('das offizielle Partner Badge bekommen & mehr');
    text('Ehrlich gesagt: Die Partnerschaft kostet etwas. Gerade suchen wir aber 10 Pilotpartner, die JAMIE mit uns weiterentwickeln.');
    text('Hättet ihr Lust? Wir melden uns persönlich bei euch. 😊');
    expect(screen.getByRole('dialog').textContent).not.toMatch(/€|\b19\b|\b49\b/);
    expect(screen.queryByText(/Noch nicht bereit/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a deal from the third event on gets the same letter', () => {
    renderSheet({ reason: 'deal' });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Hey Café Krie, schön, dass ihr wieder ein Event plant! 🙌');
    expect(screen.queryByText(/Noch nicht bereit/)).toBeNull();
  });
});

describe('the letter when „Kostenfreies Event“ is unticked', () => {
  it('the first letter, without „Noch nicht bereit? …“ — a ticket event does not become free by waiting', () => {
    renderSheet({ reason: 'ticket' });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Hey Café Krie, ihr seid ja schnell! 🙌');
    text('Gratis geht 1 Event gleichzeitig. Wenn ihr mehr wollt, werdet unser Partner:');
    expect(screen.queryByText(/Noch nicht bereit/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Ja, meldet euch!' })).toBeTruthy();
  });
});

describe('„Ja, meldet euch!“ → „JAMIE Anfrage“', () => {
  it('the same sheet becomes the form: name and e-mail filled in from the account, company optional, the X stays', async () => {
    renderSheet({ reason: 'third' });
    await openForm();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('JAMIE Anfrage');
    expect(screen.queryByText(/schön, dass ihr wieder/)).toBeNull();
    expect(input('Name').value).toBe('Tina Muster');
    expect(input('E-Mail').value).toBe('tina@solea.at');
    expect(input('E-Mail').type).toBe('email');
    expect(input('Unternehmen').value).toBe('');
    expect(input('Unternehmen').placeholder).toBe('optional');
    expect(input('Telefon').value).toBe('');
    expect(input('Telefon').type).toBe('tel');
    expect(screen.getByRole('button', { name: 'Schließen' })).toBeTruthy();
    // 16px inputs: iOS zooms into anything smaller
    for (const label of ['Name', 'Unternehmen', 'E-Mail', 'Telefon']) expect(input(label).style.fontSize).toBe('16px');
    expect(screen.getByRole('dialog').textContent).not.toMatch(/€/);
  });

  it('the switch is preset to mail and turns to call — its sentence changes exactly between Tina\'s two', async () => {
    renderSheet();
    await openForm();
    const sw = screen.getByRole('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    text('ich möchte lieber per Mail kontaktiert werden');
    expect(screen.queryByText('ich möchte lieber per Anruf kontaktiert werden')).toBeNull();
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    text('ich möchte lieber per Anruf kontaktiert werden');
    expect(screen.queryByText('ich möchte lieber per Mail kontaktiert werden')).toBeNull();
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('false');
    text('ich möchte lieber per Mail kontaktiert werden');
  });

  it('the privacy tick links to the privacy policy and starts unticked', async () => {
    renderSheet();
    await openForm();
    const box = screen.getByRole('checkbox');
    expect(box.checked).toBe(false);
    const link = screen.getByRole('link', { name: 'Datenschutzerklärung' });
    expect(link.getAttribute('href')).toBe('https://app.jamie-app.com/privacy');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.closest('label').textContent)
      .toBe('Ich habe die Datenschutzerklärung gelesen und bin einverstanden, dass JAMIE mich zu dieser Anfrage kontaktiert.');
  });

  it.each([
    ['no name', (f) => { f.type('Name', '   '); f.tick(); }, 'Bitte gib deinen Namen an.'],
    ['by mail without an e-mail', (f) => { f.type('E-Mail', ''); f.tick(); }, 'Bitte gib eine gültige E-Mail-Adresse an.'],
    ['an e-mail that is none', (f) => { f.type('E-Mail', 'tina@solea'); f.tick(); }, 'Bitte gib eine gültige E-Mail-Adresse an.'],
    ['by call without a phone', (f) => { f.call(); f.tick(); }, 'Bitte gib eine Telefonnummer an.'],
    ['a phone that is none', (f) => { f.type('Telefon', 'ruf an'); f.tick(); }, 'Bitte gib eine Telefonnummer an.'],
    ['no privacy tick', () => {}, 'Bitte bestätige den Datenschutz.'],
  ])('%s: the fault stands under its field, nothing is sent, no toast', async (_what, arrange, message) => {
    renderSheet();
    await openForm();
    arrange({ type, tick: () => fireEvent.click(screen.getByRole('checkbox')), call: () => fireEvent.click(screen.getByRole('switch')) });
    await send();
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(partnerApi.requestPartner).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('by call the e-mail may stay empty; a fault goes away once its field is touched', async () => {
    renderSheet();
    await openForm();
    fireEvent.click(screen.getByRole('switch'));
    type('E-Mail', '');
    fireEvent.click(screen.getByRole('checkbox'));
    await send();
    expect(screen.getByRole('alert').textContent).toBe('Bitte gib eine Telefonnummer an.');
    type('Telefon', '+43 660 1234567');
    expect(screen.queryByRole('alert')).toBeNull();
    await send();
    expect(partnerApi.requestPartner).toHaveBeenCalledTimes(1);
  });

  it('sends what was typed, how they want to be reached, the tick and which letter it came from — then thanks and closes', async () => {
    renderSheet({ reason: 'third' });
    await openForm();
    type('Name', '  Tina Muster ');
    type('Unternehmen', 'Café Krie GmbH');
    type('Telefon', '+43 660 1234567');
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('checkbox'));
    await send();
    expect(partnerApi.requestPartner).toHaveBeenCalledWith(7, {
      name: 'Tina Muster', company: 'Café Krie GmbH', email: 'tina@solea.at', phone: '+43 660 1234567',
      contact: 'call', privacy: true, reason: 'third',
    });
    expect(toast.success).toHaveBeenCalledWith('Danke! Wir melden uns persönlich bei euch. 😊');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('by mail, from the ticket letter: contact mail, reason ticket; a request sent twice is thanked the same', async () => {
    partnerApi.requestPartner.mockResolvedValue({ data: { ok: true, duplicate: true } });
    renderSheet({ reason: 'ticket' });
    await openForm();
    fireEvent.click(screen.getByRole('checkbox'));
    await send();
    expect(partnerApi.requestPartner).toHaveBeenCalledWith(7, expect.objectContaining({ contact: 'mail', reason: 'ticket', privacy: true, company: '', phone: '' }));
    expect(toast.success).toHaveBeenCalledWith('Danke! Wir melden uns persönlich bei euch. 😊');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('while it is being sent the button says so and cannot be tapped again', async () => {
    let finish;
    partnerApi.requestPartner.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderSheet();
    await openForm();
    fireEvent.click(screen.getByRole('checkbox'));
    await send();
    const busy = screen.getByRole('button', { name: 'Wird gesendet…' });
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(partnerApi.requestPartner).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ data: { ok: true } }); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the server refuses a field: the fault stands under it, the sheet stays', async () => {
    partnerApi.requestPartner.mockRejectedValue({ response: { status: 400, data: { code: 'LEAD_INVALID', field: 'phone', error: 'Bitte gib eine gültige Telefonnummer an.' } } });
    renderSheet();
    await openForm();
    type('Telefon', '+43 660 1234567');
    fireEvent.click(screen.getByRole('checkbox'));
    await send();
    expect(screen.getByRole('alert').textContent).toBe('Bitte gib eine Telefonnummer an.');
    expect(toast.error).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Anfrage senden' }).disabled).toBe(false);
  });

  it('any other failure: the server\'s sentence as a toast — or our own when it sent none; the sheet stays, filled in', async () => {
    partnerApi.requestPartner.mockRejectedValueOnce({ response: { status: 403, data: { error: 'Keine Berechtigung', code: 'NOT_CLUB_MANAGER' } } });
    renderSheet();
    await openForm();
    type('Unternehmen', 'Café Krie GmbH');
    fireEvent.click(screen.getByRole('checkbox'));
    await send();
    expect(toast.error).toHaveBeenLastCalledWith('Keine Berechtigung');
    partnerApi.requestPartner.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    await send();
    expect(toast.error).toHaveBeenLastCalledWith('Die Anfrage konnte nicht gesendet werden. Bitte versuch es noch einmal.');
    expect(onClose).not.toHaveBeenCalled();
    expect(input('Unternehmen').value).toBe('Café Krie GmbH');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('JAMIE Anfrage');
  });
});

describe('the sheet itself', () => {
  it('sits above everything like „Tageslimit erreicht“, clears the bottom nav and scrolls inside', () => {
    renderSheet();
    expect(document.querySelector('.partner-sheet-overlay').style.zIndex).toBe('10000');
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/PartnerInviteSheet.jsx'), 'utf8');
    expect(src).toContain('calc(60px + var(--nav-safe-bottom) + 16px)');
    expect(src).toContain("maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 12px)'");
    expect(src).toContain("overflowY: 'auto'");
  });

  it('a long club name stands in the title in full', () => {
    renderSheet({ clubName: 'Café Krieau & Friends am Donaukanal' });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Hey Café Krieau & Friends am Donaukanal, ihr seid ja schnell! 🙌');
  });
});

// Tobi 17.11.2026: no price in the sheet, the form or any of the five
// languages — Tina names it when she talks to them.
describe('partner.* in all five languages', () => {
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));
  const load = (l) => flat(JSON.parse(fs.readFileSync(path.resolve(process.cwd(), `src/i18n/locales/${l}.json`), 'utf8')).partner);
  const de = load('de');

  it.each(['de', 'en', 'it', 'fr', 'es'])('%s: no „€“, no price, the club\'s name in both titles, the link in the privacy line', (l) => {
    const entries = load(l);
    expect(entries.map(([k]) => k)).toEqual(de.map(([k]) => k));
    for (const [key, value] of entries) {
      expect(value, key).not.toMatch(/€|EUR|\bEuro\b|\b19\b|\b49\b/);
      expect(value.trim(), key).toBe(value);
      expect(value.length, key).toBeGreaterThan(0);
    }
    const of = Object.fromEntries(entries);
    expect(of['concurrent.title']).toContain('{{name}}');
    expect(of['third.title']).toContain('{{name}}');
    expect(of['request.privacy']).toMatch(/<1>[^<]+<\/1>/);
    // Tina's emojis stay where she put them
    expect(of['concurrent.title']).toContain('🙌');
    expect(of['third.title']).toContain('🙌');
    expect(of['concurrent.outro']).toContain('😊');
    expect(of['third.outro2']).toContain('😊');
  });
});

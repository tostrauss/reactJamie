import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// DealForm — the deal form out of AdminDealsSection (P4 v2, Tina/Tobi
// 16.11.2026): the admin keeps exactly its Kooperationen form, clubs with Pro
// fill in the same one in their edit page's look ('club'); the form checks
// the required fields, builds the payload and hands it to the parent
// (onSubmit(payload, id)). Real German i18n.
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../utils/googleMaps', () => ({
  loadGoogleMaps: vi.fn(), onGoogleMapsReady: vi.fn(), createPlacesAutocomplete: vi.fn(),
}));
vi.mock('../utils/api', () => ({ upload: { image: vi.fn() } }));
const { upload } = await import('../utils/api');
const { default: DealForm } = await import('../components/DealForm');
const { viennaTodayUTC } = await import('../utils/recurrence');

const PHOTO = 'https://app.jamie-app.com/media/p.webp';
const deal = (o = {}) => ({
  id: 5, name: 'Café Soleá', deal_label: '1 Getränk gratis', description: 'Sag „Jamie“',
  address: 'Gumpendorfer Straße 1, 1060 Wien', booking_url: '', photos: [PHOTO],
  visible_until: '2026-12-24T00:00:00.000Z', max_redemptions: 50, redeem_interval: 'weekly', redeem_days: [4], ...o,
});
const renderForm = (props = {}) => {
  const onSubmit = vi.fn(async () => {});
  const onCancel = vi.fn();
  render(<DealForm title="Neue Kooperation" onSubmit={onSubmit} onCancel={onCancel} {...props} />);
  return { onSubmit, onCancel };
};
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
const preview = () => document.querySelector('form img');

beforeEach(() => vi.clearAllMocks());

describe('DealForm — admin (the Kooperationen form, unchanged)', () => {
  it('the admin fields; "Sichtbar bis" optional without an upper limit; German weekday chips', () => {
    renderForm();
    expect(screen.getByRole('form', { name: 'Neue Kooperation' })).toBeInTheDocument();
    for (const label of [/^Unternehmen/, /^Deal-Überschrift \(2 Wörter\)/, 'Genaue Beschreibung', 'Adresse',
      'Externer Link / Ticketshop (optional)', 'Wie oft einlösbar?', 'Sichtbar bis', 'Max. Einlösungen']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    const until = screen.getByLabelText('Sichtbar bis');
    expect(until).not.toBeRequired();
    expect(until).not.toHaveAttribute('max');
    expect(screen.getByLabelText('Max. Einlösungen')).toHaveValue(100);
    const days = screen.getByRole('group', { name: 'Nur an bestimmten Tagen einlösbar?' });
    expect([...days.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
    expect(screen.getByLabelText('Wie oft einlösbar?')).toHaveValue('once');
  });

  it('company and headline are required — blank (only spaces) gets a toast, nothing handed on', () => {
    const { onSubmit } = renderForm();
    type(/^Unternehmen/, 'Café Soleá');
    type(/^Deal-Überschrift/, '   ');   // passes the browser's `required`, not ours
    save();
    expect(toast.error).toHaveBeenCalledWith('Unternehmen und Überschrift sind Pflichtfelder');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a new deal: the payload as the admin always sent it, empty fields as null', async () => {
    const { onSubmit } = renderForm();
    type(/^Unternehmen/, '  Café Soleá ');
    type(/^Deal-Überschrift/, '1+1 Gratis');
    fireEvent.click(screen.getByRole('button', { name: 'Do' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mo' }));
    save();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Café Soleá', deal_label: '1+1 Gratis', description: null, address: null, booking_url: null,
      photos: [], visible_until: null, max_redemptions: '100', redeem_interval: 'once', redeem_days: [1, 4],
    }, null);
  });

  it('editing prefills every field and hands on the id; an emptied cap is unlimited (null)', async () => {
    const { onSubmit } = renderForm({ deal: deal(), title: 'Kooperation bearbeiten' });
    expect(screen.getByLabelText(/^Unternehmen/)).toHaveValue('Café Soleá');
    expect(screen.getByLabelText('Sichtbar bis')).toHaveValue('2026-12-24');
    expect(screen.getByLabelText('Wie oft einlösbar?')).toHaveValue('weekly');
    expect(screen.getByRole('button', { name: 'Do' })).toHaveAttribute('aria-pressed', 'true');
    expect(preview()).toHaveAttribute('src', PHOTO);
    type('Max. Einlösungen', '');
    save();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [payload, id] = onSubmit.mock.calls[0];
    expect(id).toBe(5);
    expect(payload).toEqual({
      name: 'Café Soleá', deal_label: '1 Getränk gratis', description: 'Sag „Jamie“',
      address: 'Gumpendorfer Straße 1, 1060 Wien', booking_url: null, photos: [PHOTO],
      visible_until: '2026-12-24', max_redemptions: null, redeem_interval: 'weekly', redeem_days: [4],
    });
  });

  it('a photo: upload, preview, remove', async () => {
    upload.image.mockResolvedValue({ data: { url: 'https://app.jamie-app.com/media/new.webp' } });
    renderForm();
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    await waitFor(() => expect(preview()).toHaveAttribute('src', 'https://app.jamie-app.com/media/new.webp'));
    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }));
    expect(preview()).toBeNull();
    expect(screen.getByRole('button', { name: 'Foto auswählen' })).toBeInTheDocument();
  });

  it('a failed upload says why; „Abbrechen“ goes to the parent', async () => {
    upload.image.mockRejectedValue({ response: { data: { error: 'Bild zu groß' } } });
    const { onCancel } = renderForm();
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File(['x'], 'x.png')] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Bild zu groß'));
    expect(preview()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('while the parent saves, the button says so and cannot be pressed twice', async () => {
    let finish;
    const onSubmit = vi.fn(() => new Promise((r) => { finish = r; }));
    render(<DealForm title="x" onSubmit={onSubmit} onCancel={() => {}} deal={deal()} />);
    save();
    expect(await screen.findByRole('button', { name: 'Speichert…' })).toBeDisabled();
    finish();
    expect(await screen.findByRole('button', { name: 'Speichern' })).not.toBeDisabled();
  });
});

describe('DealForm — club (a club\'s own deal, P4 v2)', () => {
  const clubForm = (props = {}) => renderForm({ variant: 'club', title: 'Neuer Deal', defaults: { name: 'Bar Neun' }, ...props });
  // Vienna days, like the form (review 16.11.2026).
  const day = (n) => new Date(viennaTodayUTC() + n * 864e5).toISOString().slice(0, 10);
  // Next to the page's own „Speichern“ the deal form says what it saves.
  const saveDeal = () => fireEvent.click(screen.getByRole('button', { name: 'Deal speichern' }));

  it('the edit page\'s look, the club\'s texts; the club name prefilled; „Sichtbar bis“ required, tomorrow … 180 days', () => {
    clubForm();
    const form = screen.getByRole('form', { name: 'Neuer Deal' });
    expect(form).toHaveClass('ge-card', 'ge-deal-form');
    expect(screen.getByLabelText(/^Name auf der Karte/)).toHaveValue('Bar Neun');
    expect(screen.getByLabelText(/^Name auf der Karte/)).toHaveClass('ge-input');
    const until = screen.getByLabelText(/^Sichtbar bis \*/);
    expect(until).toBeRequired();
    expect(until).toHaveAttribute('min', day(1));
    expect(until).toHaveAttribute('max', day(180));
    expect(screen.getByText('Höchstens 180 Tage – danach wird der Deal automatisch ausgeblendet.')).toBeInTheDocument();
    expect(screen.getByLabelText('Adresse')).toHaveAttribute('placeholder', 'Leer = Adresse deines Clubs');
    // how often: chips, not a select
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    const often = screen.getByRole('group', { name: 'Wie oft einlösbar?' });
    expect(within(often).getByRole('button', { name: 'Einmal pro Person' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(often).getAllByRole('button')).toHaveLength(3);
  });

  // 00:30 in Vienna is still yesterday in UTC: „tomorrow“ is Vienna's tomorrow
  // — the UTC day offered a date that ran out the same night.
  it('tomorrow and the last day are Vienna\'s, also just after midnight there', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-16T23:30:00Z'));   // 17.11. 00:30 in Vienna
      clubForm();
      const until = screen.getByLabelText(/^Sichtbar bis \*/);
      expect(until).toHaveAttribute('min', '2026-11-18');
      expect(until).toHaveAttribute('max', '2027-05-16');
    } finally {
      vi.useRealTimers();
    }
  });

  // Review 16.11.2026: a deal „sichtbar bis“ today is live until 23:59:59 in
  // Vienna — min = tomorrow made the browser refuse to save it unchanged.
  it('an edit may keep today as „Sichtbar bis“ — only a new deal starts tomorrow', async () => {
    const { onSubmit } = clubForm({ deal: deal({ visible_until: `${day(0)}T22:59:59.000Z` }), title: 'Deal bearbeiten' });
    const until = screen.getByLabelText(/^Sichtbar bis \*/);
    expect(until).toHaveValue(day(0));
    expect(until).toHaveAttribute('min', day(0));
    expect(until).toHaveAttribute('max', day(180));
    expect(until).toBeValid();
    saveDeal();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].visible_until).toBe(day(0));
    expect(onSubmit.mock.calls[0][1]).toBe(5);
  });

  it('without an end date nothing is handed on — the club\'s toast names all three fields', () => {
    const { onSubmit } = clubForm();
    type(/^Angebot/, '2 für 1');
    fireEvent.submit(screen.getByRole('form', { name: 'Neuer Deal' }));
    expect(toast.error).toHaveBeenCalledWith('Name, Angebot und „Sichtbar bis“ sind Pflichtfelder');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a new deal: chips set the interval, an empty address is null (the club\'s)', async () => {
    const { onSubmit } = clubForm();
    type(/^Angebot/, '2 für 1');
    type(/^Sichtbar bis/, day(30));
    fireEvent.click(screen.getByRole('button', { name: '1× pro Woche' }));
    saveDeal();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Bar Neun', deal_label: '2 für 1', visible_until: day(30), redeem_interval: 'weekly', address: null,
    }), null);
  });

  it('an edit sends the address only when it changed (no geocoding of an untouched one)', async () => {
    const { onSubmit } = clubForm({ deal: deal({ visible_until: `${day(20)}T00:00:00.000Z` }), title: 'Deal bearbeiten' });
    saveDeal();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].address).toBeUndefined();
    expect(onSubmit.mock.calls[0][1]).toBe(5);
    type('Adresse', 'Neubaugasse 7, 1070 Wien');
    saveDeal();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1][0].address).toBe('Neubaugasse 7, 1070 Wien');
  });

  it('weekday chips in the UI language', async () => {
    const { switchLanguage } = await import('../i18n');
    await switchLanguage('en');
    try {
      clubForm();
      const days = screen.getByRole('group', { name: 'Redeemable only on certain days?' });
      expect([...days.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    } finally {
      await switchLanguage('de');
    }
  });
});

// Tina 17.11.2026: the bar „Deal anlegen“ in a club's event form — „dann
// öffnet sich nochmal ein Feld, wo man die Deal Infos reingibt inkl. wann der
// Deal angezeigt werden soll, eh wie wir es hatten“. The same fields as a
// panel inside the event's own form: no <form>, no buttons, and it tells the
// host what it holds.
describe('DealForm — embedded in an event\'s form („Deal anlegen“)', () => {
  const day = (n) => new Date(viennaTodayUTC() + n * 864e5).toISOString().slice(0, 10);
  const embed = (props = {}) => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <form aria-label="Event" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <DealForm variant="club" look="event" embedded title="Deal zum Event" defaults={{ name: 'Bar Neun' }}
          onChange={onChange} {...props} />
        <button type="submit">Event erstellen</button>
      </form>,
    );
    return { onChange, onSubmit, last: () => onChange.mock.calls.at(-1)[0] };
  };

  it('a panel, not a form: the fields only — no title, no Speichern, no Abbrechen', () => {
    embed();
    const panel = screen.getByRole('group', { name: 'Deal zum Event' });
    expect(panel).toHaveClass('cd-event-deal-panel');
    expect(panel.tagName).toBe('DIV');
    expect(panel.querySelector('form')).toBeNull();
    expect(screen.getAllByRole('form')).toHaveLength(1);                 // the event's own
    expect(within(panel).queryByRole('heading')).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Deal speichern' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Abbrechen' })).toBeNull();
    // the same fields as on the edit page — „eh wie wir es hatten“
    for (const label of [/^Name auf der Karte/, /^Angebot/, 'Adresse', /^Sichtbar bis/, 'Max. Einlösungen']) {
      expect(within(panel).getByLabelText(label)).toBeInTheDocument();
    }
    expect(within(panel).getByRole('group', { name: 'Wie oft einlösbar?' })).toBeInTheDocument();
    expect(within(panel).getByRole('group', { name: 'Nur an bestimmten Tagen einlösbar?' })).toBeInTheDocument();
  });

  it('the event form\'s look: its inputs, labels, hints and chips — no divider lines', () => {
    embed();
    const panel = screen.getByRole('group', { name: 'Deal zum Event' });
    expect(within(panel).getByLabelText(/^Name auf der Karte/)).toHaveClass('cd-event-input');
    expect(within(panel).getByLabelText(/^Name auf der Karte/)).not.toHaveClass('ge-input');
    expect(panel.querySelector('label')).toHaveClass('cd-event-deal-label');
    expect(panel.querySelector('.cd-event-recurring-hint')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Einmal pro Person' })).toHaveClass('cd-event-deal-chip', 'active');
    expect(panel.querySelector('.ge-divider')).toBeNull();
    expect(panel.querySelector('[class*="ge-"]')).toBeNull();
  });

  it('nothing is natively required: the host form decides — and hears what is missing right away', () => {
    const { last, onSubmit } = embed();
    for (const label of [/^Name auf der Karte/, /^Angebot/, /^Sichtbar bis/]) {
      expect(screen.getByLabelText(label)).not.toBeRequired();
    }
    expect(last().missing).toEqual(['deal_label', 'visible_until']);    // the name is prefilled
    expect(last().uploading).toBe(false);
    // the event's own submit is not stopped by the browser
    fireEvent.submit(screen.getByRole('form', { name: 'Event' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('every change is reported: what is still missing, and the payload the server takes', () => {
    const { last } = embed();
    type(/^Angebot/, ' 1 Punsch gratis ');
    expect(last().missing).toEqual(['visible_until']);
    type(/^Sichtbar bis/, day(10));
    expect(last().missing).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '1× pro Woche' }));
    fireEvent.click(screen.getByRole('button', { name: 'Do' }));
    expect(last().payload).toEqual({
      name: 'Bar Neun', deal_label: '1 Punsch gratis', description: null, address: null, booking_url: null,
      photos: [], visible_until: day(10), max_redemptions: '100', redeem_interval: 'weekly', redeem_days: [4],
    });
    type(/^Name auf der Karte/, '  ');
    expect(last().missing).toEqual(['name']);
  });

  it('„Sichtbar bis“ starts today and comes prefilled with the event\'s date', () => {
    const { last } = embed({ defaults: { name: 'Bar Neun', visible_until: day(3) } });
    const until = screen.getByLabelText(/^Sichtbar bis/);
    expect(until).toHaveValue(day(3));
    expect(until).toHaveAttribute('min', day(0));       // an event today may carry a deal through today
    expect(until).toHaveAttribute('max', day(180));
    expect(last().missing).toEqual(['deal_label']);
    expect(last().payload.visible_until).toBe(day(3));
  });

  it('an existing deal is edited in the panel: its fields prefilled, an untouched address left out', () => {
    const { last } = embed({ deal: deal({ visible_until: `${day(20)}T22:59:59.000Z` }) });
    expect(screen.getByLabelText(/^Angebot/)).toHaveValue('1 Getränk gratis');
    expect(last().missing).toEqual([]);
    expect(last().payload.address).toBeUndefined();
    expect(last().payload.visible_until).toBe(day(20));
  });

  it('a photo on its way is reported, so the host can wait for it', async () => {
    let finish;
    upload.image.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { last } = embed();
    const file = new File(['x'], 'p.png', { type: 'image/png' });
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
    await waitFor(() => expect(last().uploading).toBe(true));
    finish({ data: { url: PHOTO } });
    await waitFor(() => expect(last().uploading).toBe(false));
    expect(last().payload.photos).toEqual([PHOTO]);
  });
});

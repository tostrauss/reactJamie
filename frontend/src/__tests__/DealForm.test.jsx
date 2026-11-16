import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// DealForm — the deal form out of AdminDealsSection (P4 v2, Tina/Tobi
// 16.11.2026): the admin keeps exactly its Kooperationen form; the form checks
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

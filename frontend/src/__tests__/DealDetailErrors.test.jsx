import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// The deal page is where an event's deal row leads (P4 v1, 16.11.2026). A
// deal taken down meanwhile (404) or sold out while the page was open (410)
// used to end in a silent jump back or the generic „Einlösen fehlgeschlagen.
// Bitte erneut versuchen.“ — a retry that can never work. Real German i18n.
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../utils/api', () => ({
  deals: {
    getOne: vi.fn(),
    getRedemptionStatus: vi.fn(),
    redeem: vi.fn(),
  },
}));
const { deals } = await import('../utils/api');
const { DealDetail } = await import('../pages/DealDetail');

const DEAL = {
  id: 12, name: 'Café Soleá', category: 'Lokal', deal_label: '1 Getränk gratis',
  description: null, address: null, lat: null, lng: null, photos: [], booking_url: null,
};
const STATUS = { redeemed: false, count: 0, max: 1, redeem_interval: 'once', redeem_days: null, redeemable_today: true };

const renderPage = () => render(
  <AuthContext.Provider value={{ user: { id: 1, is_admin: false } }}>
    <MemoryRouter initialEntries={['/group/42', '/deal/12']} initialIndex={1}>
      <Routes>
        <Route path="/group/:id" element={<div>Event-Seite</div>} />
        <Route path="/deal/:id" element={<DealDetail />} />
      </Routes>
    </MemoryRouter>
  </AuthContext.Provider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  deals.getOne.mockResolvedValue({ data: DEAL });
  deals.getRedemptionStatus.mockResolvedValue({ data: STATUS });
});

const confirmRedeem = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Jetzt einlösen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));
};

describe('DealDetail — a deal that is gone says so', () => {
  it('404 on opening: „nicht mehr verfügbar“, then back to where the tap came from', async () => {
    deals.getOne.mockRejectedValue({ response: { status: 404, data: { error: 'Deal not found' } } });
    renderPage();
    expect(await screen.findByText('Event-Seite')).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith('Dieser Deal ist nicht mehr verfügbar.');
  });

  it('any other load failure goes back as before, without claiming the deal is gone', async () => {
    deals.getOne.mockRejectedValue({ response: { status: 500, data: { error: 'Internal server error' } } });
    renderPage();
    expect(await screen.findByText('Event-Seite')).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('410 on redeeming: „ausverkauft“, the dialog closes and the button says „Ausverkauft“', async () => {
    deals.redeem.mockRejectedValue({ response: { status: 410, data: { code: 'DEAL_SOLD_OUT' } } });
    renderPage();
    await confirmRedeem();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Dieser Deal ist leider schon ausverkauft.'));
    expect(toast.error).not.toHaveBeenCalledWith('Einlösen fehlgeschlagen. Bitte erneut versuchen.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ausverkauft' })).toBeDisabled();
  });

  it('404 on redeeming: „nicht mehr verfügbar“ instead of „bitte erneut versuchen“ — and the button says so', async () => {
    deals.redeem.mockRejectedValue({ response: { status: 404, data: { error: 'Deal not found' } } });
    renderPage();
    await confirmRedeem();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Dieser Deal ist nicht mehr verfügbar.'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // review 16.11.2026: it stayed coral and led to the same error on every tap
    expect(screen.getByRole('button', { name: 'Nicht mehr verfügbar' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Jetzt einlösen' })).not.toBeInTheDocument();
  });

  it('any other redeem failure keeps the generic retry message', async () => {
    deals.redeem.mockRejectedValue({ response: { status: 500, data: {} } });
    renderPage();
    await confirmRedeem();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Einlösen fehlgeschlagen. Bitte erneut versuchen.'));
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
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

// Review 16.11.2026: the route is not keyed (App.jsx) and a push tap
// navigates from one deal to the next while the page stays mounted — what
// the page had learnt about deal 7 must not stick to deal 9.
describe('DealDetail — the next deal starts fresh', () => {
  // A push tap: navigate() to another deal, the page stays where it is.
  const PushTap = () => {
    const navigate = useNavigate();
    return <button type="button" onClick={() => navigate('/deal/9')}>Push-Tap</button>;
  };
  const renderAt7 = () => render(
    <AuthContext.Provider value={{ user: { id: 1, is_admin: false } }}>
      <MemoryRouter initialEntries={['/deal/7']}>
        <PushTap />
        <Routes>
          <Route path="/deal/:id" element={<DealDetail />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  beforeEach(() => {
    deals.getOne.mockImplementation(async (id) => ({ data: { ...DEAL, id: Number(id), name: `Deal ${id}` } }));
  });

  it('a 404 on deal 7 does not grey out deal 9', async () => {
    deals.redeem.mockRejectedValueOnce({ response: { status: 404, data: { error: 'Deal not found' } } });
    renderAt7();
    expect(await screen.findByText('Deal 7')).toBeInTheDocument();
    await confirmRedeem();
    expect(await screen.findByRole('button', { name: 'Nicht mehr verfügbar' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Push-Tap' }));
    expect(await screen.findByText('Deal 9')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Jetzt einlösen' })).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Nicht mehr verfügbar' })).not.toBeInTheDocument();
    expect(deals.getOne).toHaveBeenLastCalledWith('9');
  });

  it('a redeem of deal 7 still on its way does not mark deal 9 as redeemed', async () => {
    let answer;
    deals.redeem.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    renderAt7();
    expect(await screen.findByText('Deal 7')).toBeInTheDocument();
    await confirmRedeem();
    fireEvent.click(screen.getByRole('button', { name: 'Push-Tap' }));
    expect(await screen.findByText('Deal 9')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Jetzt einlösen' })).toBeEnabled());
    await act(async () => { answer({ data: { redeemed: true, count: 1, max: 1, redeemed_at: '2026-11-16T18:00:00.000Z' } }); });
    expect(screen.getByRole('button', { name: 'Jetzt einlösen' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Bereits eingelöst' })).not.toBeInTheDocument();
    expect(screen.getByText('0/1 mal eingelöst')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deals.redeem).toHaveBeenCalledTimes(1);
    expect(deals.redeem).toHaveBeenCalledWith('7');
    // …and says nothing over deal 9: the toast context is global, „Erfolgreich
    // eingelöst!“ for deal 7 used to pop up on the next deal's page.
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  // The same for every way a redeem can fail: the answer for deal 7 arrives
  // when deal 9 is on screen — no error toast there, and deal 9 is neither
  // „nicht mehr verfügbar“ nor sold out.
  it.each([
    ['410 sold out', { status: 410, data: { code: 'DEAL_SOLD_OUT' } }],
    ['404 gone', { status: 404, data: { error: 'Deal not found' } }],
    ['422 wrong day', { status: 422, data: { code: 'WRONG_DAY', redeem_days: [4] } }],
    ['500', { status: 500, data: { error: 'Internal server error' } }],
    ['no answer at all (network)', undefined],
  ])('a failed redeem of deal 7 (%s) that answers after the switch shows no toast over deal 9', async (_name, response) => {
    let fail;
    deals.redeem.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    renderAt7();
    expect(await screen.findByText('Deal 7')).toBeInTheDocument();
    await confirmRedeem();
    fireEvent.click(screen.getByRole('button', { name: 'Push-Tap' }));
    expect(await screen.findByText('Deal 9')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Jetzt einlösen' })).toBeEnabled());
    const statusCalls = deals.getRedemptionStatus.mock.calls.length;

    await act(async () => { fail(response ? { response } : new Error('Network Error')); });

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Jetzt einlösen' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Nicht mehr verfügbar' })).not.toBeInTheDocument();
    // the „wrong day“ branch refreshes the status of ITS deal — not from a page that is gone
    expect(deals.getRedemptionStatus.mock.calls.length).toBe(statusCalls);
  });

  // The guard must not swallow what belongs to the page that is still open.
  it('on the page that is still open the redeem answers as always: toast and „Bereits eingelöst“', async () => {
    deals.redeem.mockResolvedValue({ data: { redeemed: true, count: 1, max: 1, redeemed_at: '2026-11-16T18:00:00.000Z' } });
    renderAt7();
    expect(await screen.findByText('Deal 7')).toBeInTheDocument();
    await confirmRedeem();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Erfolgreich eingelöst! ✅'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

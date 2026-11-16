import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// The event page (GroupDetail) had no test at all. These pin what changed on
// 16.11.2026: „Kalender" leaves once the event's day is over (S3 — on a past
// event it was the pill that pushed the row past the screen), the partner
// head card (P2), and who gets „Anfragen ansehen": a private event's creator
// now does, a club's co-manager on a member's event no longer gets a button
// that only 403'd. Real German i18n.
const state = vi.hoisted(() => ({ group: null }));

vi.mock('../utils/platform', () => ({ proUpsellAllowed: () => false }));
vi.mock('../utils/paymentsConfig', () => ({ usePaymentsConfig: () => {} }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('../utils/api', () => ({
  groups: {
    getById: vi.fn(() => Promise.resolve({ data: state.group })),
    getMembers: vi.fn(() => Promise.resolve({ data: { members: [], total_count: 0, gated: false } })),
    getFavorites: vi.fn(() => Promise.resolve({ data: [] })),
  },
  clubs: {},
  reviews: { getForGroup: vi.fn(() => Promise.reject(new Error('404'))) },
}));

const { GroupDetail } = await import('../pages/GroupDetail');

const DAY = 24 * 60 * 60 * 1000;
// A wall-clock evening N days away, in the app's UTC-tagged format.
const dayAt19 = (offsetDays) => `${new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10)}T19:00:00.000Z`;

const ME = { id: 1, name: 'Tina', avatar_url: '/a.webp' };

const clubEvent = (over = {}) => ({
  id: 42, type: 'event', name: 'Spieleabend', category: 'Brettspiele', parent_club_id: 7,
  owner_id: ME.id, members_count: 5, max_members: 20, date: dayAt19(3),
  is_member: true, is_manager: true, joins_by_request: false, pending_request_count: 0,
  ...over,
});

const renderPage = async (group) => {
  state.group = group;
  render(
    <AuthContext.Provider value={{ user: ME, isPro: false }}>
      <MemoryRouter initialEntries={[`/group/${group.id}`]}>
        <Routes>
          <Route path="/group/:id" element={<GroupDetail />} />
          <Route path="/group/:id/requests" element={<div>Anfragen-Seite</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});
  await screen.findByRole('heading', { level: 2 });
};

describe('GroupDetail — „Kalender" only while the event is still ahead (S3)', () => {
  it('a member sees „Kalender" for an upcoming event', async () => {
    await renderPage(clubEvent({ owner_id: 99, is_manager: false }));
    expect(screen.getByRole('button', { name: /Kalender/ })).toBeInTheDocument();
  });

  it('gone the day after — only „Event teilen" stays', async () => {
    await renderPage(clubEvent({ owner_id: 99, is_manager: false, date: dayAt19(-2) }));
    expect(screen.queryByRole('button', { name: /Kalender/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Event teilen/ })).toBeInTheDocument();
  });

  it('a weekly group keeps it — its next occurrence is ahead', async () => {
    await renderPage(clubEvent({
      type: 'group', parent_club_id: null, owner_id: 99, is_manager: false,
      is_recurring_weekly: true, date: dayAt19(-15),
    }));
    expect(screen.getByRole('button', { name: /Kalender/ })).toBeInTheDocument();
  });
});

describe('GroupDetail — partner event (P2)', () => {
  it('frames the head card in the partner yellow and shows „☆ Partner" next to the category', async () => {
    await renderPage(clubEvent({ owner_id: 99, is_manager: false, is_partner: true }));
    expect(document.querySelector('.gd-content-card')).toHaveClass('gd-content-card--partner');
    expect(screen.getByText('Brettspiele')).toBeInTheDocument();
    expect(screen.getByText('Partner')).toBeInTheDocument();
  });

  it('a plain event keeps the default card', async () => {
    await renderPage(clubEvent({ owner_id: 99, is_manager: false }));
    expect(document.querySelector('.gd-content-card')).not.toHaveClass('gd-content-card--partner');
    expect(screen.queryByText('Partner')).not.toBeInTheDocument();
  });
});

describe('GroupDetail — „Anfragen ansehen" only for who may open the list', () => {
  it('the creator of a private event with waiting requests gets it (→ /group/:id/requests)', async () => {
    await renderPage(clubEvent({ joins_by_request: true, pending_request_count: 2 }));
    expect(screen.getByRole('button', { name: /Chat öffnen/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bearbeiten/ })).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Anfragen ansehen (2)' });
    expect(btn.parentElement).toHaveClass('gd-anfragen-row--wrap');
    fireEvent.click(btn);
    expect(await screen.findByText('Anfragen-Seite')).toBeInTheDocument();
  });

  it('…not at 0 requests, and not for a public event', async () => {
    await renderPage(clubEvent({ joins_by_request: true, pending_request_count: 0 }));
    expect(screen.queryByRole('button', { name: /Anfragen ansehen/ })).not.toBeInTheDocument();
  });

  it('a club co-manager on a member\'s private event gets no button that would 403', async () => {
    await renderPage(clubEvent({ owner_id: 99, is_manager: true, joins_by_request: true, pending_request_count: 3 }));
    expect(screen.getByRole('button', { name: /Chat öffnen/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Anfragen ansehen/ })).not.toBeInTheDocument();
  });

  it('a private group\'s owner keeps it', async () => {
    await renderPage(clubEvent({
      type: 'group', parent_club_id: null, is_private: true, joins_by_request: true, pending_request_count: 1,
    }));
    expect(screen.getByRole('button', { name: 'Anfragen ansehen (1)' })).toBeInTheDocument();
  });
});

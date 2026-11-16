import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// The event page (GroupDetail) had no test at all. These pin what changed on
// 16.11.2026: „Kalender" leaves once the event's day is over (S3 — on a past
// event it was the pill that pushed the row past the screen), the partner
// head card (P2), and who gets „Anfragen ansehen": a private event's creator
// now does, a club's co-manager on a member's event no longer gets a button
// that only 403'd. Real German i18n.
const state = vi.hoisted(() => ({ group: null }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));

vi.mock('../utils/platform', () => ({ proUpsellAllowed: () => false }));
vi.mock('../utils/paymentsConfig', () => ({ usePaymentsConfig: () => {} }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../utils/api', () => ({
  groups: {
    getById: vi.fn(() => Promise.resolve({ data: state.group })),
    getMembers: vi.fn(() => Promise.resolve({ data: { members: [], total_count: 0, gated: false } })),
    getFavorites: vi.fn(() => Promise.resolve({ data: [] })),
  },
  clubs: {},
  reviews: {
    getForGroup: vi.fn(() => Promise.reject(new Error('404'))),
    notHeld: vi.fn(() => Promise.resolve({ data: { success: true, not_held: true } })),
  },
}));

const { reviews } = await import('../utils/api');
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
          <Route path="/deal/:id" element={<div>Deal-Seite</div>} />
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

// The edge itself (review 16.11.2026): what has to be over is the event's
// VIENNA day — not its start time, not the UTC day. Only Date is faked, so
// the findBy* polling keeps its real timers.
describe('GroupDetail — „Kalender" on the event day itself', () => {
  const tonight = '2026-11-16T19:00:00.000Z';   // 19:00 Vienna wall-clock, UTC-tagged
  const at = (iso) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
  };
  afterEach(() => { vi.useRealTimers(); });

  it('still there late on the event day, hours after the start (23:30 Vienna)', async () => {
    at('2026-11-16T22:30:00Z');
    await renderPage(clubEvent({ owner_id: 99, is_manager: false, date: tonight }));
    expect(screen.getByRole('button', { name: /Kalender/ })).toBeInTheDocument();
  });

  it('gone after Vienna midnight, though the UTC day is still the 16th (00:30 Vienna)', async () => {
    at('2026-11-16T23:30:00Z');
    await renderPage(clubEvent({ owner_id: 99, is_manager: false, date: tonight }));
    expect(screen.queryByRole('button', { name: /Kalender/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Event teilen/ })).toBeInTheDocument();
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

// The deal an admin hung on the event (P4 v1, Tina 16.11.2026): in the head
// card between title and description, a tap opens the deal's redeem page.
describe('GroupDetail — the deal at the event (P4 v1)', () => {
  const DEAL = { id: 12, name: 'Café Soleá', deal_label: '1 Getränk gratis', photo: null, verified: true };

  it('sits between title and description and opens the deal page', async () => {
    await renderPage(clubEvent({ owner_id: 99, is_manager: false, description: 'Brettspiele bis Mitternacht', deal: DEAL }));
    const card = document.querySelector('.gd-content-card');
    const title = card.querySelector('.gd-group-title');
    const row = card.querySelector('.event-deal-row');
    const description = card.querySelector('.gd-description');
    expect(row).toBeTruthy();
    expect(title.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Geprüfter Partner' })).toBeInTheDocument();
    fireEvent.click(row);
    expect(await screen.findByText('Deal-Seite')).toBeInTheDocument();
  });

  it('no row while the server embeds none', async () => {
    await renderPage(clubEvent({ owner_id: 99, is_manager: false, deal: null }));
    expect(document.querySelector('.event-deal-row')).toBeNull();
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

// Decision 4 (Tina 16.11.2026): „Wer war dabei?“ — until now the only way to
// „Hat nicht stattgefunden“ — is asked only about meetups of at most 8
// people. The owner of a bigger past one gets a quiet pill on the event page
// instead; the server's not_held branch runs before its size gate.
describe('GroupDetail — „Hat nicht stattgefunden" for the owner of a big past meetup', () => {
  const NOT_HELD = 'Hat nicht stattgefunden';
  const STATE = '✓ Als „nicht stattgefunden“ gemeldet';
  const meetup = (over = {}) => clubEvent({
    type: 'group', name: 'Laufen', parent_club_id: null, is_manager: true,
    members_count: 9, date: dayAt19(-3), ...over,
  });
  let confirmSpy;
  beforeEach(() => {
    vi.clearAllMocks();
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => { confirmSpy.mockRestore(); });

  it('9 people: the pill, a confirm naming the meetup, the flag — then the page says so', async () => {
    await renderPage(meetup());
    fireEvent.click(screen.getByRole('button', { name: NOT_HELD }));
    expect(confirmSpy).toHaveBeenCalledWith(
      '„Laufen“ hat nicht stattgefunden? Dann verschwindet das Treffen für alle aus den Memories. Das lässt sich nicht rückgängig machen.',
    );
    await waitFor(() => expect(reviews.notHeld).toHaveBeenCalledWith(42));
    expect(await screen.findByText(STATE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: NOT_HELD })).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Danke – das Treffen ist jetzt als „nicht stattgefunden“ markiert.');
  });

  it('cancelling the confirm sends nothing', async () => {
    confirmSpy.mockReturnValue(false);
    await renderPage(meetup());
    fireEvent.click(screen.getByRole('button', { name: NOT_HELD }));
    expect(reviews.notHeld).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: NOT_HELD })).toBeInTheDocument();
  });

  it('a refusal keeps the pill and says why (the server\'s reason)', async () => {
    reviews.notHeld.mockRejectedValueOnce({ response: { status: 409, data: { error: 'Bereits bewertet' } } });
    await renderPage(meetup());
    fireEvent.click(screen.getByRole('button', { name: NOT_HELD }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Bereits bewertet'));
    expect(screen.getByRole('button', { name: NOT_HELD })).toBeInTheDocument();
    expect(screen.queryByText(STATE)).not.toBeInTheDocument();
  });

  it('8 people — „Wer war dabei?“ covers it — no pill', async () => {
    await renderPage(meetup({ members_count: 8 }));
    expect(screen.queryByRole('button', { name: NOT_HELD })).not.toBeInTheDocument();
  });

  it('never next to a review the server still offers (its modal has the same button)', async () => {
    reviews.getForGroup.mockResolvedValueOnce({ data: { group_id: 42, group_name: 'Laufen', members: [{ id: 5, name: 'Mia' }] } });
    await renderPage(meetup());
    expect(await screen.findByRole('button', { name: /Wer war dabei/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: NOT_HELD })).not.toBeInTheDocument();
  });

  it('only the owner, only a one-off meetup that is over', async () => {
    for (const over of [
      { owner_id: 99, is_manager: false },                    // a member
      { type: 'event', parent_club_id: 7 },                    // a club event
      { is_recurring_weekly: true },                           // a weekly series
      { date: dayAt19(0) },                                    // tonight
      { date: dayAt19(3) },                                    // ahead
    ]) {
      await renderPage(meetup(over));
      expect(screen.queryByRole('button', { name: NOT_HELD })).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('already flagged: the state, no pill', async () => {
    await renderPage(meetup({ did_not_take_place: true }));
    expect(screen.getByText(STATE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: NOT_HELD })).not.toBeInTheDocument();
  });
});

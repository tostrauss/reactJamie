import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// Where deals live in the edit page since Tina's document of 17.11.2026: a
// club's deal belongs to ONE event, so only the edit page of a club event
// carries the „Deal am Event“ section (EventDealEditor — it asks the server
// itself whether it is for this viewer). A club's own page has no deal
// section any more (the Pro library of 16.11.2026 is gone), and a meetup
// never had one. Real German i18n.
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));
vi.mock('../utils/platform', () => ({ proUpsellAllowed: () => true }));
vi.mock('../utils/googleMaps', () => ({
  loadGoogleMaps: vi.fn(), onGoogleMapsReady: vi.fn(), createPlacesAutocomplete: vi.fn(),
}));
// The section itself is tested in EventDealEditor.test.jsx; here only where
// it is mounted and with what.
vi.mock('../components/EventDealEditor', () => ({
  default: ({ clubId, eventId, eventDate }) => (
    <div data-testid="event-deal-editor" data-club={clubId} data-event={eventId} data-date={eventDate} />
  ),
}));
vi.mock('../utils/api', () => ({
  groups: { getById: vi.fn(), getMembers: vi.fn(async () => ({ data: { members: [], total_count: 1 } })), getFavorites: vi.fn(async () => ({ data: [] })) },
  clubs: { getFavorites: vi.fn(async () => ({ data: [] })) },
  upload: {},
  friends: { getAll: vi.fn(async () => ({ data: [] })) },
}));
const { groups } = await import('../utils/api');
const { GroupEdit } = await import('../pages/GroupEdit');

const renderEdit = async (group) => {
  vi.mocked(groups.getById).mockResolvedValueOnce({ data: { owner_id: 1, name: 'Bar Neun', location: 'Wien', members_count: 1, ...group } });
  const view = render(
    <AuthContext.Provider value={{ user: { id: 1, name: 'Olli' }, isPro: false }}>
      <MemoryRouter initialEntries={[`/group/${group.id}/edit`]}>
        <Routes><Route path="/group/:id/edit" element={<GroupEdit />} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});
  return view;
};
const CLUB = { id: 70, type: 'club', club_type: 'official', approval_status: 'approved', is_active: true, max_members: 50 };
const editor = () => screen.queryByTestId('event-deal-editor');

beforeEach(() => vi.clearAllMocks());

describe('GroupEdit — deals', () => {
  it('a club event gets the „Deal am Event“ section, for its club, its id and the date in the form', async () => {
    await renderEdit({ id: 90, type: 'event', parent_club_id: 70, is_partner: true, date: '2026-12-01T19:00:00.000Z', deal: null });
    await screen.findByText('Eventinfo');
    expect(editor()).toBeInTheDocument();
    expect(editor().dataset.club).toBe('70');
    expect(editor().dataset.event).toBe('90');
    expect(editor().dataset.date).toBe('2026-12-01');
  });

  // Not gated on is_partner any more: a club that does not pay (no ☆) puts a
  // deal on its first two events too. Who may is the server's answer.
  it('also the event of a club that is no paying partner — the section asks the server itself', async () => {
    await renderEdit({ id: 91, type: 'event', parent_club_id: 70, is_partner: false, date: '2026-12-01T19:00:00.000Z' });
    await screen.findByText('Eventinfo');
    expect(editor()).toBeInTheDocument();
  });

  it('a club\'s own page has no deal section any more — official, community, in review alike', async () => {
    for (const club of [
      CLUB,
      { ...CLUB, club_type: 'community' },
      { ...CLUB, club_type: null },
      { ...CLUB, approval_status: 'pending' },
    ]) {
      const { unmount } = await renderEdit(club);
      await screen.findByText('Clubinfo');
      expect(editor()).not.toBeInTheDocument();
      expect(screen.queryByText('Deals')).not.toBeInTheDocument();
      expect(screen.queryByText('Deal am Event')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('a plain meetup: no section', async () => {
    await renderEdit({ id: 92, type: 'group', max_members: 10 });
    await screen.findByText('Gruppeninfo');
    expect(editor()).not.toBeInTheDocument();
  });
});

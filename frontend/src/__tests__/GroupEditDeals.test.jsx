import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// Where the club's deals live in the edit page (P4 v2, Tina/Tobi 16.11.2026):
// the „Deals“ section only for a live OFFICIAL club, the „Deal am Event“
// picker only on an event the official club put up itself (is_partner) — a
// community, a club in review, a member's or a plain meetup gets neither and
// costs no request. Real German i18n.
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }) }));
vi.mock('../utils/platform', () => ({ proUpsellAllowed: () => true }));
vi.mock('../utils/googleMaps', () => ({
  loadGoogleMaps: vi.fn(), onGoogleMapsReady: vi.fn(), createPlacesAutocomplete: vi.fn(),
}));
vi.mock('../utils/api', () => ({
  groups: { getById: vi.fn(), getMembers: vi.fn(async () => ({ data: { members: [], total_count: 1 } })), getFavorites: vi.fn(async () => ({ data: [] })) },
  clubs: { getFavorites: vi.fn(async () => ({ data: [] })) },
  upload: {},
  friends: { getAll: vi.fn(async () => ({ data: [] })) },
  deals: { getForClub: vi.fn(async () => ({ data: [] })), setEventDeal: vi.fn() },
}));
const { groups, deals } = await import('../utils/api');
const { GroupEdit } = await import('../pages/GroupEdit');

const renderEdit = async (group) => {
  vi.mocked(groups.getById).mockResolvedValueOnce({ data: { owner_id: 1, name: 'Bar Neun', location: 'Wien', members_count: 1, ...group } });
  const view = render(
    <AuthContext.Provider value={{ user: { id: 1, name: 'Olli' }, isPro: true }}>
      <MemoryRouter initialEntries={[`/group/${group.id}/edit`]}>
        <Routes><Route path="/group/:id/edit" element={<GroupEdit />} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});
  return view;
};
const CLUB = { id: 70, type: 'club', club_type: 'official', approval_status: 'approved', is_active: true, max_members: 50 };

beforeEach(() => vi.clearAllMocks());

describe('GroupEdit — deals', () => {
  it('a live official club gets the „Deals“ section with its deals', async () => {
    await renderEdit(CLUB);
    expect(await screen.findByText('Deals')).toBeInTheDocument();
    await waitFor(() => expect(deals.getForClub).toHaveBeenCalledWith(70));
    expect(screen.queryByText('Deal am Event')).not.toBeInTheDocument();
  });

  it('a community, an official club in review or a closed one: no section, no request', async () => {
    for (const club of [
      { ...CLUB, club_type: 'community' },
      { ...CLUB, club_type: null },
      { ...CLUB, approval_status: 'pending' },
      { ...CLUB, is_active: false },
    ]) {
      const { unmount } = await renderEdit(club);
      await screen.findByText('Clubinfo');
      expect(screen.queryByText('Deals')).not.toBeInTheDocument();
      unmount();
    }
    expect(deals.getForClub).not.toHaveBeenCalled();
  });

  it('an event the official club put up itself (☆ Partner) gets „Deal am Event“ for its club', async () => {
    await renderEdit({ id: 90, type: 'event', parent_club_id: 70, is_partner: true, date: '2026-12-01T19:00:00.000Z', deal: null });
    await waitFor(() => expect(deals.getForClub).toHaveBeenCalledWith(70));
    expect(await screen.findByText('Deal am Event')).toBeInTheDocument();
  });

  it('a member\'s event, a community event or a meetup: no picker, no request', async () => {
    const { unmount } = await renderEdit({ id: 91, type: 'event', parent_club_id: 70, is_partner: false, date: '2026-12-01T19:00:00.000Z' });
    await screen.findByText('Eventinfo');
    unmount();
    await renderEdit({ id: 92, type: 'group', max_members: 10 });
    await screen.findByText('Gruppeninfo');
    expect(deals.getForClub).not.toHaveBeenCalled();
    expect(screen.queryByText('Deal am Event')).not.toBeInTheDocument();
  });
});

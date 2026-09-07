import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { GroupRequests } from '../pages/GroupRequests';

// Mock the API — the overview reads groups.getRequests and acts via
// groups.handleRequest. No real network in tests.
vi.mock('../utils/api', () => ({
  groups: {
    getRequests: vi.fn(),
    handleRequest: vi.fn().mockResolvedValue({ data: {} }),
    acceptAllRequests: vi.fn().mockResolvedValue({ data: { acceptedIds: [11, 12], skippedNoAvatar: 0, skippedFull: 0 } }),
  },
}));

// Toast is a no-op in tests (showUndo swallows the undo callback).
vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), showUndo: vi.fn() }),
}));

import { groups } from '../utils/api';

const REQUESTS = [
  { id: 11, user_id: 2, user_name: 'Anna', user_avatar: null, user_trusted: true, user_age: 24, message: 'Bin dabei!', user_interests: '["Yoga"]', created_at: '2026-09-06T10:00:00Z' },
  { id: 12, user_id: 3, user_name: 'Ben', user_avatar: null, user_trusted: false, user_age: 29, message: 'Hallo', user_interests: '[]', created_at: '2026-09-05T10:00:00Z' },
];

const renderPage = ({ isPro = false, isAdmin = false } = {}) =>
  render(
    <AuthContext.Provider value={{ user: { id: 1, is_admin: isAdmin }, isPro }}>
      <MemoryRouter initialEntries={['/group/1/requests']}>
        <Routes>
          <Route path="/group/:id/requests" element={<GroupRequests />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );

describe('GroupRequests — review-all overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    groups.getRequests.mockResolvedValue({ data: REQUESTS });
    groups.handleRequest.mockResolvedValue({ data: {} });
    groups.acceptAllRequests.mockResolvedValue({ data: { acceptedIds: [11, 12], skippedNoAvatar: 0, skippedFull: 0 } });
  });

  it('lists every pending request at once (free overview, not a one-at-a-time deck)', async () => {
    renderPage();
    // BOTH applicants are visible simultaneously — the whole point of the
    // review-all list vs. the swipe deck.
    expect(await screen.findByText(/Anna, 24/)).toBeInTheDocument();
    expect(screen.getByText(/Ben, 29/)).toBeInTheDocument();
  });

  it('accepts a single request without Pro (per-request action is free)', async () => {
    renderPage();
    await screen.findByText(/Anna, 24/);
    // Anna's accept button (aria-label "Annehmen") — first in DOM order (newest).
    const acceptButtons = screen.getAllByLabelText('Annehmen');
    fireEvent.click(acceptButtons[0]);
    await waitFor(() => expect(groups.handleRequest).toHaveBeenCalledWith('1', 11, 'accept'));
    // Row disappears after acceptance.
    await waitFor(() => expect(screen.queryByText(/Anna, 24/)).not.toBeInTheDocument());
  });

  it('routes "Alle annehmen" to the Pro upsell for a non-Pro owner (no bulk accept)', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    renderPage({ isPro: false });
    await screen.findByText(/Anna, 24/);
    fireEvent.click(screen.getByRole('button', { name: /Alle annehmen/i }));
    // Opens the Pro modal keyed to the requests feature — does NOT bulk-accept.
    expect(dispatchSpy.mock.calls.some(
      c => c[0]?.type === 'jamie:open-pro-modal' && c[0]?.detail?.feature === 'reviewRequests'
    )).toBe(true);
    expect(groups.acceptAllRequests).not.toHaveBeenCalled();
    dispatchSpy.mockRestore();
  });

  it('lets a Pro owner bulk-accept the visible set in one call after a confirm tap', async () => {
    renderPage({ isPro: true });
    await screen.findByText(/Anna, 24/);
    const bulkBtn = screen.getByRole('button', { name: /Alle annehmen/i });
    fireEvent.click(bulkBtn); // first tap → arm the confirm
    fireEvent.click(bulkBtn); // second tap → execute
    // Single round trip with the visible ids (newest-first: Anna=11, Ben=12).
    await waitFor(() => expect(groups.acceptAllRequests).toHaveBeenCalledWith('1', [11, 12]));
    // Accepted rows drop out of the list.
    await waitFor(() => expect(screen.queryByText(/Anna, 24/)).not.toBeInTheDocument());
  });
});

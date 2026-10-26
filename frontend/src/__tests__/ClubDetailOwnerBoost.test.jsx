import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// Pro-Rückbau (Tina 22.10., Tobi 26.10.2026): the club page no longer carries
// the "Mehr Reichweite mit JAMIE Pro" info card for non-Pro owners. Every
// owner gets the Boost button instead (the BoostModal explains Pro in
// context) — except where Pro may not be advertised at all (iOS without a
// purchase path, Apple 3.1.1). Real German i18n.
const upsell = { allowed: true };
vi.mock('../utils/platform', () => ({ proUpsellAllowed: () => upsell.allowed }));
vi.mock('../utils/paymentsConfig', () => ({ usePaymentsConfig: () => {} }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('../utils/api', () => ({
  clubs: {
    getById: vi.fn(() => Promise.resolve({ data: {
      id: 7, name: 'Laufclub Prater', owner_id: 1, type: 'club', is_member: true,
      members_count: 2, description: 'Wir laufen.', category: 'Sport',
    } })),
    getMembers: vi.fn(() => Promise.resolve({ data: { members: [], total_count: 2, gated: false } })),
    getFavorites: vi.fn(() => Promise.resolve({ data: [] })),
    getEvents: vi.fn(() => Promise.resolve({ data: [] })),
  },
}));

const { ClubDetail } = await import('../pages/ClubDetail');

const renderAsOwner = async ({ isPro }) => {
  render(
    <AuthContext.Provider value={{ user: { id: 1, name: 'Olga', avatar_url: '/a.webp' }, isPro }}>
      <MemoryRouter initialEntries={['/club/7']}>
        <Routes><Route path="/club/:id" element={<ClubDetail />} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});
};

describe('ClubDetail — owner actions after the Pro rollback', () => {
  beforeEach(() => { upsell.allowed = true; });

  it('a non-Pro owner gets the Boost button and no Pro info card', async () => {
    await renderAsOwner({ isPro: false });
    expect(await screen.findByRole('button', { name: /Club boosten/ })).toBeTruthy();
    expect(document.querySelector('.cd-pro-info')).toBeNull();
    expect(screen.queryByText(/Mehr Reichweite mit JAMIE Pro/)).toBeNull();
  });

  it('where Pro may not be advertised (iOS without a purchase path) a non-Pro owner sees no Boost button', async () => {
    upsell.allowed = false;
    await renderAsOwner({ isPro: false });
    await screen.findByRole('button', { name: /Club löschen/ });
    expect(screen.queryByRole('button', { name: /Club boosten/ })).toBeNull();
  });

  it('a Pro owner keeps the Boost button everywhere', async () => {
    upsell.allowed = false;
    await renderAsOwner({ isPro: true });
    expect(await screen.findByRole('button', { name: /Club boosten/ })).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { AuthContext } from '../context/AuthContext';

// „Club boosten ganz weggeben. Allgemein die gelben Balken weg!“ (Tina
// 17.11.2026, with a screenshot of the gold „🚀 Club boosten“ button on the
// club page — the „grelle gelbe Badge mit Pro“ of her first document). Until
// then every owner had that button (Pro rollback, 26.10.2026); now no owner
// has it, with or without Pro, and nothing gold is left in the club page's
// stylesheet. Real German i18n.
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

describe('ClubDetail — „Club boosten“ is gone for every owner', () => {
  beforeEach(() => { upsell.allowed = true; });

  it.each([
    ['a non-Pro owner', { isPro: false, allowed: true }],
    ['a Pro owner', { isPro: true, allowed: true }],
    ['a non-Pro owner where Pro may not be advertised (iOS without a purchase path)', { isPro: false, allowed: false }],
    ['a Pro owner on iOS', { isPro: true, allowed: false }],
  ])('%s: no boost button, no Pro card — „Club löschen“ and „Club melden“ as before', async (_who, { isPro, allowed }) => {
    upsell.allowed = allowed;
    await renderAsOwner({ isPro });
    expect(await screen.findByRole('button', { name: 'Club löschen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Club melden' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /boost/i })).toBeNull();
    expect(screen.queryByText(/Club boosten/)).toBeNull();
    expect(document.querySelector('.cd-boost-btn')).toBeNull();
    expect(document.querySelector('.cd-pro-info')).toBeNull();
    expect(screen.queryByText(/Mehr Reichweite mit JAMIE Pro/)).toBeNull();
  });
});

describe('the club page\'s stylesheet — „Allgemein die gelben Balken weg!“', () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), 'src/styles/club-detail.css'), 'utf8');

  it('carries no gold any more: neither the boost button\'s nor the locked members row\'s', () => {
    expect(css).not.toMatch(/#FFD700/i);
    expect(css).not.toMatch(/#FFAA00/i);
    expect(css).not.toMatch(/255,\s*215,\s*0/);
    expect(css).not.toContain('.cd-boost-btn');
  });

  it('the locked members row is coral — border, tint and its call to action', () => {
    const gated = css.match(/\.cd-members-gated\s*\{[^}]*\}/)[0];
    expect(gated).toContain('background: rgba(253, 118, 102, 0.08)');
    expect(gated).toContain('border: 1px solid rgba(253, 118, 102, 0.25)');
    expect(css).toMatch(/\.cd-members-gated-cta\s*\{[^}]*color:\s*var\(--accent-coral\)/);
  });
});

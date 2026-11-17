import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { AuthContext } from '../context/AuthContext';

// Tina 17.11.2026, on her screenshots of the club page: „Hier sollte ‚Events‘
// der ganze Abschnitt über ‚zum Chat‘ und ‚Club teilen‘ sein.“ The events
// section stands directly under the description, the actions follow it — for
// every viewer. Real German i18n.
const world = { member: true, eventsStatus: 200 };
vi.mock('../utils/platform', () => ({ proUpsellAllowed: () => true }));
vi.mock('../utils/paymentsConfig', () => ({ usePaymentsConfig: () => {} }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('../utils/api', () => ({
  clubs: {
    getById: vi.fn(() => Promise.resolve({ data: {
      id: 7, name: 'Laufclub Prater', owner_id: 99, type: 'club', is_member: world.member,
      members_count: 12, description: 'Wir laufen.', category: 'Sport', is_private: false,
    } })),
    getMembers: vi.fn(() => Promise.resolve({ data: { members: [], total_count: 12, gated: false } })),
    getFavorites: vi.fn(() => Promise.resolve({ data: [] })),
    getEvents: vi.fn(() => (world.eventsStatus === 200
      ? Promise.resolve({ data: [] })
      : Promise.reject({ response: { status: world.eventsStatus, data: { code: 'NOT_MEMBER' } } }))),
  },
}));

const { ClubDetail } = await import('../pages/ClubDetail');

const renderClub = async () => {
  render(
    <AuthContext.Provider value={{ user: { id: 1, name: 'Mia', avatar_url: '/a.webp' }, isPro: false }}>
      <MemoryRouter initialEntries={['/club/7']}>
        <Routes><Route path="/club/:id" element={<ClubDetail />} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});
};

// a comes before b in the document
const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('ClubDetail — „Events“ stands above „Zum Chat“ and „Club teilen“', () => {
  beforeEach(() => { world.member = true; world.eventsStatus = 200; });

  it('a member: description → events → Zum Chat → Club teilen → Club melden', async () => {
    await renderClub();
    const chat = await screen.findByRole('button', { name: /Zum Chat/ });
    const share = screen.getByRole('button', { name: /Club teilen/ });
    const description = screen.getByText('Wir laufen.');
    const events = document.querySelector('.cd-events');
    const actions = document.querySelector('.cd-actions');
    expect(events).toBeTruthy();
    expect(before(description, events)).toBe(true);
    expect(before(events, actions)).toBe(true);
    expect(actions.contains(chat)).toBe(true);
    expect(actions.contains(share)).toBe(true);
    expect(before(chat, share)).toBe(true);
    expect(before(actions, screen.getByRole('button', { name: 'Club melden' }))).toBe(true);
    // the section is the one with the heading and the empty state
    expect(events.textContent).toContain('Events');
    expect(events.textContent).toContain('Noch keine Events geplant');
  });

  it('a non-member: the locked events box stands above „Club beitreten“ — literally as Tina wrote it', async () => {
    world.member = false;
    world.eventsStatus = 403;
    await renderClub();
    const join = await screen.findByRole('button', { name: 'Club beitreten' });
    const events = document.querySelector('.cd-events');
    const actions = document.querySelector('.cd-actions');
    expect(events.textContent).toContain('Events sind nur für Clubmitglieder sichtbar');
    expect(before(events, actions)).toBe(true);
    expect(actions.contains(join)).toBe(true);
    expect(actions.contains(screen.getByRole('button', { name: /Club teilen/ }))).toBe(true);
    expect(screen.queryByRole('button', { name: /Zum Chat/ })).toBeNull();
  });

  it('the section brings no margin of its own: the page\'s gap sets the distance to both neighbours', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/styles/club-detail.css'), 'utf8');
    const rule = css.match(/\n\.cd-events\s*\{[^}]*\}/)[0];
    expect(rule).toMatch(/margin-top:\s*0;/);
  });
});

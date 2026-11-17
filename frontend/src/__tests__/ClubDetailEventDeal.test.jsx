import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import { AuthContext } from '../context/AuthContext';

// Tina 16.11.2026 about the deal at an event: „Er wird auch nochmal bei den
// Clubs unter dem Event angezeigt.“ On the club page the event's deal sits
// under its card — the event page's own row, a sibling of the card: a tap
// opens the deal's page, not the event. (An interim layout; Tina's design for
// this page follows.) Real German i18n.
const world = { events: [] };
vi.mock('../utils/platform', () => ({ proUpsellAllowed: () => true }));
vi.mock('../utils/paymentsConfig', () => ({ usePaymentsConfig: () => {} }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('../utils/api', () => ({
  clubs: {
    getById: vi.fn(() => Promise.resolve({ data: {
      id: 7, name: 'Café Soleá', owner_id: 99, type: 'club', is_member: true, members_count: 12, category: 'Bar',
    } })),
    getMembers: vi.fn(() => Promise.resolve({ data: { members: [], total_count: 12, gated: false } })),
    getFavorites: vi.fn(() => Promise.resolve({ data: [] })),
    getEvents: vi.fn(() => Promise.resolve({ data: world.events })),
  },
}));

const { ClubDetail } = await import('../pages/ClubDetail');

const Where = () => <div data-testid="where">{useLocation().pathname}</div>;
const renderClub = async () => {
  render(
    <AuthContext.Provider value={{ user: { id: 1, name: 'Mia', avatar_url: '/a.webp' }, isPro: false }}>
      <MemoryRouter initialEntries={['/club/7']}>
        <Routes>
          <Route path="/club/:id" element={<ClubDetail />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});
};

const event = (over = {}) => ({
  id: 90, name: 'Punsch Night @ Solea', date: '2030-11-20T19:00:00.000Z', location: 'Kaiserstraße 60',
  members_count: 8, max_members: 20, owner_id: 99, is_member: false, deal: null, ...over,
});
const DEAL = { id: 3, name: 'Café Soleá', deal_label: '1 Punsch gratis für JAMIE-Gruppen', photo: null, verified: true };

describe('ClubDetail — the event\'s deal under its card', () => {
  beforeEach(() => { world.events = []; });

  it('the deal row follows its event\'s card directly, in one item — name, offer, ✓', async () => {
    world.events = [event({ deal: DEAL }), event({ id: 91, name: 'Quiz-Abend' })];
    await renderClub();
    await screen.findByText('Punsch Night @ Solea');
    const items = document.querySelectorAll('.cd-events-list > .cd-event-item');
    expect(items).toHaveLength(2);
    const [withDeal, without] = items;
    const card = withDeal.querySelector(':scope > .cd-event-card');
    const row = withDeal.querySelector(':scope > .event-deal-row');
    expect(card).toBeTruthy();
    expect(card.nextElementSibling).toBe(row);          // directly under the card…
    expect(card.contains(row)).toBe(false);             // …not inside its click target
    expect(row.textContent).toContain('Café Soleá');
    expect(row.textContent).toContain('1 Punsch gratis für JAMIE-Gruppen');
    expect(row.querySelector('[role="img"]').getAttribute('aria-label')).toBe('Geprüfter Partner');
    // an event without a deal: its card alone
    expect(without.querySelector('.cd-event-card')).toBeTruthy();
    expect(without.querySelector('.event-deal-row')).toBeNull();
    expect(document.querySelectorAll('.event-deal-row')).toHaveLength(1);
  });

  it('a deal of a club that does not pay shows the same row without the ✓', async () => {
    world.events = [event({ deal: { ...DEAL, verified: false } })];
    await renderClub();
    await screen.findByText('Punsch Night @ Solea');
    const row = document.querySelector('.event-deal-row');
    expect(row.textContent).toContain('1 Punsch gratis für JAMIE-Gruppen');
    expect(row.querySelector('[role="img"]')).toBeNull();
  });

  it('a tap on the deal opens the deal, not the event', async () => {
    world.events = [event({ deal: DEAL })];
    await renderClub();
    await screen.findByText('Punsch Night @ Solea');
    await act(async () => { fireEvent.click(document.querySelector('.event-deal-row')); });
    expect(screen.getByTestId('where').textContent).toBe('/deal/3');
  });

  it('a tap on the card still opens the event', async () => {
    world.events = [event({ deal: DEAL })];
    await renderClub();
    await act(async () => { fireEvent.click(await screen.findByText('Punsch Night @ Solea')); });
    expect(screen.getByTestId('where').textContent).toBe('/group/90');
  });

  it('no events: no item, no row', async () => {
    await renderClub();
    await screen.findByText('Noch keine Events geplant');
    expect(document.querySelector('.cd-event-item')).toBeNull();
    expect(document.querySelector('.event-deal-row')).toBeNull();
  });
});

describe('the event card\'s stylesheet', () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), 'src/styles/club-detail.css'), 'utf8');

  it('the deal row loses its own margin under the card and is set in — a long deal name cannot widen the page', () => {
    expect(css).toMatch(/\.cd-event-item\s*\{[^}]*flex-direction:\s*column;[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.cd-event-item > \.event-deal-row\s*\{[^}]*margin:\s*0 0 0 12px;[^}]*width:\s*calc\(100% - 12px\);/);
  });

  // The button on the right gets longer labels („Anfrage ausstehend…“): it
  // wraps to two lines instead of squeezing the name to „W…“, and the name
  // itself may take two lines.
  it('the right-hand button may wrap at 104px, the event\'s name takes up to two lines', () => {
    expect(css).toMatch(/\.cd-event-actions \.cd-event-join-btn\s*\{[^}]*max-width:\s*104px;[^}]*white-space:\s*normal;/);
    const name = css.match(/\n\.cd-event-name\s*\{[^}]*\}/)[0];
    expect(name).toMatch(/-webkit-line-clamp:\s*2;/);
    expect(name).not.toMatch(/white-space:\s*nowrap/);
    expect(css).toMatch(/\.cd-event-info\s*\{[^}]*min-width:\s*0;/);
    // …and a long label drops under the calendar button, so the column stays
    // as narrow as the button itself
    expect(css).toMatch(/\n\.cd-event-actions\s*\{[^}]*flex-wrap:\s*wrap;[^}]*max-width:\s*140px;/);
    // the button's own rules stay as they were (the join button is replaced
    // by another component after the merge and relies on them)
    expect(css).toMatch(/\n\.cd-event-join-btn\s*\{[^}]*white-space:\s*nowrap;/);
    expect(css).toMatch(/\n\.cd-event-join-btn:disabled\s*\{[^}]*opacity:\s*0\.55;/);
  });
});

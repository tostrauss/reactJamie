import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act, within, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// „Demnächst dabei“ in the own profile (Tina 16.11.2026, PR4/PR5): the next
// meetups and club events, a date tile, the title in coral, „☆ Partner /
// Community / Gruppe · x/y“, own entries framed yellow, „Zum Chat“ on every
// row — and „Events bearbeiten“, where only the editable rows wiggle and lead
// to their edit page. Real German i18n.
const api = vi.hoisted(() => ({ groups: { getUpcoming: vi.fn() } }));
vi.mock('../utils/api', () => api);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));

const { default: ProfileUpcomingEvents } = await import('../components/ProfileUpcomingEvents');

const row = (id, name, over = {}) => ({
  id, name, type: 'group', date: null, next_at: null, is_recurring_weekly: false,
  image_url: null, location: 'Wien', members_count: 1, max_members: 20,
  parent_club_id: null, club_name: null, is_own: false, can_edit: false,
  is_partner: false, kind: 'group', pending_request_count: 0, ...over,
});

// In the server's order (next_at ASC NULLS LAST). „Now" is Monday 16.11.2026,
// 10:00 in Vienna; dates are Vienna wall-clock tagged UTC, as the API sends them.
const ROWS = [
  row(41, 'Spieleabend', {
    type: 'event', date: '2026-11-16T19:00:00.000Z', next_at: '2026-11-16T19:00:00.000Z',
    parent_club_id: 7, club_name: 'Café Soleá', is_own: true, can_edit: true, is_partner: true,
    kind: 'partner', members_count: 8, pending_request_count: 2,
  }),
  row(42, 'Laufrunde', { date: '2026-11-20T00:00:00.000Z', next_at: '2026-11-20T00:00:00.000Z' }),
  row(43, 'Wiener Stammtisch', {
    type: 'event', date: '2026-11-22T22:30:00.000Z', next_at: '2026-11-22T22:30:00.000Z',
    parent_club_id: 8, club_name: 'Südtiroler in Wien', can_edit: true, kind: 'community',
    members_count: 12, max_members: 30,
  }),
  row(44, 'Yoga im Park', {
    date: '2026-11-02T00:00:00.000Z', next_at: '2026-11-23T00:00:00.000Z', is_recurring_weekly: true,
    is_own: true, can_edit: true, members_count: 3, max_members: 10,
  }),
  row(45, 'Altes Treffen', { members_count: 2, max_members: 10 }),
];
const FIRST_THREE = ['Spieleabend', 'Laufrunde', 'Wiener Stammtisch'];

const Where = () => {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}{loc.state ? ` ${JSON.stringify(loc.state)}` : ''}</div>;
};

// Profile holds the mode (ONE for the card).
function Harness() {
  const [editing, setEditing] = useState(false);
  return <ProfileUpcomingEvents editing={editing} onEditingChange={setEditing} />;
}

const renderUpcoming = async (rows = ROWS, entry = '/profile') => {
  api.groups.getUpcoming.mockResolvedValue({ data: rows.map((r) => ({ ...r })) });
  const utils = render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/profile" element={<Harness />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {});
  return utils;
};
const names = () => [...document.querySelectorAll('.profile-upcoming-name')].map((n) => n.textContent);
const item = (name) => [...document.querySelectorAll('.profile-upcoming-row')]
  .find((li) => li.querySelector('.profile-upcoming-name').textContent === name);
const where = () => screen.getByTestId('where').textContent;
const startEditing = () => fireEvent.click(screen.getByRole('button', { name: 'Events bearbeiten' }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T09:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('ProfileUpcomingEvents — the list', () => {
  it('the next three in the server order, „Alle anzeigen (N)" opens the rest', async () => {
    await renderUpcoming();
    expect(screen.getByRole('region', { name: 'Demnächst dabei' })).toBeTruthy();
    expect(api.groups.getUpcoming).toHaveBeenCalledTimes(1);
    expect(names()).toEqual(FIRST_THREE);
    fireEvent.click(screen.getByRole('button', { name: 'Alle anzeigen (5)' }));
    expect(names()).toEqual([...FIRST_THREE, 'Yoga im Park', 'Altes Treffen']);
    expect(screen.queryByRole('button', { name: /Alle anzeigen/ })).toBeNull();
  });

  it('no „Alle anzeigen" with three or fewer', async () => {
    await renderUpcoming(ROWS.slice(0, 3));
    expect(names()).toEqual(FIRST_THREE);
    expect(screen.queryByRole('button', { name: /Alle anzeigen/ })).toBeNull();
  });

  it('date tile read in UTC — a 22:30 event stays on its day; a weekly series shows its next date; „?" without one', async () => {
    await renderUpcoming();
    fireEvent.click(screen.getByRole('button', { name: 'Alle anzeigen (5)' }));
    const tile = (name) => item(name).querySelector('.profile-upcoming-tile');
    // „16.“ over „Nov“ as in Tina's mock (p. 3): the German ordinal dot on
    // the day, the month without the dot de-AT adds („Nov.“).
    expect(tile('Spieleabend').querySelector('.profile-upcoming-day').textContent).toBe('16.');
    expect(tile('Spieleabend').querySelector('.profile-upcoming-month').textContent).toBe('Nov');
    expect(tile('Wiener Stammtisch').querySelector('.profile-upcoming-day').textContent).toBe('22.');
    expect(tile('Yoga im Park').querySelector('.profile-upcoming-day').textContent).toBe('23.');
    expect(tile('Altes Treffen').textContent).toBe('?');
    expect(tile('Altes Treffen').classList.contains('is-empty')).toBe(true);
  });

  it('„Heute" only on today\'s event (the Vienna day)', async () => {
    await renderUpcoming();
    expect(within(item('Spieleabend')).getByText('Heute')).toBeTruthy();
    expect(item('Spieleabend').classList.contains('is-today')).toBe(true);
    expect(within(item('Laufrunde')).queryByText('Heute')).toBeNull();
    expect(item('Laufrunde').classList.contains('is-today')).toBe(false);
  });

  // F-6: fr „Aujourd'hui“ beside „Ouvrir le chat“ left the name five letters
  // at 390 px. Only a long word marks the row (profile.css then puts it under
  // the name in a narrow row) — the German line stays as it is.
  it('a long word for „Heute" marks the row (fr), the German row is not marked', async () => {
    await renderUpcoming();
    expect(item('Spieleabend').classList.contains('is-today-long')).toBe(false);
    cleanup();
    const { switchLanguage } = await import('../i18n');
    await switchLanguage('fr');
    try {
      await renderUpcoming();
      expect(within(item('Spieleabend')).getByText("Aujourd'hui")).toBeTruthy();
      expect(item('Spieleabend').classList.contains('is-today-long')).toBe(true);
      expect(item('Laufrunde').classList.contains('is-today-long')).toBe(false);
    } finally {
      await switchLanguage('de');
    }
  });

  it('the Vienna day decides „Heute" — 00:30 in Vienna is the new day while UTC is still on the old one', async () => {
    vi.setSystemTime(new Date('2026-11-16T23:30:00.000Z'));   // Tue 17.11., 00:30 in Vienna
    await renderUpcoming([row(46, 'Kinoabend', {
      type: 'event', date: '2026-11-17T19:00:00.000Z', next_at: '2026-11-17T19:00:00.000Z', kind: 'community',
    })]);
    expect(within(item('Kinoabend')).getByText('Heute')).toBeTruthy();
    expect(item('Kinoabend').querySelector('.profile-upcoming-day').textContent).toBe('17.');
  });

  it('subline per type: ☆ Partner, Community, Gruppe · x/y — the screen reader hears the participants phrase', async () => {
    await renderUpcoming();
    const sub = (name) => item(name).querySelector('.profile-upcoming-sub');
    // the one ☆ Partner look (PartnerBadge), inline in the subline — review 16.11.2026
    const partner = sub('Spieleabend').querySelector('.partner-badge.partner-badge--inline');
    expect(partner).toBeTruthy();
    expect(partner.querySelector('svg polygon')).toBeTruthy();                 // ☆
    expect(within(partner).getByText('Partner').getAttribute('aria-hidden')).toBe('true');
    expect(within(partner).getByText('Event eines JAMIE-Partners').classList.contains('sr-only')).toBe(true);
    expect(within(sub('Spieleabend')).getByText('· 8/20').getAttribute('aria-hidden')).toBe('true');
    expect(within(sub('Spieleabend')).getByText('8/20 Teilnehmer').classList.contains('sr-only')).toBe(true);

    expect(sub('Laufrunde').querySelector('.partner-badge')).toBeNull();
    expect(within(sub('Laufrunde')).getByText('Gruppe')).toBeTruthy();
    expect(within(sub('Laufrunde')).getByText('· 1/20')).toBeTruthy();
    expect(within(sub('Wiener Stammtisch')).getByText('Community')).toBeTruthy();
    expect(within(sub('Wiener Stammtisch')).getByText('· 12/30')).toBeTruthy();
  });

  // Mock p. 3: „☆ Partner · 8/20“ is yellow from end to end — the row carries
  // the class the CSS colours the whole subline by.
  it('only the row of a partner event is marked is-partner (its whole subline turns yellow)', async () => {
    await renderUpcoming();
    expect(item('Spieleabend').classList.contains('is-partner')).toBe(true);
    expect(item('Laufrunde').classList.contains('is-partner')).toBe(false);
    expect(item('Wiener Stammtisch').classList.contains('is-partner')).toBe(false);
  });

  it('a server without `kind` gets the same rule from is_partner and the type', async () => {
    await renderUpcoming(ROWS.slice(0, 3).map((r) => {
      const copy = { ...r };
      delete copy.kind;
      return copy;
    }));
    expect(item('Spieleabend').querySelector('.partner-badge--inline')).toBeTruthy();
    expect(within(item('Laufrunde')).getByText('Gruppe')).toBeTruthy();
    expect(within(item('Wiener Stammtisch')).getByText('Community')).toBeTruthy();
  });

  // Audit PU-20: an official club's event that is no partner event used to
  // read „Community“ — a member's event there, or one of a club in review.
  it('an event of an official club that is no partner event reads „Club · x/y“ — no star', async () => {
    await renderUpcoming([row(47, 'Mitglieder-Abend', {
      type: 'event', date: '2026-11-19T19:00:00.000Z', next_at: '2026-11-19T19:00:00.000Z',
      parent_club_id: 7, club_name: 'Café Soleá', parent_club_type: 'official', kind: 'club',
      members_count: 4, max_members: 12,
    })]);
    const sub = item('Mitglieder-Abend').querySelector('.profile-upcoming-sub');
    expect(sub.querySelector('.partner-badge')).toBeNull();
    expect(within(sub).getByText('Club')).toBeTruthy();
    expect(within(sub).getByText('· 4/12')).toBeTruthy();
    expect(within(sub).queryByText('Community')).toBeNull();
  });

  it('a server without `kind`: the parent club\'s type decides between „Club“ and „Community“', async () => {
    const ev = (id, name, over) => {
      const copy = row(id, name, {
        type: 'event', date: '2026-11-19T19:00:00.000Z', next_at: '2026-11-19T19:00:00.000Z', parent_club_id: 7, ...over,
      });
      delete copy.kind;
      return copy;
    };
    await renderUpcoming([
      ev(48, 'Clubabend', { parent_club_type: 'official' }),
      ev(49, 'Communitylauf', { parent_club_type: 'community' }),
      ev(50, 'Altbestand', { parent_club_type: null }),
    ]);
    expect(within(item('Clubabend')).getByText('Club')).toBeTruthy();
    expect(within(item('Communitylauf')).getByText('Community')).toBeTruthy();
    expect(within(item('Altbestand')).getByText('Community')).toBeTruthy();   // NULL counts as community
    // …and the partner flag still wins over the type.
    expect(item('Clubabend').querySelector('.partner-badge')).toBeNull();
  });

  it('own entries framed yellow and named as own for screen readers — the others not', async () => {
    await renderUpcoming();
    fireEvent.click(screen.getByRole('button', { name: 'Alle anzeigen (5)' }));
    const own = [...document.querySelectorAll('.profile-upcoming-row.is-own')]
      .map((li) => li.querySelector('.profile-upcoming-name').textContent);
    expect(own).toEqual(['Spieleabend', 'Yoga im Park']);
    expect(within(item('Spieleabend')).getByText('Von dir erstellt').classList.contains('sr-only')).toBe(true);
    expect(within(item('Laufrunde')).queryByText('Von dir erstellt')).toBeNull();
  });

  it('a tap on the row opens the event', async () => {
    await renderUpcoming();
    fireEvent.click(item('Laufrunde').querySelector('.profile-upcoming-open'));
    expect(where()).toBe('/group/42');
  });

  it('„Zum Chat" on every row opens that chat and tells it to come back to the profile', async () => {
    await renderUpcoming();
    expect(screen.getAllByRole('button', { name: /^Zum Chat von/ })).toHaveLength(3);
    const btn = screen.getByRole('button', { name: 'Zum Chat von „Laufrunde“' });
    expect(btn.textContent).toBe('Zum Chat');
    fireEvent.click(btn);
    expect(where()).toBe('/chat/42 {"from":"/profile"}');
  });

  // Review 16.11.2026: the card is on both profile tabs — back to the one it was on.
  it('…on the Memories tab, back to the Memories tab', async () => {
    await renderUpcoming(ROWS, '/profile?tab=halloffame');
    fireEvent.click(screen.getByRole('button', { name: 'Zum Chat von „Laufrunde“' }));
    expect(where()).toBe('/chat/42 {"from":"/profile?tab=halloffame"}');
  });

  it('the coral counter on an own entry with open requests leads to the Anfragen deck', async () => {
    await renderUpcoming();
    // named by its event: several own rows can carry one (review 16.11.2026)
    const counter = screen.getByRole('button', { name: '2 offene Anfragen für „Spieleabend“' });
    expect(counter.textContent).toBe('2');
    expect(item('Spieleabend').contains(counter)).toBe(true);
    fireEvent.click(counter);
    expect(where()).toBe('/chats?tab=anfragen');
  });

  it('nothing coming up, or the list could not be read → no section at all', async () => {
    const { unmount } = await renderUpcoming([]);
    expect(document.querySelector('.profile-upcoming')).toBeNull();
    unmount();
    api.groups.getUpcoming.mockRejectedValue({ response: { status: 500 } });
    render(<MemoryRouter><Harness /></MemoryRouter>);
    await act(async () => {});
    expect(document.querySelector('.profile-upcoming')).toBeNull();
  });
});

describe('ProfileUpcomingEvents — „Events bearbeiten"', () => {
  it('only when at least one entry may be edited', async () => {
    await renderUpcoming(ROWS.map((r) => ({ ...r, can_edit: false })));
    expect(screen.queryByRole('button', { name: 'Events bearbeiten' })).toBeNull();
  });

  it('every row in view, only the editable ones wiggle with the edit glyph, the others are dimmed; no „Zum Chat", no counter', async () => {
    await renderUpcoming();
    startEditing();
    expect(names()).toEqual([...FIRST_THREE, 'Yoga im Park', 'Altes Treffen']);
    expect(screen.queryByRole('button', { name: /Alle anzeigen/ })).toBeNull();
    const wiggling = [...document.querySelectorAll('.profile-upcoming-row.is-wiggling')]
      .map((li) => li.querySelector('.profile-upcoming-name').textContent);
    expect(wiggling).toEqual(['Spieleabend', 'Wiener Stammtisch', 'Yoga im Park']);
    expect(document.querySelectorAll('.profile-upcoming-pencil')).toHaveLength(3);
    const locked = [...document.querySelectorAll('.profile-upcoming-row.is-locked')]
      .map((li) => li.querySelector('.profile-upcoming-name').textContent);
    expect(locked).toEqual(['Laufrunde', 'Altes Treffen']);
    expect(item('Laufrunde').querySelector('.profile-upcoming-open').getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('button', { name: /^Zum Chat/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /offene Anfragen/ })).toBeNull();
    expect(screen.getByText('Tippe auf ein Event, um es zu bearbeiten.')).toBeTruthy();
    // The label carries the state — no aria-pressed besides (review 16.11.2026).
    expect(screen.getByRole('button', { name: 'Fertig' }).hasAttribute('aria-pressed')).toBe(false);
  });

  it('a tap on an editable row opens its edit page — club events too', async () => {
    await renderUpcoming();
    startEditing();
    fireEvent.click(screen.getByRole('button', { name: '„Wiener Stammtisch“ bearbeiten' }));
    expect(where()).toBe('/group/43/edit');
  });

  it('a tap on a row the user may not edit says why and stays', async () => {
    await renderUpcoming();
    startEditing();
    fireEvent.click(item('Laufrunde').querySelector('.profile-upcoming-open'));
    expect(toast.info).toHaveBeenCalledWith('Dieses Event kann nur bearbeiten, wer es erstellt hat');
    expect(screen.queryByTestId('where')).toBeNull();
    expect(document.querySelector('.profile-upcoming-row.is-wiggling')).toBeTruthy();   // still in the mode
  });

  it('„Fertig" ends the mode: no wiggle, „Zum Chat" back, the list folded again', async () => {
    await renderUpcoming();
    startEditing();
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(document.querySelector('.profile-upcoming-row.is-wiggling')).toBeNull();
    expect(document.querySelector('.profile-upcoming-row.is-locked')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Zum Chat von/ })).toHaveLength(3);
    expect(names()).toEqual(FIRST_THREE);
    expect(screen.getByRole('button', { name: 'Events bearbeiten' }).hasAttribute('aria-pressed')).toBe(false);
  });
});

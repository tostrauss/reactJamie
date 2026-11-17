import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// „Clubs & Communities“ in the own profile (Tina 16.11.2026, PR2/PR3): round
// bubbles, own ones first with the yellow ring, ☆ on paying partners, and
// „Sortieren“ — joined bubbles wiggle, tap + arrows move them, leaving the
// mode saves the order. Real German i18n.
const api = vi.hoisted(() => ({
  clubs: { getJoined: vi.fn() },
  users: { setMyClubOrder: vi.fn() },
}));
vi.mock('../utils/api', () => api);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));

const { default: ProfileClubBubbles } = await import('../components/ProfileClubBubbles');

const club = (id, name, over = {}) => ({
  id, name, type: 'club', club_type: 'community', approval_status: 'approved', is_active: true,
  is_own: false, role: 'member', profile_position: null, joined_at: '2026-11-01T10:00:00.000Z',
  pending_request_count: 0, image_url: null, ...over,
});

// In the server's order (joined_at DESC), as GET /clubs/user/joined sends it.
const CLUBS = [
  club(5, 'Brettspiel-Treff', { joined_at: '2026-11-10T10:00:00.000Z' }),
  club(1, 'Mein Lauftreff', { is_own: true, role: 'owner', pending_request_count: 3, joined_at: '2026-11-05T10:00:00.000Z' }),
  club(2, 'Café Soleá', { club_type: 'official', is_paid_partner: true, profile_position: 2, joined_at: '2026-10-01T10:00:00.000Z' }),
  club(3, 'Südtiroler in Wien', { profile_position: 1, joined_at: '2026-09-01T10:00:00.000Z', image_url: '/media/uploads/sued.jpg' }),
  club(4, 'Alter Club', { joined_at: '2026-08-01T10:00:00.000Z' }),
  club(6, 'Abgelehnt', { approval_status: 'rejected', is_active: false }),
  club(7, 'Geschlossen', { is_active: false }),
];
const SHOWN = ['Mein Lauftreff', 'Brettspiel-Treff', 'Alter Club', 'Südtiroler in Wien', 'Café Soleá'];

const Where = () => {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}</div>;
};

// Profile holds the mode; „Modus beenden" stands for everything else that
// ends it (a tab switch, „Events bearbeiten").
function Harness() {
  const [sorting, setSorting] = useState(false);
  return (
    <>
      <ProfileClubBubbles sorting={sorting} onSortingChange={setSorting} />
      <button type="button" onClick={() => setSorting(false)}>Modus beenden</button>
    </>
  );
}

const renderBubbles = async (rows = CLUBS) => {
  api.clubs.getJoined.mockResolvedValue({ data: rows.map((r) => ({ ...r })) });
  const utils = render(
    <MemoryRouter initialEntries={['/profile']}>
      <Routes>
        <Route path="/profile" element={<Harness />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {});
  return utils;
};
const names = () => [...document.querySelectorAll('.profile-club .profile-club-name')].map((n) => n.textContent);
const item = (name) => [...document.querySelectorAll('.profile-club')].find((li) => li.querySelector('.profile-club-name').textContent === name);
const pick = (name) => fireEvent.click(screen.getByRole('button', { name: `„${name}“ zum Verschieben auswählen` }));
const startSorting = () => fireEvent.click(screen.getByRole('button', { name: 'Sortieren' }));
// What PUT /users/me/clubs/order answers: the list with the new positions.
const serverAfter = (ids) => CLUBS.map((c) => ({ ...c, profile_position: ids.includes(c.id) ? ids.indexOf(c.id) + 1 : null }));

beforeEach(() => {
  vi.clearAllMocks();
  api.users.setMyClubOrder.mockImplementation((ids) => Promise.resolve({ data: serverAfter(ids) }));
});

describe('ProfileClubBubbles — the row', () => {
  it('own clubs first with the yellow ring, then joined: never-sorted newest first, then the saved order; rejected and closed left out', async () => {
    await renderBubbles();
    expect(screen.getByRole('region', { name: 'Clubs & Communities' })).toBeTruthy();
    expect(names()).toEqual(SHOWN);
    expect([...document.querySelectorAll('.profile-club')].map((li) => li.classList.contains('is-own')))
      .toEqual([true, false, false, false, false]);
    expect(screen.getByRole('button', { name: /^Mein Lauftreff/ }).textContent).toContain('Von dir erstellt');
  });

  it('round thumbnail of the picture, the initial without one', async () => {
    await renderBubbles();
    expect(item('Südtiroler in Wien').querySelector('img').getAttribute('src')).toBe('/media/uploads/sued.jpg?size=thumb');
    expect(item('Alter Club').querySelector('img')).toBeNull();
    expect(item('Alter Club').querySelector('.profile-club-bubble').textContent).toBe('A');
  });

  // Tobi 17.11.2026: „Gelb, ☆ Partner und der ✓-Haken nur für ZAHLENDE
  // Partner … Nicht zahlende Clubs: kein Gelb, kein ☆, kein ✓.“ The rule is
  // partnerSql's: live, approved, official AND is_paid_partner.
  it('☆ only on a paying partner — not on an official club that does not pay, not on one in review, not on a closed one', async () => {
    await renderBubbles([
      ...CLUBS,
      club(10, 'Kein Zahler', { club_type: 'official' }),                                  // approved, no flag
      club(11, 'Altes Feld', { club_type: 'official', is_paid_partner: undefined }),       // an old server
      club(12, 'Zahlende Community', { is_paid_partner: true }),                           // flag without official
      club(8, 'Mein Café', { is_own: true, club_type: 'official', is_paid_partner: true, approval_status: 'pending' }),
    ]);
    const stars = [...document.querySelectorAll('.profile-club-star')];
    expect(stars).toHaveLength(1);
    expect(stars[0].closest('.profile-club')).toBe(item('Café Soleá'));
    expect(screen.getByRole('button', { name: /^Café Soleá/ }).textContent).toContain('JAMIE-Partner');
    for (const name of ['Kein Zahler', 'Altes Feld', 'Zahlende Community', 'Mein Café']) {
      expect(item(name).querySelector('.profile-club-star')).toBeNull();
      expect(item(name).textContent).not.toContain('JAMIE-Partner');
    }
    // In review: there, dimmed, and says so — paying or not.
    expect(item('Mein Café').classList.contains('is-pending')).toBe(true);
    expect(item('Mein Café').textContent).toContain('Wird noch geprüft');
  });

  it('an own paying partner club carries both: the yellow ring and the ☆', async () => {
    await renderBubbles([...CLUBS, club(9, 'Mein Partnerclub', { is_own: true, club_type: 'official', is_paid_partner: true })]);
    expect(item('Mein Partnerclub').classList.contains('is-own')).toBe(true);
    expect(item('Mein Partnerclub').querySelector('.profile-club-star')).toBeTruthy();
  });

  it('a tap opens the club page', async () => {
    await renderBubbles();
    fireEvent.click(screen.getByRole('button', { name: /^Südtiroler in Wien/ }));
    expect(screen.getByTestId('where').textContent).toBe('/club/3');
  });

  it('the coral counter on an own club leads to the Anfragen deck', async () => {
    await renderBubbles();
    // named by its club: several own ones can carry one (review 16.11.2026)
    const counter = screen.getByRole('button', { name: '3 offene Anfragen für „Mein Lauftreff“' });
    expect(counter.textContent).toBe('3');
    expect(item('Mein Lauftreff').contains(counter)).toBe(true);
    fireEvent.click(counter);
    expect(screen.getByTestId('where').textContent).toBe('/chats?tab=anfragen');
  });

  it('no card without a club to show', async () => {
    await renderBubbles([CLUBS[5], CLUBS[6]]);
    expect(document.querySelector('.profile-clubs')).toBeNull();
  });
});

describe('ProfileClubBubbles — „Sortieren"', () => {
  it('only from two sortable bubbles on — own clubs do not count', async () => {
    await renderBubbles([CLUBS[1], CLUBS[0]]);
    expect(screen.queryByRole('button', { name: 'Sortieren' })).toBeNull();
  });

  it('turns the row into a grid where only the joined bubbles wiggle', async () => {
    await renderBubbles();
    startSorting();
    expect(document.querySelector('.profile-clubs-rail.is-sorting')).toBeTruthy();
    const wiggling = [...document.querySelectorAll('.profile-club.is-wiggling')].map((li) => li.querySelector('.profile-club-name').textContent);
    expect(wiggling).toEqual(SHOWN.slice(1));
    expect(item('Mein Lauftreff').classList.contains('is-wiggling')).toBe(false);
    // The label carries the state — no aria-pressed besides (review 16.11.2026).
    expect(screen.getByRole('button', { name: 'Fertig' }).hasAttribute('aria-pressed')).toBe(false);
    expect(screen.getByText('Ziehen zum Verschieben – oder antippen und die Pfeile nutzen.')).toBeTruthy();
  });

  it('an own bubble stays put and says why — Community or Club wording; no counter in the mode', async () => {
    await renderBubbles([...CLUBS, club(9, 'Mein Partnerclub', { is_own: true, club_type: 'official' })]);
    startSorting();
    expect(screen.queryByRole('button', { name: /offene Anfragen/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Mein Lauftreff/ }));
    expect(toast.info).toHaveBeenCalledWith('Diese Community hast du erstellt! Lass sie sichtbar');
    fireEvent.click(screen.getByRole('button', { name: /^Mein Partnerclub/ }));
    expect(toast.info).toHaveBeenLastCalledWith('Diesen Club hast du erstellt! Lass ihn sichtbar');
    expect(screen.queryByTestId('where')).toBeNull();          // still on the profile
    expect(document.querySelector('.profile-club.is-picked')).toBeNull();
  });

  it('tap picks a bubble, the arrows move it, „Fertig" saves only the joined ids in the new order', async () => {
    await renderBubbles();
    startSorting();
    pick('Café Soleá');
    expect(item('Café Soleá').classList.contains('is-picked')).toBe(true);
    expect(screen.getByRole('button', { name: 'Einen Platz nach hinten' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Einen Platz nach vorne' }));
    fireEvent.click(screen.getByRole('button', { name: 'Einen Platz nach vorne' }));
    expect(screen.getByText('Jetzt an Platz 2 von 4')).toBeTruthy();
    expect(names()).toEqual(['Mein Lauftreff', 'Brettspiel-Treff', 'Café Soleá', 'Alter Club', 'Südtiroler in Wien']);
    expect(api.users.setMyClubOrder).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fertig' })); });
    expect(api.users.setMyClubOrder).toHaveBeenCalledTimes(1);
    expect(api.users.setMyClubOrder).toHaveBeenCalledWith([5, 2, 4, 3]);   // no own id (1)
    expect(document.querySelector('.profile-clubs-rail.is-sorting')).toBeNull();
    expect(document.querySelector('.profile-club.is-wiggling')).toBeNull();
    expect(names()).toEqual(['Mein Lauftreff', 'Brettspiel-Treff', 'Café Soleá', 'Alter Club', 'Südtiroler in Wien']);
  });

  it('keyboard: ← / → on the focused bubble moves it and focus stays with it', async () => {
    await renderBubbles();
    startSorting();
    const btn = screen.getByRole('button', { name: '„Brettspiel-Treff“ zum Verschieben auswählen' });
    btn.focus();
    fireEvent.keyDown(btn, { key: 'ArrowRight' });
    expect(names()).toEqual(['Mein Lauftreff', 'Alter Club', 'Brettspiel-Treff', 'Südtiroler in Wien', 'Café Soleá']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '„Brettspiel-Treff“ zum Verschieben auswählen' }));
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' });   // already first among the joined: stays
    expect(names()).toEqual(SHOWN);
  });

  // Review 16.11.2026: a disabled button at the row's end dropped the focus
  // onto <body> — VoiceOver lost its place in the card.
  it('at the row\'s end the arrow keeps its focus and does nothing', async () => {
    await renderBubbles();
    startSorting();
    pick('Brettspiel-Treff');
    const earlier = screen.getByRole('button', { name: 'Einen Platz nach vorne' });
    earlier.focus();
    fireEvent.click(earlier);
    expect(names()).toEqual(['Mein Lauftreff', 'Brettspiel-Treff', 'Alter Club', 'Südtiroler in Wien', 'Café Soleá']);
    expect(earlier.getAttribute('aria-disabled')).toBe('true');
    expect(earlier.disabled).toBe(false);
    expect(document.activeElement).toBe(earlier);
    fireEvent.click(earlier);                                   // once more at the edge: nothing
    expect(names()).toEqual(['Mein Lauftreff', 'Brettspiel-Treff', 'Alter Club', 'Südtiroler in Wien', 'Café Soleá']);
  });

  it('a failed save puts the old order back and says so', async () => {
    api.users.setMyClubOrder.mockRejectedValue({ response: { status: 500 } });
    await renderBubbles();
    startSorting();
    pick('Alter Club');
    fireEvent.click(screen.getByRole('button', { name: 'Einen Platz nach hinten' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fertig' })); });
    expect(api.users.setMyClubOrder).toHaveBeenCalledWith([5, 3, 4, 2]);
    expect(toast.error).toHaveBeenCalledWith('Reihenfolge konnte nicht gespeichert werden – bitte versuch es nochmal');
    expect(names()).toEqual(SHOWN);
  });

  it('nothing moved → nothing saved', async () => {
    await renderBubbles();
    startSorting();
    pick('Alter Club');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fertig' })); });
    expect(api.users.setMyClubOrder).not.toHaveBeenCalled();
  });

  it('ending the mode another way (tab switch, the other mode) saves just the same', async () => {
    await renderBubbles();
    startSorting();
    pick('Brettspiel-Treff');
    fireEvent.click(screen.getByRole('button', { name: 'Einen Platz nach hinten' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Modus beenden' })); });
    expect(api.users.setMyClubOrder).toHaveBeenCalledWith([4, 5, 3, 2]);
  });

  it('leaving the page mid-sort keeps the new order too', async () => {
    const { unmount } = await renderBubbles();
    startSorting();
    pick('Brettspiel-Treff');
    fireEvent.click(screen.getByRole('button', { name: 'Einen Platz nach hinten' }));
    await act(async () => { unmount(); });
    expect(api.users.setMyClubOrder).toHaveBeenCalledWith([4, 5, 3, 2]);
  });
});

// Tina 17.11.2026: „wackeln die Bubbles wie bei Apple. User können die Clubs
// neu ansortieren“ — Apple's wiggle is the mode for DRAGGING (audit PC-23).
// jsdom has no layout, so the sortable bubbles get the grid's places here:
// 64px tracks 10px apart, in one row (offsetLeft … are the hook's only source;
// the rail's getBoundingClientRect is jsdom's all-zero box).
describe('ProfileClubBubbles — dragging in „Sortieren"', () => {
  const PITCH = 74;
  const slotOf = (el) => (el.matches?.('li[data-club-id]')
    ? [...el.parentNode.querySelectorAll('li[data-club-id]')].indexOf(el) : -1);
  const centre = (i) => i * PITCH + 32;            // x of place i; y is 40 for all
  let spies = [];

  beforeEach(() => {
    const layout = (prop, value) => vi.spyOn(HTMLElement.prototype, prop, 'get')
      .mockImplementation(function get() { return slotOf(this) < 0 ? 0 : value(slotOf(this)); });
    spies = [
      layout('offsetLeft', (i) => i * PITCH),
      layout('offsetTop', () => 0),
      layout('offsetWidth', () => 64),
      layout('offsetHeight', () => 80),
    ];
  });
  afterEach(() => { spies.forEach((s) => s.mockRestore()); });

  const pointer = { pointerId: 7, pointerType: 'touch', button: 0 };
  const bubble = (name) => screen.getByRole('button', { name: `„${name}“ zum Verschieben auswählen` });
  const press = (name, x, y = 40, over = {}) => fireEvent.pointerDown(bubble(name), { ...pointer, clientX: x, clientY: y, ...over });
  const moveTo = (x, y = 40) => fireEvent.pointerMove(window, { ...pointer, clientX: x, clientY: y });
  const letGo = (x, y = 40) => fireEvent.pointerUp(window, { ...pointer, clientX: x, clientY: y });
  // The bubble glides home for 150 ms before the drag is over.
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 200)); });

  // The joined ones in „Sortieren": Brettspiel-Treff (0), Alter Club (1),
  // Südtiroler in Wien (2), Café Soleá (3).
  it('„Café Soleá" dragged onto the place of „Brettspiel-Treff": new order, it is the picked one, „Fertig" saves it', async () => {
    await renderBubbles();
    startSorting();
    press('Café Soleá', centre(3));
    moveTo(centre(2));                              // past 6 px: a drag, over place 2
    expect(item('Café Soleá').classList.contains('is-dragging')).toBe(true);
    expect(names()).toEqual(['Mein Lauftreff', 'Brettspiel-Treff', 'Alter Club', 'Café Soleá', 'Südtiroler in Wien']);
    moveTo(centre(0));
    expect(names()).toEqual(['Mein Lauftreff', 'Café Soleá', 'Brettspiel-Treff', 'Alter Club', 'Südtiroler in Wien']);
    // It follows the finger by an inline transform, lifted.
    expect(item('Café Soleá').style.transform).toMatch(/^translate\(.+\) scale\(1\.1\)$/);
    expect(document.querySelector('.profile-club.is-picked')).toBeNull();
    expect(api.users.setMyClubOrder).not.toHaveBeenCalled();

    letGo(centre(0));
    // The click the release brings along is not a tap: nothing gets picked by it.
    fireEvent.click(bubble('Café Soleá'));
    expect(document.querySelector('.profile-club.is-picked')).toBeNull();
    await settle();
    // Home: no inline style left (it would overrule the picked bubble's scale).
    expect(item('Café Soleá').classList.contains('is-dragging')).toBe(false);
    expect(item('Café Soleá').style.transform).toBe('');
    expect(item('Café Soleá').style.transition).toBe('');
    expect(item('Café Soleá').classList.contains('is-picked')).toBe(true);
    expect(screen.getByText('Jetzt an Platz 1 von 4')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Einen Platz nach hinten' })).toBeTruthy();

    // A real tap afterwards picks again.
    pick('Alter Club');
    expect(item('Alter Club').classList.contains('is-picked')).toBe(true);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Fertig' })); });
    expect(api.users.setMyClubOrder).toHaveBeenCalledTimes(1);
    expect(api.users.setMyClubOrder).toHaveBeenCalledWith([2, 5, 4, 3]);   // no own id (1)
  });

  it('touch brings no click after a drag — the next tap still picks', async () => {
    await renderBubbles();
    startSorting();
    press('Brettspiel-Treff', centre(0));
    moveTo(centre(1));
    letGo(centre(1));
    await settle();
    expect(names()).toEqual(['Mein Lauftreff', 'Alter Club', 'Brettspiel-Treff', 'Südtiroler in Wien', 'Café Soleá']);
    expect(item('Brettspiel-Treff').classList.contains('is-picked')).toBe(true);
    fireEvent.click(bubble('Südtiroler in Wien'));
    expect(item('Südtiroler in Wien').classList.contains('is-picked')).toBe(true);
  });

  it('under 6 px it stays a tap: nothing moves, the bubble is picked', async () => {
    await renderBubbles();
    startSorting();
    press('Alter Club', centre(1));
    moveTo(centre(1) + 4, 42);
    expect(document.querySelector('.profile-club.is-dragging')).toBeNull();
    letGo(centre(1) + 4, 42);
    fireEvent.click(bubble('Alter Club'));
    expect(item('Alter Club').classList.contains('is-picked')).toBe(true);
    expect(item('Alter Club').style.transform).toBe('');
    expect(names()).toEqual(SHOWN);
  });

  it('own bubbles are no places and cannot be dragged; the right mouse button drags nothing', async () => {
    await renderBubbles();
    startSorting();
    expect(item('Mein Lauftreff').hasAttribute('data-club-id')).toBe(false);
    expect([...document.querySelectorAll('li[data-club-id]')].map((li) => li.dataset.clubId)).toEqual(['5', '4', '3', '2']);
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Mein Lauftreff/ }), { ...pointer, clientX: 10, clientY: 40 });
    moveTo(centre(2));
    expect(document.querySelector('.profile-club.is-dragging')).toBeNull();
    letGo(centre(2));

    press('Alter Club', centre(1), 40, { pointerType: 'mouse', button: 2 });
    fireEvent.pointerMove(window, { ...pointer, pointerType: 'mouse', clientX: centre(3), clientY: 40 });
    expect(document.querySelector('.profile-club.is-dragging')).toBeNull();
    expect(names()).toEqual(SHOWN);
  });

  it('another finger\'s moves are not this drag', async () => {
    await renderBubbles();
    startSorting();
    press('Alter Club', centre(1));
    fireEvent.pointerMove(window, { ...pointer, pointerId: 8, clientX: centre(3), clientY: 40 });
    expect(document.querySelector('.profile-club.is-dragging')).toBeNull();
    expect(names()).toEqual(SHOWN);
  });

  it('the mode ending mid-drag saves the order reached and leaves nothing behind', async () => {
    await renderBubbles();
    startSorting();
    press('Café Soleá', centre(3));
    moveTo(centre(0));
    expect(item('Café Soleá').classList.contains('is-dragging')).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Modus beenden' })); });
    expect(api.users.setMyClubOrder).toHaveBeenCalledWith([2, 5, 4, 3]);
    expect(item('Café Soleá').style.transform).toBe('');
    // The finger lifting afterwards, and the next session, find nothing stuck.
    letGo(centre(0));
    await settle();
    startSorting();
    expect(document.querySelector('.profile-club.is-dragging')).toBeNull();
    expect(document.querySelector('.profile-club.is-picked')).toBeNull();
  });
});

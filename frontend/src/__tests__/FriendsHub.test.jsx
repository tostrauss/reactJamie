import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AuthContext } from '../context/AuthContext';
import { viennaTodayUTC } from '../utils/recurrence';

// Tina's „JAMIE: Neue Friends Seite“ (17.11.2026) — the Friends tab of
// Explore, top to bottom: the ⊕ with a person-plus icon, the bar „👋 3 neue
// Freundschaftsanfragen“, „Wo gehen deine Freunde hin? 🎉“ with „Mitkommen“,
// „Deine Freunde“ (three random ones, „Alle ansehen“), „Leute, die du kennen
// könntest“. Real German i18n — her wording is pinned letter by letter.
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../utils/api', () => ({
  groups: { join: vi.fn() },
  users: { search: vi.fn() },
  friends: {
    getAll: vi.fn(), getSuggestions: vi.fn(), sendRequest: vi.fn(), respondRequest: vi.fn(),
    getPending: vi.fn(), getGoing: vi.fn(), getPeople: vi.fn(),
  },
}));
const { groups, users, friends } = await import('../utils/api');
const { FriendsTab, FRIENDS_SHOWN } = await import('../components/FriendsTab');
const { SHOW_FRIEND_AVATARS } = await import('../components/FriendsGoing');

// A date `days` from today at h:m — the stored Vienna wall-clock, tagged UTC.
const at = (days, h = 0, m = 0) => new Date(viennaTodayUTC() + days * 864e5 + h * 36e5 + m * 6e4).toISOString();
const weekdayOf = (iso) => {
  const w = new Date(iso).toLocaleDateString('de-AT', { weekday: 'short', timeZone: 'UTC' }).replace(/\.$/, '');
  return w.charAt(0).toUpperCase() + w.slice(1);
};

const friendRow = (id, name, o = {}) => ({ friendship_id: id, friend_id: id, name, age: 20 + (id % 9), location: 'Wien', avatar_url: null, ...o });
const FIVE = [friendRow(21, 'Tim'), friendRow(22, 'Laura'), friendRow(23, 'Fynn'), friendRow(24, 'Nora'), friendRow(25, 'Paul')];
const goingCard = (o = {}) => ({
  id: 5, name: 'Spieleabend im Café', type: 'group', image_url: '/media/spiele.webp',
  date: at(2, 19), next_at: at(2, 19), is_recurring_weekly: false, friend_count: 3,
  friends: [
    { id: 23, name: 'Fynn Huber', avatar_url: '/media/fynn.webp' },
    { id: 22, name: 'Laura', avatar_url: '/media/laura.webp' },
    { id: 21, name: 'Tim', avatar_url: null },
  ],
  my_status: 'none', ...o,
});
const person = (o = {}) => ({ id: 31, name: 'Mara', age: 22, avatar_url: null, event_name: 'Kochabend', ...o });

const Harness = () => {
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="where">{loc.pathname + loc.search}</output>
      {/* Android's back key / the swipe back: one step back in the history. */}
      <button type="button" data-testid="hardware-back" onClick={() => navigate(-1)}>back</button>
    </>
  );
};
const where = () => screen.getByTestId('where').textContent;

const renderHub = async ({
  path: at_ = '/explore?tab=friends', user = { id: 9, name: 'Ich', avatar_url: '/media/me.webp' },
  friendList = FIVE, pending = [], going = [], people = { people: [], has_shared: true },
} = {}) => {
  vi.mocked(friends.getAll).mockResolvedValue({ data: friendList });
  if (pending instanceof Error) vi.mocked(friends.getPending).mockRejectedValue(pending);
  else vi.mocked(friends.getPending).mockResolvedValue({ data: pending });
  if (going instanceof Error) vi.mocked(friends.getGoing).mockRejectedValue(going);
  else vi.mocked(friends.getGoing).mockResolvedValue({ data: going });
  if (people instanceof Error) vi.mocked(friends.getPeople).mockRejectedValue(people);
  else vi.mocked(friends.getPeople).mockResolvedValue({ data: people });
  vi.mocked(friends.getSuggestions).mockResolvedValue({ data: [] });
  const view = render(
    <AuthContext.Provider value={{ user }}>
      <MemoryRouter initialEntries={[at_]}>
        <Routes>
          <Route path="/explore" element={<><FriendsTab /><Harness /></>} />
          <Route path="/group/:id" element={<><p>GROUP PAGE</p><Harness /></>} />
          <Route path="/user/:id" element={<><p>PROFILE</p><Harness /></>} />
          <Route path="/chats" element={<><p>CHATS</p><Harness /></>} />
          <Route path="/chat/:id" element={<><p>CHAT</p><Harness /></>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});
  return view;
};

const cardOf = (name) => screen.getByText(name).closest('li');
const click = async (el) => { await act(async () => { fireEvent.click(el); }); };

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Friends page — heading and the requests bar', () => {
  it('the ⊕ button shows a person with a plus — no bare plus any more — and still opens „Friends hinzufügen“', async () => {
    await renderHub();
    const button = screen.getByRole('button', { name: 'Friends hinzufügen' });
    const icon = button.querySelector('svg.fh-add-icon');
    expect(icon).toBeTruthy();
    expect(icon.querySelector('circle')).toBeTruthy();           // the head
    expect(icon.querySelectorAll('path')).toHaveLength(2);       // shoulders + the small plus
    expect(button.innerHTML).not.toContain('M12 5v14M5 12h14'); // the old big plus
    await click(button);
    expect(screen.getByRole('dialog', { name: 'Friends hinzufügen' })).toBeTruthy();
  });

  it('the bar is there only with incoming requests, counts them, and leads to Chat → Anfragen → Freunde', async () => {
    const first = await renderHub({ pending: [] });
    expect(screen.queryByText(/Freundschaftsanfrage/)).toBeNull();
    first.unmount();

    const one = await renderHub({ pending: [{ id: 1 }] });
    expect(screen.getByRole('button', { name: '👋 1 neue Freundschaftsanfrage' })).toBeTruthy();
    one.unmount();

    await renderHub({ pending: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    await click(screen.getByRole('button', { name: '👋 3 neue Freundschaftsanfragen' }));
    expect(screen.getByText('CHATS')).toBeTruthy();
    expect(where()).toBe('/chats?tab=anfragen&kind=freunde');
  });

  it('a failing requests call shows no bar and breaks nothing', async () => {
    await renderHub({ pending: new Error('down') });
    expect(screen.queryByText(/Freundschaftsanfrage/)).toBeNull();
    expect(screen.getByText('Deine Freunde')).toBeTruthy();
  });
});

describe('Friends page — „Wo gehen deine Freunde hin? 🎉“', () => {
  it('no card, or a failed load: no section at all', async () => {
    const empty = await renderHub({ going: [] });
    expect(screen.queryByText('Wo gehen deine Freunde hin? 🎉')).toBeNull();
    empty.unmount();
    await renderHub({ going: new Error('down') });
    expect(screen.queryByText('Wo gehen deine Freunde hin? 🎉')).toBeNull();
    expect(screen.getByText('Deine Freunde')).toBeTruthy();
  });

  it('a card: the name, day and time, the friends who go and „Mitkommen“', async () => {
    const soon = goingCard();
    const today = goingCard({ id: 6, name: 'Punsch & Rave 2', next_at: at(0, 21), date: at(0, 21), friend_count: 2, friends: [{ id: 22, name: 'Laura', avatar_url: null }, { id: 21, name: 'Tim', avatar_url: null }] });
    const later = goingCard({ id: 7, name: 'Skitag aufs Hochkar', next_at: at(10, 8), date: at(10, 8), friend_count: 1, friends: [{ id: 26, name: 'Max', avatar_url: null }], image_url: null });
    const noTime = goingCard({ id: 8, name: 'Picknick', next_at: at(3), date: at(3) });
    await renderHub({ going: [today, soon, noTime, later] });

    expect(screen.getByRole('heading', { name: 'Wo gehen deine Freunde hin? 🎉' })).toBeTruthy();
    const c = cardOf('Spieleabend im Café');
    expect(within(c).getByText(`${weekdayOf(soon.next_at)}, 19:00`)).toBeTruthy();
    // „Fynn + 2 Freunde“: the first name, then how many more.
    expect(c.querySelector('.fh-going-friends').textContent).toBe('Fynn + 2 Freunde');
    expect(within(c).getByRole('button', { name: 'Mitkommen' })).toBeTruthy();
    expect(c.querySelector('.fh-going-img img').getAttribute('src')).toContain('spiele.webp');

    expect(cardOf('Punsch & Rave 2').querySelector('.fh-going-friends').textContent).toBe('Laura + 1 Freund');
    expect(within(cardOf('Punsch & Rave 2')).getByText('Heute, 21:00')).toBeTruthy();
    // One friend alone: just the name.
    expect(cardOf('Skitag aufs Hochkar').querySelector('.fh-going-friends').textContent).toBe('Max');
    // No picture: the first letter instead of a broken image.
    expect(cardOf('Skitag aufs Hochkar').querySelector('.fh-going-img img')).toBeNull();
    expect(cardOf('Skitag aufs Hochkar').querySelector('.fh-going-img').textContent).toBe('S');
    // More than six days ahead: the date beside the weekday.
    const d = new Date(later.next_at);
    expect(within(cardOf('Skitag aufs Hochkar')).getByText(
      `${weekdayOf(later.next_at)}, ${d.getUTCDate()}.${d.getUTCMonth() + 1}., 08:00`)).toBeTruthy();
    // No time: the day alone.
    expect(cardOf('Picknick').querySelector('.fh-going-when').textContent).toBe(weekdayOf(noTime.next_at));
    // The server's order is kept.
    expect([...document.querySelectorAll('.fh-going-name')].map((n) => n.textContent))
      .toEqual(['Punsch & Rave 2', 'Spieleabend im Café', 'Picknick', 'Skitag aufs Hochkar']);
  });

  it('the friends\' profile pictures sit on the card (one switch turns them off)', async () => {
    await renderHub({ going: [goingCard()] });
    expect(SHOW_FRIEND_AVATARS).toBe(true);
    const avatars = cardOf('Spieleabend im Café').querySelectorAll('.fh-going-avatar');
    expect(avatars).toHaveLength(3);
    expect(avatars[0].querySelector('img').getAttribute('src')).toContain('fynn.webp');
    expect(avatars[2].querySelector('img')).toBeNull();     // no picture: the initial
    expect(avatars[2].textContent).toBe('T');
  });

  it('a tap on the card opens the meetup', async () => {
    await renderHub({ going: [goingCard()] });
    await click(screen.getByText('Spieleabend im Café'));
    expect(screen.getByText('GROUP PAGE')).toBeTruthy();
    expect(where()).toBe('/group/5');
    expect(groups.join).not.toHaveBeenCalled();
  });

  it('„Mitkommen“ on an open meetup: the normal join — the button turns into „Du bist dabei“', async () => {
    vi.mocked(groups.join).mockResolvedValueOnce({ data: { message: 'Joined group successfully', status: 'joined' } });
    const pushAsk = vi.fn();
    window.addEventListener('jamie:push-prompt-after-join', pushAsk);
    await renderHub({ going: [goingCard(), goingCard({ id: 6, name: 'Punsch & Rave 2' })] });
    await click(within(cardOf('Spieleabend im Café')).getByRole('button', { name: 'Mitkommen' }));

    // „Sag kurz Hallo“ — the sheet of the meetup's own page (Tobi 18.11.2026).
    // The push ask waits until it closes, so the two never stack.
    const hello = screen.getByRole('dialog', { name: 'Du bist bei Spieleabend im Café dabei!' });
    expect(within(hello).getByText('Sag kurz Hallo 👋')).toBeTruthy();
    expect(pushAsk).not.toHaveBeenCalled();
    await click(within(hello).getByRole('button', { name: 'Später' }));
    window.removeEventListener('jamie:push-prompt-after-join', pushAsk);
    expect(screen.queryByRole('dialog', { name: 'Du bist bei Spieleabend im Café dabei!' })).toBeNull();

    expect(groups.join).toHaveBeenCalledTimes(1);
    expect(groups.join).toHaveBeenCalledWith(5);
    expect(within(cardOf('Spieleabend im Café')).getByText('Du bist dabei')).toBeTruthy();
    expect(within(cardOf('Spieleabend im Café')).queryByRole('button', { name: 'Mitkommen' })).toBeNull();
    // The other card is untouched, the page stays.
    expect(within(cardOf('Punsch & Rave 2')).getByRole('button', { name: 'Mitkommen' })).toBeTruthy();
    expect(where()).toBe('/explore?tab=friends');
    expect(pushAsk).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('„Hallo sagen“ in that sheet opens the chat of the meetup', async () => {
    vi.mocked(groups.join).mockResolvedValueOnce({ data: { message: 'Joined group successfully', status: 'joined' } });
    const pushAsk = vi.fn();
    window.addEventListener('jamie:push-prompt-after-join', pushAsk);
    await renderHub({ going: [goingCard()] });
    await click(screen.getByRole('button', { name: 'Mitkommen' }));
    await click(screen.getByRole('button', { name: 'Hallo sagen' }));
    window.removeEventListener('jamie:push-prompt-after-join', pushAsk);
    expect(where()).toBe('/chat/5');
    expect(pushAsk).toHaveBeenCalledTimes(1);
  });

  it('„Mitkommen“ on a meetup by request: the request goes out — „Angefragt“, and no „Sag kurz Hallo“', async () => {
    vi.mocked(groups.join).mockResolvedValueOnce({ data: { message: 'Join request sent', status: 'pending' } });
    const pushAsk = vi.fn();
    window.addEventListener('jamie:push-prompt-after-join', pushAsk);
    await renderHub({ going: [goingCard()] });
    await click(screen.getByRole('button', { name: 'Mitkommen' }));
    window.removeEventListener('jamie:push-prompt-after-join', pushAsk);
    expect(within(cardOf('Spieleabend im Café')).getByText('Angefragt')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mitkommen' })).toBeNull();
    expect(screen.queryByText('Sag kurz Hallo 👋')).toBeNull();
    expect(pushAsk).toHaveBeenCalledTimes(1);
  });

  it('already in it, or already asked: the card says so right away — nothing to tap', async () => {
    await renderHub({ going: [goingCard({ my_status: 'member' }), goingCard({ id: 6, name: 'Punsch & Rave 2', my_status: 'requested' })] });
    expect(within(cardOf('Spieleabend im Café')).getByText('Du bist dabei')).toBeTruthy();
    expect(within(cardOf('Punsch & Rave 2')).getByText('Angefragt')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mitkommen' })).toBeNull();
  });

  it('at the daily limit: the „Tageslimit erreicht“ sheet — the same as in the group — and the card stays', async () => {
    vi.mocked(groups.join).mockRejectedValueOnce({ response: { status: 403, data: {
      code: 'DAILY_JOIN_LIMIT', limit: 2, error: 'Du hast dein Tageslimit erreicht.' } } });
    await renderHub({ going: [goingCard()] });
    await click(screen.getByRole('button', { name: 'Mitkommen' }));
    const sheet = screen.getByRole('dialog', { name: 'Tageslimit erreicht' });
    expect(within(sheet).getByText(/So bleibt JAMIE aktiv, persönlich und relevant\. Sieh dir Gruppen genau an/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mitkommen' })).toBeTruthy();
    expect(screen.queryByText('Sag kurz Hallo 👋')).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
    // (the ✕ and the link under the sheet carry the same name)
    await click(within(sheet).getAllByRole('button', { name: 'Morgen wieder dabei' })[0]);
    expect(screen.queryByRole('dialog', { name: 'Tageslimit erreicht' })).toBeNull();
  });

  it('no profile picture: the avatar prompt — before asking the server, and on its 403 requiresAvatar', async () => {
    const noPic = await renderHub({ user: { id: 9, name: 'Ich', avatar_url: null }, going: [goingCard()] });
    await click(screen.getByRole('button', { name: 'Mitkommen' }));
    expect(groups.join).not.toHaveBeenCalled();
    expect(document.querySelector('.avatar-gate-sheet')).toBeTruthy();
    noPic.unmount();

    vi.mocked(groups.join).mockRejectedValueOnce({ response: { status: 403, data: {
      requiresAvatar: true, error: 'Bitte lade zuerst ein Profilbild hoch, um beizutreten.' } } });
    await renderHub({ going: [goingCard()] });
    await click(screen.getByRole('button', { name: 'Mitkommen' }));
    expect(groups.join).toHaveBeenCalledWith(5);
    expect(document.querySelector('.avatar-gate-sheet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mitkommen' })).toBeTruthy();
    expect(screen.queryByText('Sag kurz Hallo 👋')).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a stale card is no error: a request that is already open → „Angefragt“, already a member → „Du bist dabei“', async () => {
    vi.mocked(groups.join)
      .mockRejectedValueOnce({ response: { status: 400, data: { error: 'Beitrittsanfrage bereits ausstehend', code: 'JOIN_REQUEST_PENDING' } } })
      .mockRejectedValueOnce({ response: { status: 400, data: { error: 'Already a member' } } });
    await renderHub({ going: [goingCard(), goingCard({ id: 6, name: 'Punsch & Rave 2' })] });
    await click(within(cardOf('Spieleabend im Café')).getByRole('button', { name: 'Mitkommen' }));
    expect(within(cardOf('Spieleabend im Café')).getByText('Angefragt')).toBeTruthy();
    await click(within(cardOf('Punsch & Rave 2')).getByRole('button', { name: 'Mitkommen' }));
    expect(within(cardOf('Punsch & Rave 2')).getByText('Du bist dabei')).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('any other refusal: the server\'s sentence as a toast, the button stays', async () => {
    vi.mocked(groups.join).mockRejectedValueOnce({ response: { status: 400, data: { error: 'Die Gruppe ist bereits voll' } } });
    await renderHub({ going: [goingCard()] });
    await click(screen.getByRole('button', { name: 'Mitkommen' }));
    expect(toast.error).toHaveBeenCalledWith('Die Gruppe ist bereits voll');
    expect(screen.getByRole('button', { name: 'Mitkommen' })).toBeTruthy();
  });
});

describe('Friends page — „Deine Freunde“', () => {
  const shownNames = () => [...document.querySelectorAll('.fh-friend-name')].map((n) => n.firstChild.textContent);

  it('three random friends — drawn anew every time the page opens', async () => {
    expect(FRIENDS_SHOWN).toBe(3);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const first = await renderHub();
    expect(screen.getByRole('heading', { name: 'Deine Freunde' })).toBeTruthy();
    expect(shownNames()).toEqual(['Tim', 'Laura', 'Fynn']);
    first.unmount();

    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    await renderHub();
    expect(shownNames()).toEqual(['Paul', 'Tim', 'Laura']);
    // The age sits beside the name, as everywhere.
    expect(document.querySelector('.fh-friend-name sup').textContent).toBe(String(FIVE[4].age));
  });

  it('a tap on a friend opens the profile', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await renderHub();
    await click(screen.getByText('Laura'));
    expect(screen.getByText('PROFILE')).toBeTruthy();
    expect(where()).toBe('/user/22');
  });

  it('„Alle ansehen“ opens the whole list — the page as it was — and the arrow leads back', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await renderHub({ going: [goingCard()], pending: [{ id: 1 }] });
    await click(screen.getByRole('button', { name: 'Alle ansehen' }));
    expect(where()).toBe('/explore?tab=friends&view=all');
    // Everybody, with the place under the name; none of the new sections.
    for (const f of FIVE) expect(screen.getByText(f.name)).toBeTruthy();
    expect(document.querySelectorAll('.ef-friends-row')).toHaveLength(5);
    expect(screen.getAllByText('Wien')).toHaveLength(5);
    expect(screen.queryByText('Deine Freunde')).toBeNull();
    expect(screen.queryByText('Wo gehen deine Freunde hin? 🎉')).toBeNull();
    expect(screen.queryByText(/neue Freundschaftsanfrage/)).toBeNull();
    // Heading, ⊕ and search are the same.
    expect(screen.getByRole('heading', { name: 'Friends' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Friends hinzufügen' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Nach Namen suchen…')).toBeTruthy();

    await click(screen.getByRole('button', { name: 'Zurück' }));
    expect(where()).toBe('/explore?tab=friends');
    expect(screen.getByText('Deine Freunde')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Zurück' })).toBeNull();
  });

  it('Android\'s back key (one step back in the history) leads from the whole list to the new page', async () => {
    await renderHub();
    await click(screen.getByRole('button', { name: 'Alle ansehen' }));
    expect(where()).toBe('/explore?tab=friends&view=all');
    await click(screen.getByTestId('hardware-back'));
    expect(where()).toBe('/explore?tab=friends');
    expect(screen.getByText('Deine Freunde')).toBeTruthy();
  });

  it('…also after a look at a profile from the whole list', async () => {
    await renderHub();
    await click(screen.getByRole('button', { name: 'Alle ansehen' }));
    await click(screen.getByText('Nora'));
    expect(where()).toBe('/user/24');
    await click(screen.getByTestId('hardware-back'));
    expect(where()).toBe('/explore?tab=friends&view=all');
    await click(screen.getByRole('button', { name: 'Zurück' }));
    expect(where()).toBe('/explore?tab=friends');
  });

  it('the whole list opened by a link: the arrow drops the view instead of leaving the app\'s history', async () => {
    await renderHub({ path: '/explore?tab=friends&view=all' });
    expect(document.querySelectorAll('.ef-friends-row')).toHaveLength(5);
    await click(screen.getByRole('button', { name: 'Zurück' }));
    expect(where()).toBe('/explore?tab=friends');
    expect(screen.getByText('Deine Freunde')).toBeTruthy();
  });

  it('without friends: the empty state as before, and nothing to „Alle ansehen“', async () => {
    await renderHub({ friendList: [] });
    expect(screen.getByRole('heading', { name: 'Deine Freunde' })).toBeTruthy();
    expect(screen.getByText('Hier fehlen noch deine Friends!')).toBeTruthy();
    expect(screen.getByText('Ihr wart schon gemeinsam unterwegs. Zeit, euch zu vernetzen!')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Alle ansehen' })).toBeNull();
  });

  // „Ihr wart schon gemeinsam unterwegs“ right above „Nimm bei deinem ersten
  // Treffen oder Event teil“ would contradict itself.
  it('without friends AND without a shared meetup: the empty state drops its second line', async () => {
    await renderHub({ friendList: [], people: { people: [], has_shared: false } });
    expect(screen.getByText('Hier fehlen noch deine Friends!')).toBeTruthy();
    expect(screen.queryByText('Ihr wart schon gemeinsam unterwegs. Zeit, euch zu vernetzen!')).toBeNull();
    expect(screen.getByText('Nimm bei deinem ersten Treffen oder Event teil, um Vorschläge zu erhalten')).toBeTruthy();
  });

  it('fewer than three friends: all of them', async () => {
    await renderHub({ friendList: FIVE.slice(0, 2) });
    expect(shownNames().sort()).toEqual(['Laura', 'Tim']);
    expect(screen.getByRole('button', { name: 'Alle ansehen' })).toBeTruthy();
  });
});

describe('Friends page — „Leute, die du kennen könntest“', () => {
  it('a card: picture, name with the age, „War mit dir bei Kochabend“ and „Anfrage senden“', async () => {
    await renderHub({ people: { people: [person(), person({ id: 32, name: 'Jonas', age: 23, event_name: 'Wanderung auf den Schneeberg', avatar_url: '/media/jonas.webp' })], has_shared: true } });
    expect(screen.getByRole('heading', { name: 'Leute, die du kennen könntest' })).toBeTruthy();
    const mara = cardOf('War mit dir bei Kochabend');
    expect(mara.querySelector('.fh-person-name').firstChild.textContent).toBe('Mara');
    expect(mara.querySelector('.fh-person-name sup').textContent).toBe('22');
    expect(mara.querySelector('.fh-person-av').textContent).toBe('M');
    expect(within(mara).getByRole('button', { name: 'Anfrage senden' })).toBeTruthy();
    const jonas = cardOf('War mit dir bei Wanderung auf den Schneeberg');
    expect(jonas.querySelector('.fh-person-av img').getAttribute('src')).toContain('jonas.webp');
  });

  it('„Anfrage senden“ is the one friendship flow — afterwards the card reads „Angefragt“', async () => {
    vi.mocked(friends.sendRequest).mockResolvedValueOnce({ data: { message: 'Friend request sent' } });
    await renderHub({ people: { people: [person(), person({ id: 32, name: 'Jonas' })], has_shared: true } });
    const mara = cardOf('Mara');
    await click(within(mara).getByRole('button', { name: 'Anfrage senden' }));
    expect(friends.sendRequest).toHaveBeenCalledTimes(1);
    expect(friends.sendRequest).toHaveBeenCalledWith(31);
    expect(within(cardOf('Mara')).getByText('Angefragt')).toBeTruthy();
    expect(within(cardOf('Mara')).queryByRole('button', { name: 'Anfrage senden' })).toBeNull();
    expect(within(cardOf('Jonas')).getByRole('button', { name: 'Anfrage senden' })).toBeTruthy();
  });

  it('the 6th request of the day: the „Tageslimit erreicht“ sheet, the card is back at „Anfrage senden“', async () => {
    vi.mocked(friends.sendRequest).mockRejectedValueOnce({ response: { status: 403, data: {
      code: 'DAILY_FRIEND_LIMIT', limit: 5, error: 'Du hast heute schon 5 Freundschaftsanfragen geschickt.' } } });
    await renderHub({ people: { people: [person()], has_shared: true } });
    await click(screen.getByRole('button', { name: 'Anfrage senden' }));
    expect(screen.getByRole('dialog', { name: 'Tageslimit erreicht' })).toBeTruthy();
    expect(screen.getByText(/Du hast heute schon 5 Leute angefragt/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Anfrage senden' })).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a failed request rolls the card back and says so', async () => {
    vi.mocked(friends.sendRequest).mockRejectedValueOnce({ response: { status: 500, data: { error: 'Interner Serverfehler' } } });
    await renderHub({ people: { people: [person()], has_shared: true } });
    await click(screen.getByRole('button', { name: 'Anfrage senden' }));
    expect(screen.getByRole('button', { name: 'Anfrage senden' })).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith('Anfrage konnte nicht gesendet werden.');
  });

  it('a tap on the person opens the profile', async () => {
    await renderHub({ people: { people: [person()], has_shared: true } });
    await click(screen.getByText('Mara'));
    expect(where()).toBe('/user/31');
    expect(friends.sendRequest).not.toHaveBeenCalled();
  });

  it('no shared meetup yet: Tina\'s sentence instead of the cards', async () => {
    await renderHub({ people: { people: [], has_shared: false } });
    expect(screen.getByRole('heading', { name: 'Leute, die du kennen könntest' })).toBeTruthy();
    expect(screen.getByText('Nimm bei deinem ersten Treffen oder Event teil, um Vorschläge zu erhalten')).toBeTruthy();
    expect(document.querySelector('.fh-person-card')).toBeNull();
  });

  it('shared meetups but nobody left to suggest, or a failed load: no section — the sentence would be wrong', async () => {
    const none = await renderHub({ people: { people: [], has_shared: true } });
    expect(screen.queryByText('Leute, die du kennen könntest')).toBeNull();
    expect(screen.queryByText(/Nimm bei deinem ersten Treffen/)).toBeNull();
    none.unmount();

    const failed = await renderHub({ people: new Error('down') });
    expect(screen.queryByText('Leute, die du kennen könntest')).toBeNull();
    expect(screen.queryByText(/Nimm bei deinem ersten Treffen/)).toBeNull();
    failed.unmount();

    // A server answer in the failure shape (200 with has_shared null).
    await renderHub({ people: { people: [], has_shared: null } });
    expect(screen.queryByText('Leute, die du kennen könntest')).toBeNull();
    expect(screen.getByText('Deine Freunde')).toBeTruthy();
  });
});

describe('Friends page — the sections and the search', () => {
  it('the order on the page: bar, where friends go, your friends, people you may know', async () => {
    await renderHub({
      pending: [{ id: 1 }], going: [goingCard()],
      people: { people: [person()], has_shared: true },
    });
    const hub = document.querySelector('.fh');
    const order = [...hub.children].map((el) => (el.classList.contains('fh-requests')
      ? 'bar' : el.querySelector('h3')?.textContent));
    expect(order).toEqual(['bar', 'Wo gehen deine Freunde hin? 🎉', 'Deine Freunde', 'Leute, die du kennen könntest']);
    expect(friends.getGoing).toHaveBeenCalledTimes(1);
    expect(friends.getPeople).toHaveBeenCalledTimes(1);
    expect(friends.getPending).toHaveBeenCalledTimes(1);
    // The ⊕ sheet's own list is not loaded for the page.
    expect(friends.getSuggestions).not.toHaveBeenCalled();
  });

  it('a search replaces the sections while it is open', async () => {
    vi.mocked(users.search).mockResolvedValue({ data: [{ id: 4, name: 'Lena', friend_status: 'none' }] });
    await renderHub({ pending: [{ id: 1 }], going: [goingCard()] });
    fireEvent.change(screen.getByPlaceholderText('Nach Namen suchen…'), { target: { value: 'Len' } });
    expect(document.querySelector('.fh')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Nach Namen suchen…'), { target: { value: '' } });
    expect(document.querySelector('.fh')).toBeTruthy();
    expect(screen.getByText('Spieleabend im Café')).toBeTruthy();
    // …without loading the lists again.
    expect(friends.getGoing).toHaveBeenCalledTimes(1);
  });
});

// jsdom has no layout: what keeps the page from scrolling sideways is pinned
// on the declarations (cf. profileCardWidth.test.js).
describe('friends-hub.css — the card rows scroll in themselves', () => {
  const css = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles/friends-hub.css'), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector) => {
    const m = css.match(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
    if (!m) throw new Error(`${selector} not found`);
    return Object.fromEntries(m[2].split(';').map((d) => d.trim()).filter(Boolean)
      .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]));
  };

  it('the row is its own sideways scroller, snapping inside its 16px padding', () => {
    const rail = rule('.fh-rail');
    expect(rail['overflow-x']).toBe('auto');
    expect(rail.display).toBe('flex');
    expect(rail['scroll-snap-type']).toBe('x proximity');
    expect(rail['scroll-padding-inline']).toBe('16px');
    expect(rail.padding).toBe('0 16px 2px');
  });

  it('a card keeps its 140px — about two and a half in view at 390px — and never grows with a long name', () => {
    const card = rule('.fh-going-card,\n.fh-person-card');
    expect(card.flex).toBe('0 0 140px');
    expect(card['min-width']).toBe('0');
    expect(rule('.fh-going-name')['-webkit-line-clamp']).toBe('2');
    expect(rule('.fh-going-first')['text-overflow']).toBe('ellipsis');
    expect(rule('.fh-going-more')['flex-shrink']).toBe('0');
    expect(rule('.fh-person-with')['-webkit-line-clamp']).toBe('2');
  });

  it('„Alle ansehen“ is underlined, in the light lilac', () => {
    const link = rule('.fh-see-all');
    expect(link['text-decoration']).toBe('underline');
    expect(link.color).toBe('var(--fh-lilac)');
    expect(rule('.fh-people-empty').color).toBe('var(--fh-lilac)');
  });
});

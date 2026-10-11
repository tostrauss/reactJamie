import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Keys plus their interpolation values, so plural counts and placeholders
    // are visible in assertions. A call WITH defaultValue is serverErrorMessage
    // probing errors.<CODE> — answer it like i18next does for a missing key.
    t: (key, opts) => {
      if (opts && 'defaultValue' in opts) return opts.defaultValue;
      if (!opts) return key;
      return `${key}(${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',')})`;
    },
    i18n: { language: 'de', resolvedLanguage: 'de' },
  }),
}));
vi.mock('../utils/api', () => ({
  admin: { getFeaturedClubs: vi.fn(), setFeaturedClubs: vi.fn() },
  clubs: { getAll: vi.fn() },
}));

const { admin, clubs } = await import('../utils/api');
const { AdminFeaturedClubsSection } = await import('../components/AdminFeaturedClubsSection');

// The admin GET/PUT row shape (featuredClubController ADMIN_SQL).
const row = (id, name, extra = {}) => ({
  position: id, id, name, image_url: null, location: 'Wien', members_count: 10 * id, is_private: false,
  approval_status: 'approved', is_active: true, is_deleted: false, alive: true, ...extra,
});
const OFFICIAL = row(1, 'JAMIE Groups Official', { members_count: 128 });
const LAUF = row(2, 'Laufclub Prater', { is_private: true });
const BRETT = row(3, 'Brettspiel-Treff');
const SERVER_LIST = [OFFICIAL, LAUF, BRETT];

const httpError = (status, data) => Object.assign(new Error(String(status)), { response: { status, data } });

// The visible order of the curated list, by club name (the name span is what
// the row's buttons point at with aria-describedby).
const order = (container) => [...container.querySelectorAll('ol > li span[id*="-name-"]')].map((s) => s.textContent);

const saveButton = (getByText) => getByText(/^admin\.featuredClubs\.(save|saving)$/).closest('button');

async function renderLoaded(list = SERVER_LIST, max = 20) {
  vi.mocked(admin.getFeaturedClubs).mockResolvedValue({ data: { clubs: list, max } });
  const utils = render(<AdminFeaturedClubsSection />);
  if (list.length) await utils.findByText(list[0].name);
  else await utils.findByText('admin.featuredClubs.empty');
  return utils;
}

beforeEach(() => {
  vi.mocked(admin.getFeaturedClubs).mockReset();
  vi.mocked(admin.setFeaturedClubs).mockReset();
  vi.mocked(clubs.getAll).mockReset();
});

describe('AdminFeaturedClubsSection — "wir sortieren Clubs im Admin-Dashboard"', () => {
  it('renders the server order with position, members, a lock for private clubs and the count', async () => {
    const { container, getByRole, getByText } = await renderLoaded();
    expect(order(container)).toEqual(['JAMIE Groups Official', 'Laufclub Prater', 'Brettspiel-Treff']);
    const first = container.querySelector('ol > li');
    expect(first.textContent).toContain('1');
    expect(first.textContent).toContain('admin.featuredClubs.members(count=128) · Wien');
    // exactly one private club → exactly one lock, with a spoken label
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(1);
    const lock = getByRole('img', { name: 'groups.card.privateBadge' });
    // glued to the name by a no-break space, so it never dangles alone on a line
    expect(lock.parentElement.textContent).toBe('Laufclub Prater 🔒');
    expect(getByText('admin.featuredClubs.title (3/20)')).toBeTruthy();
    // nothing changed yet → nothing to save
    expect(saveButton(getByText).disabled).toBe(true);
  });

  it('flags curated clubs that no longer reach new users (not approved / inactive)', async () => {
    const { container } = await renderLoaded([
      OFFICIAL,
      row(7, 'Abgelehnter Club', { approval_status: 'rejected', is_active: false, alive: false }),
      row(8, 'Gelöschter Club', { is_deleted: true, is_active: false, alive: false }),
    ]);
    const [ok, rejected, deleted] = container.querySelectorAll('ol > li');
    expect(ok.textContent).not.toContain('⚠');
    expect(rejected.textContent).toContain('⚠ admin.featuredClubs.notApproved');
    expect(rejected.textContent).toContain('⚠ admin.featuredClubs.inactive');
    expect(deleted.textContent).toContain('⚠ admin.featuredClubs.inactive');
    expect(deleted.textContent).not.toContain('notApproved');
  });

  it('↑/↓ reorder locally; the first ↑ and the last ↓ are disabled; 44px targets with labels', async () => {
    const { container, getAllByLabelText } = await renderLoaded();
    const ups = getAllByLabelText('admin.featuredClubs.moveUp');
    const downs = getAllByLabelText('admin.featuredClubs.moveDown');
    expect(ups).toHaveLength(3);
    expect(ups[0].disabled).toBe(true);
    expect(downs[2].disabled).toBe(true);
    expect(ups[0].style.width).toBe('44px');
    expect(ups[0].style.height).toBe('44px');
    // the arrow is announced with the club it moves
    expect(document.getElementById(ups[1].getAttribute('aria-describedby')).textContent).toBe('Laufclub Prater');

    fireEvent.click(downs[0]);
    expect(order(container)).toEqual(['Laufclub Prater', 'JAMIE Groups Official', 'Brettspiel-Treff']);
    fireEvent.click(getAllByLabelText('admin.featuredClubs.moveUp')[2]);
    expect(order(container)).toEqual(['Laufclub Prater', 'Brettspiel-Treff', 'JAMIE Groups Official']);
  });

  it('keyboard focus follows the moved club (and hops to the other arrow at the end of the list)', async () => {
    const { getAllByLabelText } = await renderLoaded();
    const down = getAllByLabelText('admin.featuredClubs.moveDown')[0];   // JAMIE Groups Official
    down.focus();
    fireEvent.click(down);
    const describedName = () => document.getElementById(document.activeElement.getAttribute('aria-describedby'))?.textContent;
    expect(document.activeElement.getAttribute('aria-label')).toBe('admin.featuredClubs.moveDown');
    expect(describedName()).toBe('JAMIE Groups Official');

    fireEvent.click(document.activeElement);                               // now last → its ↓ is disabled
    expect(document.activeElement.getAttribute('aria-label')).toBe('admin.featuredClubs.moveUp');
    expect(describedName()).toBe('JAMIE Groups Official');
  });

  it('save sends the ids in the new order and renders the committed answer', async () => {
    const { container, getAllByLabelText, getByText, findByText } = await renderLoaded();
    fireEvent.click(getAllByLabelText('admin.featuredClubs.moveDown')[0]);   // 2,1,3
    expect(saveButton(getByText).disabled).toBe(false);

    // The server answers with its read-back — here with a fresher member count.
    vi.mocked(admin.setFeaturedClubs).mockResolvedValue({ data: {
      clubs: [{ ...LAUF, position: 1 }, { ...OFFICIAL, position: 2, members_count: 129 }, BRETT], max: 20,
    } });
    await act(async () => { fireEvent.click(saveButton(getByText)); });

    expect(admin.setFeaturedClubs).toHaveBeenCalledTimes(1);
    expect(admin.setFeaturedClubs).toHaveBeenCalledWith([2, 1, 3]);
    expect(await findByText('admin.featuredClubs.saved')).toBeTruthy();
    expect(container.textContent).toContain('admin.featuredClubs.members(count=129)');
    expect(saveButton(getByText).disabled).toBe(true);
  });

  it('moving a club down and back up leaves nothing to save', async () => {
    const { getAllByLabelText, getByText } = await renderLoaded();
    fireEvent.click(getAllByLabelText('admin.featuredClubs.moveDown')[0]);
    expect(saveButton(getByText).disabled).toBe(false);
    fireEvent.click(getAllByLabelText('admin.featuredClubs.moveUp')[1]);
    expect(saveButton(getByText).disabled).toBe(true);
  });

  it('✕ removes locally; removing every club saves [] (the onboarding page is then skipped)', async () => {
    const { container, getAllByLabelText, getByText, findByText } = await renderLoaded();
    for (let i = 0; i < 3; i++) fireEvent.click(getAllByLabelText('admin.featuredClubs.remove')[0]);
    expect(container.querySelector('ol')).toBeNull();
    expect(getByText('admin.featuredClubs.empty')).toBeTruthy();
    vi.mocked(admin.setFeaturedClubs).mockResolvedValue({ data: { clubs: [], max: 20 } });
    await act(async () => { fireEvent.click(saveButton(getByText)); });
    expect(admin.setFeaturedClubs).toHaveBeenCalledWith([]);
    expect(await findByText('admin.featuredClubs.saved')).toBeTruthy();
  });

  it('search offers approved clubs only, adds a club once, and the save carries it at the end', async () => {
    const STADT = { id: 4, name: 'Stadtführung Club', approval_status: 'approved', is_active: true, members_count: 5, location: 'Graz', is_private: false };
    vi.mocked(clubs.getAll).mockResolvedValue({ data: [
      STADT,
      { id: 5, name: 'Wartender Club', approval_status: 'pending', is_active: true, members_count: 1 },
      { ...OFFICIAL, approval_status: 'approved' },
    ] });
    const { container, getByLabelText, findByText, queryByText, getByText } = await renderLoaded();

    fireEvent.change(getByLabelText('admin.featuredClubs.searchPlaceholder'), { target: { value: '  club ' } });
    expect(await findByText('Stadtführung Club')).toBeTruthy();
    expect(clubs.getAll).toHaveBeenCalledWith({ search: 'club', limit: 20 });
    expect(queryByText('Wartender Club')).toBeNull();          // pending → never offered

    const resultList = container.querySelector('ul');
    // already curated → shown, but as "schon in der Liste", not addable
    const official = [...resultList.querySelectorAll('li')].find((li) => li.textContent.includes('JAMIE Groups Official'));
    const officialBtn = official.querySelector('button');
    expect(officialBtn.disabled).toBe(true);
    expect(officialBtn.getAttribute('aria-label')).toBe('admin.featuredClubs.alreadyAdded');

    const addBtn = [...resultList.querySelectorAll('li')].find((li) => li.textContent.includes('Stadtführung')).querySelector('button');
    expect(addBtn.getAttribute('aria-label')).toBe('admin.featuredClubs.add');
    fireEvent.click(addBtn);
    fireEvent.click(addBtn);                                      // a second tap must not add it twice
    expect(order(container)).toEqual(['JAMIE Groups Official', 'Laufclub Prater', 'Brettspiel-Treff', 'Stadtführung Club']);
    expect(addBtn.disabled).toBe(true);
    expect(getByText('admin.featuredClubs.title (4/20)')).toBeTruthy();

    vi.mocked(admin.setFeaturedClubs).mockResolvedValue({ data: { clubs: [...SERVER_LIST, row(4, 'Stadtführung Club')], max: 20 } });
    await act(async () => { fireEvent.click(saveButton(getByText)); });
    expect(admin.setFeaturedClubs).toHaveBeenCalledWith([1, 2, 3, 4]);
  });

  it('an older search answer never overwrites a newer one', async () => {
    let resolveFirst;
    vi.mocked(clubs.getAll)
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce({ data: [{ id: 9, name: 'Jamie Lauftreff', approval_status: 'approved', is_active: true }] });
    const { getByLabelText, findByText, queryByText } = await renderLoaded();
    const input = getByLabelText('admin.featuredClubs.searchPlaceholder');

    fireEvent.change(input, { target: { value: 'j' } });
    await waitFor(() => expect(clubs.getAll).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: 'jamie lauf' } });
    expect(await findByText('Jamie Lauftreff')).toBeTruthy();
    await act(async () => { resolveFirst({ data: [{ id: 10, name: 'Judo Club', approval_status: 'approved', is_active: true }] }); });
    expect(queryByText('Judo Club')).toBeNull();
    expect(queryByText('Jamie Lauftreff')).toBeTruthy();
  });

  it('says so when a search finds nothing addable', async () => {
    vi.mocked(clubs.getAll).mockResolvedValue({ data: [{ id: 5, name: 'Wartender Club', approval_status: 'pending' }] });
    const { getByLabelText, findByText } = await renderLoaded();
    fireEvent.change(getByLabelText('admin.featuredClubs.searchPlaceholder'), { target: { value: 'wart' } });
    expect(await findByText('admin.featuredClubs.noResults')).toBeTruthy();
  });

  it('at the maximum nothing more can be added', async () => {
    vi.mocked(clubs.getAll).mockResolvedValue({ data: [{ id: 4, name: 'Stadtführung Club', approval_status: 'approved', is_active: true }] });
    const { container, getByLabelText, findByText, getByText } = await renderLoaded([OFFICIAL, LAUF], 2);
    expect(getByText('admin.featuredClubs.maxReached(max=2)')).toBeTruthy();
    fireEvent.change(getByLabelText('admin.featuredClubs.searchPlaceholder'), { target: { value: 'stadt' } });
    await findByText('Stadtführung Club');
    const addBtn = container.querySelector('ul li button');
    expect(addBtn.disabled).toBe(true);
    fireEvent.click(addBtn);
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
  });

  it('FEATURED_INVALID_CLUBS marks and names the refused clubs; removing them clears the hint', async () => {
    const { container, getAllByLabelText, getByText, findByRole, queryByRole } = await renderLoaded();
    fireEvent.click(getAllByLabelText('admin.featuredClubs.moveDown')[0]);
    vi.mocked(admin.setFeaturedClubs).mockRejectedValue(httpError(400, {
      error: 'Diese Clubs sind nicht freigegeben oder nicht mehr aktiv.', code: 'FEATURED_INVALID_CLUBS', invalidIds: [3],
    }));
    await act(async () => { fireEvent.click(saveButton(getByText)); });

    const alert = await findByRole('alert');
    expect(alert.textContent).toBe('admin.featuredClubs.saveError – admin.featuredClubs.invalidClubs(names=Brettspiel-Treff)');
    const refused = container.querySelectorAll('ol > li[data-refused="true"]');
    expect(refused).toHaveLength(1);
    expect(refused[0].textContent).toContain('Brettspiel-Treff');

    // a reorder keeps the hint — the refused club is still the reason
    fireEvent.click(getAllByLabelText('admin.featuredClubs.moveDown')[0]);
    expect(queryByRole('alert')).not.toBeNull();
    const brettRemove = [...container.querySelectorAll('ol > li')]
      .find((li) => li.textContent.includes('Brettspiel-Treff'))
      .querySelector('button[aria-label="admin.featuredClubs.remove"]');
    fireEvent.click(brettRemove);
    expect(queryByRole('alert')).toBeNull();
    expect(container.querySelectorAll('ol > li[data-refused="true"]')).toHaveLength(0);
  });

  it('a coded save error shows the server sentence; a bare 500 only the plain line', async () => {
    const { getAllByLabelText, getByText, findByRole } = await renderLoaded();
    fireEvent.click(getAllByLabelText('admin.featuredClubs.moveDown')[0]);
    vi.mocked(admin.setFeaturedClubs).mockRejectedValueOnce(httpError(503, {
      error: 'Die Club-Auswahl ist gleich wieder verfügbar.', code: 'FEATURED_UNAVAILABLE',
    }));
    await act(async () => { fireEvent.click(saveButton(getByText)); });
    expect((await findByRole('alert')).textContent)
      .toBe('admin.featuredClubs.saveError – Die Club-Auswahl ist gleich wieder verfügbar.');

    vi.mocked(admin.setFeaturedClubs).mockRejectedValueOnce(httpError(500, { error: 'Internal server error' }));
    await act(async () => { fireEvent.click(saveButton(getByText)); });
    expect((await findByRole('alert')).textContent).toBe('admin.featuredClubs.saveError');
    // still dirty → the admin can simply try again
    expect(saveButton(getByText).disabled).toBe(false);
  });

  it.each([404, 503])('renders nothing when the list cannot exist on this server (%i)', async (status) => {
    vi.mocked(admin.getFeaturedClubs).mockRejectedValue(httpError(status, { error: 'x' }));
    const { container } = render(<AdminFeaturedClubsSection />);
    await waitFor(() => expect(admin.getFeaturedClubs).toHaveBeenCalled());
    await act(async () => {});
    expect(container.innerHTML).toBe('');
  });

  it('any other load failure is shown with a retry instead of silently hiding the list', async () => {
    vi.mocked(admin.getFeaturedClubs)
      .mockRejectedValueOnce(httpError(500, { error: 'Internal server error' }))
      .mockResolvedValueOnce({ data: { clubs: SERVER_LIST, max: 20 } });
    const { findByRole, getByText, findByText } = render(<AdminFeaturedClubsSection />);
    expect((await findByRole('alert')).textContent).toBe('admin.errorLoad');
    await act(async () => { fireEvent.click(getByText('admin.refresh')); });
    expect(await findByText('JAMIE Groups Official')).toBeTruthy();
    expect(admin.getFeaturedClubs).toHaveBeenCalledTimes(2);
  });
});

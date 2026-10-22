import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// The Entdecken tab after the Community/Club split (Tina, 22.10.2026).
// What this pins down: the tab keeps its URL value, each segment asks the
// server for its own club_type, the community search is server-side and only
// fires from 2 characters, a community card offers no way to join, and the
// deals block sits above the club list.
const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      if (!opts) return key;
      if ('count' in opts) return `${key}(${opts.count})`;
      if ('query' in opts) return `${key}(${opts.query})`;
      if ('category' in opts) return `${key}(${opts.category})`;
      return key;
    },
    i18n: { language: 'de', resolvedLanguage: 'de' },
  }),
}));

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../hooks/useOnPullRefresh', () => ({ default: () => {} }));
vi.mock('../components/MapView', () => ({ MapView: () => null, default: () => null }));
vi.mock('../components/MapErrorBoundary', () => ({ MapErrorBoundary: ({ children }) => children }));
vi.mock('../components/NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('../components/JamieWordmark', () => ({ JamieWordmark: () => null }));
vi.mock('../components/AvatarGateModal', () => ({ default: () => null }));

vi.mock('../utils/api', () => {
  const get = vi.fn(async () => ({ data: [] }));
  return {
    default: { get },
    groups: {
      getFavorites: vi.fn(async () => ({ data: [] })),
      getJoined: vi.fn(async () => ({ data: [] })),
      toggleFavorite: vi.fn(), join: vi.fn(), joinWaitlist: vi.fn(), leaveWaitlist: vi.fn(),
    },
    clubs: {
      getAll: vi.fn(async () => ({ data: [] })),
      getJoined: vi.fn(async () => ({ data: [] })),
      getFavorites: vi.fn(async () => ({ data: [] })),
      toggleFavorite: vi.fn(), join: vi.fn(),
    },
    deals: { getAll: vi.fn(async () => ({ data: [] })) },
    notifications: { getUnreadCount: vi.fn(async () => ({ data: { count: 0 } })) },
  };
});

const { clubs, deals } = await import('../utils/api');
const { Home } = await import('../pages/Home');

const community = (id, name, extra = {}) => ({
  id, name, type: 'club', club_type: 'community', members_count: 12,
  category: 'Laufen', categories: ['Laufen'], image_url: null, is_private: false, ...extra,
});
const official = (id, name, extra = {}) => ({
  id, name, type: 'club', club_type: 'official', members_count: 400,
  category: 'Bar', category_label: 'Bar · Nightlife', image_url: null, ...extra,
});
const deal = (id) => ({
  id, name: 'Café Concerto', category: 'Bar', deal_label: '-20%',
  description: '20% auf alle Cocktails', address: '1010 Wien', photos: [],
});

// A finished profile, so Home renders the feed instead of a profile banner.
const USER = {
  id: 7, name: 'Tina', date_of_birth: '1994-05-12',
  onboarding_completed: true, avatar_url: '/media/uploads/a.webp',
};

const renderHome = (search = '?tab=clubs') => render(
  <AuthContext.Provider value={{ user: USER }}>
    <MemoryRouter initialEntries={[`/home${search}`]}>
      <Home />
    </MemoryRouter>
  </AuthContext.Provider>,
);

// The club_type each GET /clubs call asked for.
const requestedTypes = () => vi.mocked(clubs.getAll).mock.calls.map((c) => c[0]?.club_type);

beforeEach(() => {
  cleanup();
  navigate.mockReset();
  vi.mocked(clubs.getAll).mockReset().mockResolvedValue({ data: [] });
  vi.mocked(clubs.getJoined).mockReset().mockResolvedValue({ data: [] });
  vi.mocked(clubs.getFavorites).mockReset().mockResolvedValue({ data: [] });
  vi.mocked(deals.getAll).mockReset().mockResolvedValue({ data: [] });
});

describe('Entdecken — segments', () => {
  it('defaults to the Communities segment and asks the server for it', async () => {
    vi.mocked(clubs.getAll).mockResolvedValue({ data: [community(1, 'Laufclub Prater')] });
    const { findByText } = renderHome();
    await findByText('Laufclub Prater');
    expect(requestedTypes()).toEqual(['community']);
  });

  it('switching to Clubs refetches with club_type=official', async () => {
    vi.mocked(clubs.getAll).mockResolvedValue({ data: [] });
    const { findByText } = renderHome();
    const clubsPill = await findByText('home.segments.clubs');
    fireEvent.click(clubsPill);
    await waitFor(() => expect(requestedTypes()).toContain('official'));
  });

  // A community and an official club must never show up in the same list, even
  // if the server ever answered with both.
  it('never shows an official club in the Communities segment', async () => {
    vi.mocked(clubs.getAll).mockResolvedValue({
      data: [community(1, 'Laufclub Prater'), official(2, 'Café Concerto')],
    });
    const { findByText, queryByText } = renderHome();
    await findByText('Laufclub Prater');
    expect(queryByText('Café Concerto')).toBeNull();
  });

  // A club row with no club_type (old row, un-migrated database) reads as a
  // community — the same contract the server applies.
  it('treats a club without club_type as a community', async () => {
    vi.mocked(clubs.getAll).mockResolvedValue({ data: [community(3, 'Altclub', { club_type: null })] });
    const { findByText } = renderHome();
    expect(await findByText('Altclub')).toBeTruthy();
  });

  // Hyphens become U+2011 so "Bar-Hopping" cannot wrap onto two lines — the
  // same treatment GroupCard gives group titles.
  it('keeps a hyphenated name on one line', async () => {
    vi.mocked(clubs.getAll).mockResolvedValue({ data: [community(4, 'Bar-Hopping')] });
    const { container, findByText } = renderHome();
    await findByText('home.communityHero.title');
    await waitFor(() => expect(container.querySelector('.community-card-title')).toBeTruthy());
    expect(container.querySelector('.community-card-title').textContent).toBe('Bar‑Hopping');
  });

  it('shows the hero of the segment on screen', async () => {
    const { findByText } = renderHome();
    expect(await findByText('home.communityHero.title')).toBeTruthy();
    fireEvent.click(await findByText('home.segments.clubs'));
    expect(await findByText('home.clubsHero.title')).toBeTruthy();
  });
});

describe('Entdecken — community search', () => {
  it('does not search on one character', async () => {
    const { findByText, container } = renderHome();
    await findByText('home.communityHero.title');
    const before = vi.mocked(clubs.getAll).mock.calls.length;
    fireEvent.change(container.querySelector('input.clubs-search'), { target: { value: 'L' } });
    await waitFor(() => expect(container.querySelector('.clubs-search-hint')).toBeTruthy());
    expect(vi.mocked(clubs.getAll).mock.calls.length).toBe(before);
  });

  it('forwards the term to the server from two characters on', async () => {
    const { findByText, container } = renderHome();
    await findByText('home.communityHero.title');
    fireEvent.change(container.querySelector('input.clubs-search'), { target: { value: 'Lauf' } });
    await waitFor(
      () => expect(vi.mocked(clubs.getAll).mock.calls.some((c) => c[0]?.search === 'Lauf')).toBe(true),
      { timeout: 2000 },
    );
  });

  it('says so when a search found nothing', async () => {
    const { findByText, container } = renderHome();
    await findByText('home.communityHero.title');
    fireEvent.change(container.querySelector('input.clubs-search'), { target: { value: 'Zzz' } });
    expect(await findByText('home.search.noResults(Zzz)', {}, { timeout: 2000 })).toBeTruthy();
  });

  // The Clubs segment has no search box at all (Tina).
  it('has no search box in the Clubs segment', async () => {
    const { findByText, container } = renderHome();
    fireEvent.click(await findByText('home.segments.clubs'));
    await findByText('home.clubsHero.title');
    expect(container.querySelector('input.clubs-search')).toBeNull();
  });
});

describe('Entdecken — cards and rows', () => {
  it('a community card offers no way to join, only to open', async () => {
    vi.mocked(clubs.getAll).mockResolvedValue({ data: [community(1, 'Laufclub Prater')] });
    const { findByText, container } = renderHome();
    await findByText('Laufclub Prater');
    const card = container.querySelector('.community-card');
    expect(card).toBeTruthy();
    // No nested button at all: no plus tile, no "Beitreten".
    expect(card.querySelector('button')).toBeNull();
    fireEvent.click(card);
    expect(navigate).toHaveBeenCalledWith('/club/1');
  });

  it('a community card shows category, title and member count', async () => {
    vi.mocked(clubs.getAll).mockResolvedValue({ data: [community(1, 'Laufclub Prater')] });
    const { findByText, container } = renderHome();
    await findByText('Laufclub Prater');
    expect(container.querySelector('.community-card-category').textContent).toContain('Laufen');
    expect(await findByText('home.clubRow.members(12)')).toBeTruthy();
  });

  it('a club row shows the free-text category and its upcoming events', async () => {
    vi.mocked(clubs.getAll).mockResolvedValue({
      data: [official(2, 'Café Concerto', { upcoming_events_count: 3 })],
    });
    const { findByText, container } = renderHome('?tab=clubs&seg=clubs');
    await findByText('Café Concerto');
    expect(container.querySelector('.club-row-category').textContent).toBe('Bar · Nightlife');
    expect(await findByText('home.clubRow.upcomingEvents(3)')).toBeTruthy();
  });

  it('a club row falls back to the member count without events', async () => {
    vi.mocked(clubs.getAll).mockResolvedValue({ data: [official(2, 'Café Concerto')] });
    const { findByText } = renderHome('?tab=clubs&seg=clubs');
    await findByText('Café Concerto');
    expect(await findByText('home.clubRow.members(400)')).toBeTruthy();
  });

  it('the row and its button both open the club', async () => {
    vi.mocked(clubs.getAll).mockResolvedValue({ data: [official(2, 'Café Concerto')] });
    const { findByText, container } = renderHome('?tab=clubs&seg=clubs');
    await findByText('Café Concerto');
    fireEvent.click(container.querySelector('.club-row-cta'));
    expect(navigate).toHaveBeenCalledWith('/club/2');
    navigate.mockReset();
    fireEvent.click(container.querySelector('.club-row'));
    expect(navigate).toHaveBeenCalledWith('/club/2');
  });

  it('the hero CTA opens the global event discovery', async () => {
    const { findByText } = renderHome('?tab=clubs&seg=clubs');
    fireEvent.click(await findByText('home.clubEventsDiscover'));
    expect(navigate).toHaveBeenCalledWith('/events');
  });
});

describe('Entdecken — deals', () => {
  it('renders deal rows above the club list in the Clubs segment', async () => {
    vi.mocked(clubs.getAll).mockResolvedValue({ data: [official(2, 'Laufclub Wien')] });
    vi.mocked(deals.getAll).mockResolvedValue({ data: [deal(9)] });
    const { findByText, container } = renderHome('?tab=clubs&seg=clubs');
    await findByText('Laufclub Wien');
    const dealRows = container.querySelector('.deal-rows');
    const clubRows = container.querySelector('.club-rows');
    expect(dealRows).toBeTruthy();
    expect(clubRows).toBeTruthy();
    // "above" as the DOM sees it, not as CSS might reorder it.
    expect(dealRows.compareDocumentPosition(clubRows) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a deal row keeps the /deal/:id deep link', async () => {
    vi.mocked(deals.getAll).mockResolvedValue({ data: [deal(9)] });
    const { container, findByText } = renderHome('?tab=clubs&seg=clubs');
    await findByText('home.clubsHero.title');
    await waitFor(() => expect(container.querySelector('.deal-row')).toBeTruthy());
    fireEvent.click(container.querySelector('.deal-row'));
    expect(navigate).toHaveBeenCalledWith('/deal/9');
  });

  it('the Communities segment stays free of deals', async () => {
    vi.mocked(deals.getAll).mockResolvedValue({ data: [deal(9)] });
    const { findByText, container } = renderHome();
    await findByText('home.communityHero.title');
    expect(container.querySelector('.deal-row')).toBeNull();
  });
});

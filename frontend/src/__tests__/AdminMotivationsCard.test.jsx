import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => (opts ? `${key}(${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',')})` : key),
    i18n: { language: 'de', resolvedLanguage: 'de' },
  }),
}));

// Only for the AdminDashboard placement tests at the bottom: the dashboard's
// own loads, and its other self-loading sections stubbed out.
vi.mock('../utils/api', () => ({
  admin: {
    getStats: vi.fn(), getScreenTime: vi.fn(), getPendingClubs: vi.fn(), getTopClubs: vi.fn(),
    getUsers: vi.fn(), getOnlineUsers: vi.fn(),
  },
}));
vi.mock('../context/AuthContext', async () => ({ AuthContext: (await import('react')).createContext(null) }));
vi.mock('../components/AdminReportsSection', () => ({ AdminReportsSection: () => null }));
vi.mock('../components/AdminGrowthSection', () => ({ AdminGrowthSection: () => null }));
vi.mock('../components/AdminDealsSection', () => ({ AdminDealsSection: () => null }));
vi.mock('../components/AdminFeedbackSection', () => ({ AdminFeedbackSection: () => null }));
vi.mock('../components/AdminUserModal', () => ({ AdminUserModal: () => null }));
vi.mock('../components/AdminFeaturedClubsSection', () => ({ AdminFeaturedClubsSection: () => <div data-testid="featured-clubs" /> }));

const { AdminMotivationsCard } = await import('../components/AdminMotivationsCard');
const { MOTIVATION_KEYS } = await import('../utils/motivations');
const { admin } = await import('../utils/api');
const { AdminDashboard } = await import('../pages/AdminDashboard');

const rows = (container) => [...container.querySelectorAll('li[data-motivation]')];
const barWidth = (li) => li.querySelector('[aria-hidden="true"] > div').style.width;

describe('AdminMotivationsCard — "Was trifft zu?" answers on the dashboard', () => {
  it('shows how many answered and one bar per option, in allowlist order, with count and share', () => {
    const motivations = {
      answered: 40,
      counts: { new_in_town: 10, new_friends: 30, activity_partners: 0, discover_places: 20, more_active: 5 },
    };
    const { container, getByText } = render(<AdminMotivationsCard motivations={motivations} />);
    expect(getByText('admin.motivations.title')).toBeTruthy();
    // plural via {count} — and a NUMBER, or i18next would not resolve _one/_other
    expect(getByText('admin.motivations.answered(count=40)')).toBeTruthy();

    const items = rows(container);
    expect(items.map((li) => li.dataset.motivation)).toEqual([...MOTIVATION_KEYS]);
    items.forEach((li, i) => expect(li.textContent).toContain(`onboarding.goals.options.${MOTIVATION_KEYS[i]}`));

    const byKey = Object.fromEntries(items.map((li) => [li.dataset.motivation, li]));
    // multi-select: shares are of the people who answered, so they add up past 100 %
    expect(byKey.new_friends.textContent).toContain('30 · 75%');
    expect(barWidth(byKey.new_friends)).toBe('75%');
    expect(byKey.new_in_town.textContent).toContain('10 · 25%');
    expect(byKey.discover_places.textContent).toContain('20 · 50%');
    expect(byKey.more_active.textContent).toContain('5 · 13%');
    expect(barWidth(byKey.more_active)).toBe('12.5%');
    // an option nobody picked still shows its 0
    expect(byKey.activity_partners.textContent).toContain('0 · 0%');
    expect(barWidth(byKey.activity_partners)).toBe('0%');
  });

  it('nobody answered yet (fresh deploy): zeros, never NaN', () => {
    const { container, getByText } = render(
      <AdminMotivationsCard motivations={{ answered: 0, counts: Object.fromEntries(MOTIVATION_KEYS.map((k) => [k, 0])) }} />,
    );
    expect(getByText('admin.motivations.answered(count=0)')).toBeTruthy();
    expect(container.textContent).not.toContain('NaN');
    rows(container).forEach((li) => expect(barWidth(li)).toBe('0%'));
  });

  it('tolerates string counts (pg) and missing keys', () => {
    const { container, getByText } = render(
      <AdminMotivationsCard motivations={{ answered: '4', counts: { new_friends: '2' } }} />,
    );
    expect(getByText('admin.motivations.answered(count=4)')).toBeTruthy();
    const byKey = Object.fromEntries(rows(container).map((li) => [li.dataset.motivation, li]));
    expect(byKey.new_friends.textContent).toContain('2 · 50%');
    expect(byKey.new_in_town.textContent).toContain('0 · 0%');
    expect(rows(container)).toHaveLength(MOTIVATION_KEYS.length);
  });

  it.each([undefined, null])('renders nothing without the field (older server / boot window): %s', (value) => {
    const { container } = render(<AdminMotivationsCard motivations={value} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('AdminDashboard places the two onboarding blocks', () => {
  const stats = (extra = {}) => ({ data: {
    users: {}, groups: {}, deal_redemptions: {}, category_suggestions: [{ suggestion: 'Yoga', votes: 3 }], ...extra,
  } });
  const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  beforeEach(() => {
    vi.mocked(admin.getScreenTime).mockResolvedValue({ data: [] });
    vi.mocked(admin.getPendingClubs).mockResolvedValue({ data: [] });
    vi.mocked(admin.getTopClubs).mockResolvedValue({ data: [] });
    vi.mocked(admin.getUsers).mockResolvedValue({ data: { users: [], total: 0 } });
    vi.mocked(admin.getOnlineUsers).mockRejectedValue(new Error('404'));
  });

  it('clubs section right after the approval queue, motivations right after the category suggestions', async () => {
    vi.mocked(admin.getStats).mockResolvedValue(stats({ motivations: { answered: 2, counts: { new_friends: 1 } } }));
    const { findByText, getByText, getByTestId } = render(<MemoryRouter><AdminDashboard /></MemoryRouter>);

    const title = await findByText('admin.motivations.title');
    expect(getByText('admin.motivations.answered(count=2)')).toBeTruthy();   // stats.motivations reaches the card
    expect(follows(getByText('admin.sections.categorySuggestions'), title)).toBe(true);
    expect(follows(title, getByText('admin.sections.allUsersFmt(count=0)'))).toBe(true);

    const featured = getByTestId('featured-clubs');
    expect(follows(document.getElementById('clubs-pending'), featured)).toBe(true);
    expect(document.getElementById('clubs-pending').contains(featured)).toBe(false);
  });

  it('an older server without stats.motivations shows no card (and the rest still renders)', async () => {
    vi.mocked(admin.getStats).mockResolvedValue(stats());
    const { findByText, queryByText } = render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
    expect(await findByText('admin.sections.categorySuggestions')).toBeTruthy();
    expect(queryByText('admin.motivations.title')).toBeNull();
  });
});

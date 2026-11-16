import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// JAMIE Pro at the very top of the admin dashboard (Tobi, 16.11.2026: „wie
// viele Leute eine Pro-Mitgliedschaft abgeschlossen haben (ganz oben)“).
// Keys plus their interpolation values, so counts and placeholders are visible.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => (opts ? `${key}(${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',')})` : key),
    i18n: { language: 'de', resolvedLanguage: 'de' },
  }),
}));

// The dashboard's own loads; its self-loading sections stubbed out, the
// moderation queue as a marker for the order.
vi.mock('../utils/api', () => ({
  admin: {
    getStats: vi.fn(), getScreenTime: vi.fn(), getPendingClubs: vi.fn(), getTopClubs: vi.fn(),
    getUsers: vi.fn(), getOnlineUsers: vi.fn(),
  },
}));
vi.mock('../context/AuthContext', async () => ({ AuthContext: (await import('react')).createContext(null) }));
vi.mock('../components/AdminReportsSection', () => ({ AdminReportsSection: () => <div data-testid="reports" /> }));
vi.mock('../components/AdminGrowthSection', () => ({ AdminGrowthSection: () => null }));
vi.mock('../components/AdminDealsSection', () => ({ AdminDealsSection: () => null }));
vi.mock('../components/AdminNewsSection', () => ({ AdminNewsSection: () => null }));
vi.mock('../components/AdminFeedbackSection', () => ({ AdminFeedbackSection: () => null }));
vi.mock('../components/AdminClassifySection', () => ({ AdminClassifySection: () => null }));
vi.mock('../components/AdminFeaturedClubsSection', () => ({ AdminFeaturedClubsSection: () => null }));
vi.mock('../components/AdminUserModal', () => ({ AdminUserModal: () => null }));

const { admin } = await import('../utils/api');
const { AdminDashboard } = await import('../pages/AdminDashboard');

// GET /api/admin/stats → `pro` (adminController.getStats).
const PRO = {
  active: 42, trialing: 5, canceling: 3,
  by_store: { apple: 30, google: 4, web: 8 },
  ever: 61, new_7d: 6, new_30d: 17, team_active: 4, sandbox_active: 1,
};
const stats = (extra = {}) => ({ data: { users: {}, groups: {}, deal_redemptions: {}, category_suggestions: [], ...extra } });
const renderDashboard = () => render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
// KPICard: the figure sits right above its label.
const figureOf = (label) => label.previousSibling.textContent;

beforeEach(() => {
  vi.mocked(admin.getScreenTime).mockResolvedValue({ data: [] });
  vi.mocked(admin.getPendingClubs).mockResolvedValue({ data: [] });
  vi.mocked(admin.getTopClubs).mockResolvedValue({ data: [] });
  vi.mocked(admin.getUsers).mockResolvedValue({ data: { users: [], total: 0 } });
  vi.mocked(admin.getOnlineUsers).mockRejectedValue(new Error('404'));
});

describe('AdminDashboard — JAMIE Pro block', () => {
  it('comes first: right under the header, above the moderation queue and every other KPI', async () => {
    vi.mocked(admin.getStats).mockResolvedValue(stats({ pro: PRO }));
    const { findByText, getByText, getByTestId } = renderDashboard();
    const heading = await findByText('admin.sections.pro');
    expect(heading.tagName).toBe('H2');
    expect(follows(getByText('admin.title'), heading)).toBe(true);
    expect(follows(heading, getByTestId('reports'))).toBe(true);
    expect(follows(getByTestId('reports'), getByText('admin.sections.users'))).toBe(true);
  });

  it('shows the active members as the big figure, the five breakdowns, the store split and who was left out', async () => {
    vi.mocked(admin.getStats).mockResolvedValue(stats({ pro: PRO }));
    const { findByText, getByText } = renderDashboard();
    const active = await findByText('admin.pro.active');
    expect(figureOf(active)).toBe('42');
    expect(active.previousSibling.style.fontSize).toBe('44px');
    expect(figureOf(getByText('admin.pro.trialing'))).toBe('5');
    expect(figureOf(getByText('admin.pro.canceling'))).toBe('3');
    expect(figureOf(getByText('admin.pro.new7d'))).toBe('6');
    expect(figureOf(getByText('admin.pro.new30d'))).toBe('17');
    expect(figureOf(getByText('admin.pro.ever'))).toBe('61');
    expect(getByText('admin.pro.storesFmt(apple=30,google=4,web=8)')).toBeTruthy();
    // plural via {count}, and a NUMBER, or i18next would not resolve _one/_other
    expect(getByText('admin.pro.teamExcluded(count=4)')).toBeTruthy();
    expect(getByText('admin.pro.sandboxExcluded(count=1)')).toBeTruthy();
  });

  it('nobody left out → no team or sandbox line; zero members read 0, not —', async () => {
    vi.mocked(admin.getStats).mockResolvedValue(stats({ pro: {
      active: 0, trialing: 0, canceling: 0, by_store: { apple: 0, google: 0, web: 0 },
      ever: 0, new_7d: 0, new_30d: 0, team_active: 0, sandbox_active: 0,
    } }));
    const { findByText, getByText, container } = renderDashboard();
    expect(figureOf(await findByText('admin.pro.active'))).toBe('0');
    expect(getByText('admin.pro.storesFmt(apple=0,google=0,web=0)')).toBeTruthy();
    expect(container.textContent).not.toContain('admin.pro.teamExcluded');
    expect(container.textContent).not.toContain('admin.pro.sandboxExcluded');
  });

  it.each([
    ['an older server without the field', {}],
    ['no subscriptions table (pro: null)', { pro: null }],
  ])('%s → no Pro block, the page renders as before', async (_label, extra) => {
    vi.mocked(admin.getStats).mockResolvedValue(stats(extra));
    const { findByText, queryByText, getByTestId } = renderDashboard();
    expect(await findByText('admin.sections.users')).toBeTruthy();
    expect(queryByText('admin.sections.pro')).toBeNull();
    expect(queryByText('admin.pro.active')).toBeNull();
    expect(getByTestId('reports')).toBeTruthy();
  });
});

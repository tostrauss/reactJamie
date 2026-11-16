import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The approval queue says what waits (Tina 16.11.2026: „Es müsste im Admin
// auch als Club kommen und Community als Community. Derzeit kommt beides
// gleich.“): every entry carries „Club“ ('official') or „Community“ (anything
// else — an old bundle queues its communities without a type).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => (opts ? `${key}(${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',')})` : key),
    i18n: { language: 'de', resolvedLanguage: 'de' },
  }),
}));

vi.mock('../utils/api', () => ({
  admin: {
    getStats: vi.fn(), getScreenTime: vi.fn(), getPendingClubs: vi.fn(), getTopClubs: vi.fn(),
    getUsers: vi.fn(), getOnlineUsers: vi.fn(), approveClub: vi.fn(), rejectClub: vi.fn(),
  },
}));
vi.mock('../context/AuthContext', async () => ({ AuthContext: (await import('react')).createContext(null) }));
vi.mock('../components/AdminReportsSection', () => ({ AdminReportsSection: () => null }));
vi.mock('../components/AdminGrowthSection', () => ({ AdminGrowthSection: () => null }));
vi.mock('../components/AdminDealsSection', () => ({ AdminDealsSection: () => null }));
vi.mock('../components/AdminNewsSection', () => ({ AdminNewsSection: () => null }));
vi.mock('../components/AdminFeedbackSection', () => ({ AdminFeedbackSection: () => null }));
vi.mock('../components/AdminClassifySection', () => ({ AdminClassifySection: () => null }));
vi.mock('../components/AdminFeaturedClubsSection', () => ({ AdminFeaturedClubsSection: () => null }));
vi.mock('../components/AdminUserModal', () => ({ AdminUserModal: () => null }));

const { admin } = await import('../utils/api');
const { AdminDashboard } = await import('../pages/AdminDashboard');

const pending = (id, name, clubType) => ({
  id, name, club_type: clubType, category: 'Sport', location: 'Wien',
  created_at: '2026-11-16T09:00:00Z', owner_name: 'Olga', owner_email: 'olga@example.com',
});
// The type tag sits right above the club's name, inside its entry.
const tagOf = async (findByText, name) => (await findByText(name)).previousSibling;

beforeEach(() => {
  vi.mocked(admin.getStats).mockResolvedValue({ data: { users: {}, groups: {}, deal_redemptions: {} } });
  vi.mocked(admin.getScreenTime).mockResolvedValue({ data: [] });
  vi.mocked(admin.getTopClubs).mockResolvedValue({ data: [] });
  vi.mocked(admin.getUsers).mockResolvedValue({ data: { users: [], total: 0 } });
  vi.mocked(admin.getOnlineUsers).mockRejectedValue(new Error('404'));
});

describe('AdminDashboard — approval queue: „Club“ or „Community“', () => {
  it('labels an official club as a club and a community as a community', async () => {
    vi.mocked(admin.getPendingClubs).mockResolvedValue({ data: [
      pending(1, 'Café Soleá', 'official'),
      pending(2, 'Lauftreff Prater', 'community'),
    ] });
    const { findByText } = render(<MemoryRouter><AdminDashboard /></MemoryRouter>);

    const club = await tagOf(findByText, 'Café Soleá');
    expect(club.textContent).toBe('admin.pendingClubs.typeClub');
    // the partner yellow, outline only — never a literal colour (PartnerBadge.test)
    expect(club.style.color).toBe('var(--partner-text)');
    expect(club.style.border).toContain('var(--partner-line)');

    const community = await tagOf(findByText, 'Lauftreff Prater');
    expect(community.textContent).toBe('admin.pendingClubs.typeCommunity');
    expect(community.style.color).not.toContain('partner');
  });

  it('a row whose type is NULL reads as a community, like on the server', async () => {
    vi.mocked(admin.getPendingClubs).mockResolvedValue({ data: [pending(3, 'Altbestand', null)] });
    const { findByText } = render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
    expect((await tagOf(findByText, 'Altbestand')).textContent).toBe('admin.pendingClubs.typeCommunity');
  });

  // Review 16.11.2026: the tag said „Community“, the question „Club …?“.
  it('„Ablehnen“ asks about a community as a community, a club as a club', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      vi.mocked(admin.getPendingClubs).mockResolvedValue({ data: [
        pending(1, 'Café Soleá', 'official'),
        pending(2, 'Lauftreff Prater', 'community'),
      ] });
      const { findByText } = render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
      // name → its info column → the head row → the entry with the buttons
      const rejectOf = async (name) => within((await findByText(name)).parentElement.parentElement.parentElement)
        .getByRole('button', { name: 'admin.pendingClubs.reject' });
      fireEvent.click(await rejectOf('Lauftreff Prater'));
      expect(confirm).toHaveBeenLastCalledWith('admin.pendingClubs.rejectConfirmCommunity(name=Lauftreff Prater)');
      fireEvent.click(await rejectOf('Café Soleá'));
      expect(confirm).toHaveBeenLastCalledWith('admin.pendingClubs.rejectConfirm(name=Café Soleá)');
      expect(admin.rejectClub).not.toHaveBeenCalled();
    } finally {
      confirm.mockRestore();
    }
  });

  it('an older server without the field: no tag rather than a wrong one', async () => {
    const legacy = pending(4, 'Ohne Feld', 'official');
    delete legacy.club_type;
    vi.mocked(admin.getPendingClubs).mockResolvedValue({ data: [legacy] });
    const { findByText, queryByText } = render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
    expect((await findByText('Ohne Feld')).previousSibling).toBeNull();
    expect(queryByText('admin.pendingClubs.typeCommunity')).toBeNull();
    expect(queryByText('admin.pendingClubs.typeClub')).toBeNull();
  });
});

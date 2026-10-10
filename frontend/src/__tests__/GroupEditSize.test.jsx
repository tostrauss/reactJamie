import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

// Teilnehmerzahl nachträglich ändern (Tina 10.10.2026: "dass man die Events
// nachträglich auf mehr Leute stellen kann"). Club events got the GROUP rule in
// the edit page's stepper, so "+" stopped at 20. Clubs and events: 2–500, ±1 up
// to 20 then ±5; groups stay 4–20; never below the people already in.
// Real German i18n.
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock('../utils/api', () => ({
  groups: { getById: vi.fn(), getMembers: vi.fn(), getFavorites: vi.fn(async () => ({ data: [] })) },
  clubs: { getFavorites: vi.fn(async () => ({ data: [] })) },
  upload: {},
  friends: { getAll: vi.fn(async () => ({ data: [] })) },
}));
const { groups } = await import('../utils/api');
const { GroupEdit } = await import('../pages/GroupEdit');

const members = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `M${i + 1}`, role: i === 0 ? 'owner' : 'member' }));
const renderEdit = async (group, memberCount) => {
  vi.mocked(groups.getById).mockResolvedValueOnce({ data: { owner_id: 1, name: 'X', location: 'Wien', ...group } });
  vi.mocked(groups.getMembers).mockResolvedValueOnce({ data: { members: members(memberCount), total_count: memberCount } });
  render(
    <AuthContext.Provider value={{ user: { id: 1, name: 'Tina' } }}>
      <MemoryRouter initialEntries={[`/group/${group.id}/edit`]}>
        <Routes><Route path="/group/:id/edit" element={<GroupEdit />} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await act(async () => {});
};
const value = () => document.querySelector('.ge-step-val').textContent;
const more = () => document.querySelector('.ge-step-btn[aria-label="Mehr"]');
const less = () => document.querySelector('.ge-step-btn[aria-label="Weniger"]');

beforeEach(() => {
  vi.mocked(groups.getById).mockReset();
  vi.mocked(groups.getMembers).mockReset();
});

describe('GroupEdit — participant limit', () => {
  it('a club event at 20 can be raised (±5 above 20) and is labelled as participants', async () => {
    await renderEdit({ id: 451, type: 'event', parent_club_id: 420, max_members: 20, members_count: 3,
      date: '2026-10-31T20:00:00.000Z' }, 3);
    expect(screen.getByText('Max. Teilnehmer')).toBeTruthy();
    expect(value()).toBe('20');
    fireEvent.click(more());
    expect(value()).toBe('25');
    fireEvent.click(more());
    expect(value()).toBe('30');
    fireEvent.click(less());
    expect(value()).toBe('25');
    expect(more().disabled).toBe(false);
  });

  it('an event created with more than 20 no longer drops to 20 on "+"', async () => {
    await renderEdit({ id: 452, type: 'event', parent_club_id: 420, max_members: 100, members_count: 2,
      date: '2026-10-31T20:00:00.000Z' }, 2);
    fireEvent.click(more());
    expect(value()).toBe('105');
  });

  it('never below the people already in: "−" stops at the member count', async () => {
    await renderEdit({ id: 453, type: 'event', parent_club_id: 420, max_members: 5, members_count: 4,
      date: '2026-10-31T20:00:00.000Z' }, 4);
    fireEvent.click(less());
    expect(value()).toBe('4');
    expect(less().disabled).toBe(true);
  });

  it('groups keep their 4–20 range', async () => {
    await renderEdit({ id: 7, type: 'group', max_members: 20, members_count: 5 }, 5);
    expect(screen.getByText('Gruppengröße', { exact: false })).toBeTruthy();
    expect(value()).toBe('20');
    expect(more().disabled).toBe(true);
    fireEvent.click(more());
    expect(value()).toBe('20');
  });
});

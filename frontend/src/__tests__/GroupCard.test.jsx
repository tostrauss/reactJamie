import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GroupCard } from '../components/GroupCard';

// Mock the API module so no real network calls are made
vi.mock('../utils/api', () => ({
  default: {
    groups: {
      getMemberAvatars: vi.fn().mockResolvedValue({ data: [] }),
      getWaitlistStatus: vi.fn().mockResolvedValue({ data: null }),
    },
  },
}));

const baseGroup = {
  id: 1,
  name: 'Tennis am Sonntag',
  category: 'Sport',
  type: 'group',
  members_count: 3,
  max_members: 8,
  is_private: false,
  date: '2026-04-01',
};

describe('GroupCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the group name as the card title', async () => {
    // The card title is the user-entered group name; the category is only a
    // fallback for legacy groups without a name (see GroupCard.jsx).
    render(<MemoryRouter><GroupCard group={baseGroup} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Tennis am Sonntag')).toBeInTheDocument());
  });

  it('falls back to the category as title when the group has no name', async () => {
    const noName = { ...baseGroup, name: undefined, title: undefined };
    render(<MemoryRouter><GroupCard group={noName} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Sport')).toBeInTheDocument());
  });

  it('shows the member count with Mitglieder suffix', async () => {
    render(<MemoryRouter><GroupCard group={baseGroup} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('3/8 Mitglieder')).toBeInTheDocument());
  });

  it('shows the lock emoji for private groups', async () => {
    const privateGroup = { ...baseGroup, is_private: true };
    render(<MemoryRouter><GroupCard group={privateGroup} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('🔒')).toBeInTheDocument());
  });

  it('shows the Voll badge when the group is full', async () => {
    const fullGroup = { ...baseGroup, members_count: 8 };
    render(<MemoryRouter><GroupCard group={fullGroup} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Voll')).toBeInTheDocument());
  });

  it('renders the Pro gate on the 4th tile for non-Pro non-admin viewers', async () => {
    // Gate requires a member actually hidden behind it: members_count > 3.
    const gatedGroup = { ...baseGroup, members_count: 5 };
    render(<MemoryRouter><GroupCard group={gatedGroup} isJoined={false} /></MemoryRouter>);
    // No AuthContext provider → user undefined (non-admin) + isPro undefined →
    // the gate occupies the 4th tile. Fixture has 0 previews → 3 empty "+"
    // join slots + 1 Pro-gate tile = 4 buttons.
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(4));
    expect(screen.getByLabelText('Mit JAMIE Pro alle Mitglieder sehen')).toBeInTheDocument();
  });

  it('hides the Pro gate when no member is hidden behind it (≤3 members)', async () => {
    // baseGroup has members_count: 3 — all members already visible, a lock
    // would imply hidden people that don't exist.
    render(<MemoryRouter><GroupCard group={baseGroup} isJoined={false} /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(4)); // 4 plain "+" slots
    expect(screen.queryByLabelText('Mit JAMIE Pro alle Mitglieder sehen')).not.toBeInTheDocument();
  });

  it('dispatches jamie:open-pro-modal when the Pro lock is clicked', async () => {
    const listener = vi.fn();
    window.addEventListener('jamie:open-pro-modal', listener);
    render(<MemoryRouter><GroupCard group={{ ...baseGroup, members_count: 5 }} /></MemoryRouter>);
    const lock = await screen.findByLabelText('Mit JAMIE Pro alle Mitglieder sehen');
    await act(async () => { fireEvent.click(lock); });
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('jamie:open-pro-modal', listener);
  });

  it('calls onClick when the card is clicked', async () => {
    const onClick = vi.fn();
    const { container } = render(<MemoryRouter><GroupCard group={baseGroup} onClick={onClick} /></MemoryRouter>);
    await act(async () => { fireEvent.click(container.firstChild); });
    expect(onClick).toHaveBeenCalled();
  });

  it('does not show Voll badge when group is not full', async () => {
    render(<MemoryRouter><GroupCard group={baseGroup} /></MemoryRouter>);
    await waitFor(() => expect(screen.queryByText('Voll')).not.toBeInTheDocument());
  });

  it('shows boost badge for boosted groups', async () => {
    const boostedGroup = { ...baseGroup, is_boosted: true };
    render(<MemoryRouter><GroupCard group={boostedGroup} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('🚀')).toBeInTheDocument());
  });
});

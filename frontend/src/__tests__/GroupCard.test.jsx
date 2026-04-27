import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

  it('renders the category as the card title', async () => {
    render(<GroupCard group={baseGroup} />);
    await waitFor(() => expect(screen.getByText('Sport')).toBeInTheDocument());
  });

  it('shows the member count with Members suffix', async () => {
    render(<GroupCard group={baseGroup} />);
    await waitFor(() => expect(screen.getByText('3/8 Members')).toBeInTheDocument());
  });

  it('shows the lock emoji for private groups', async () => {
    const privateGroup = { ...baseGroup, is_private: true };
    render(<GroupCard group={privateGroup} />);
    await waitFor(() => expect(screen.getByText('🔒')).toBeInTheDocument());
  });

  it('shows the Voll badge when the group is full', async () => {
    const fullGroup = { ...baseGroup, members_count: 8 };
    render(<GroupCard group={fullGroup} />);
    await waitFor(() => expect(screen.getByText('Voll')).toBeInTheDocument());
  });

  it('shows + join buttons for empty avatar slots', async () => {
    render(<GroupCard group={baseGroup} isJoined={false} />);
    // 0 member avatars loaded (mock returns []) → 4 empty slots → 4 join buttons
    await waitFor(() => expect(screen.getAllByText('+')).toHaveLength(4));
  });

  it('calls onClick when the card is clicked', async () => {
    const onClick = vi.fn();
    const { container } = render(<GroupCard group={baseGroup} onClick={onClick} />);
    await act(async () => { fireEvent.click(container.firstChild); });
    expect(onClick).toHaveBeenCalled();
  });

  it('does not show Voll badge when group is not full', async () => {
    render(<GroupCard group={baseGroup} />);
    await waitFor(() => expect(screen.queryByText('Voll')).not.toBeInTheDocument());
  });

  it('shows boost badge for boosted groups', async () => {
    const boostedGroup = { ...baseGroup, is_boosted: true };
    render(<GroupCard group={boostedGroup} />);
    await waitFor(() => expect(screen.getByText('🚀')).toBeInTheDocument());
  });
});

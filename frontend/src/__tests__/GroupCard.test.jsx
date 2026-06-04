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

  it('renders the category as the card title', async () => {
    render(<MemoryRouter><GroupCard group={baseGroup} /></MemoryRouter>);
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

  it('shows join buttons for empty + pro-gate avatar slots', async () => {
    render(<MemoryRouter><GroupCard group={baseGroup} isJoined={false} /></MemoryRouter>);
    // baseGroup has members_count 3 with no member_previews → 1 pro-gate + 3 empty slots,
    // each rendering a button with an SVG plus icon.
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(4));
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

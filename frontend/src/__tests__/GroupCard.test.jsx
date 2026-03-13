import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('renders the group name', () => {
    render(<GroupCard group={baseGroup} />);
    expect(screen.getByText('Tennis am Sonntag')).toBeInTheDocument();
  });

  it('renders the category badge', () => {
    render(<GroupCard group={baseGroup} />);
    expect(screen.getByText('Sport')).toBeInTheDocument();
  });

  it('shows the member count', () => {
    render(<GroupCard group={baseGroup} />);
    expect(screen.getByText('3/8')).toBeInTheDocument();
  });

  it('calls onFavorite when the heart button is clicked', () => {
    const onFavorite = vi.fn();
    render(<GroupCard group={baseGroup} onFavorite={onFavorite} />);
    fireEvent.click(screen.getByText('🤍'));
    expect(onFavorite).toHaveBeenCalledWith(1);
  });

  it('shows filled heart when isFavorite is true', () => {
    render(<GroupCard group={baseGroup} isFavorite />);
    expect(screen.getByText('❤️')).toBeInTheDocument();
  });

  it('shows the join button when not joined and not full', () => {
    render(<GroupCard group={baseGroup} isJoined={false} />);
    expect(screen.getByText('+')).toBeInTheDocument();
  });

  it('shows the chat button when the user has joined', () => {
    render(<GroupCard group={baseGroup} isJoined />);
    expect(screen.getByText('💬')).toBeInTheDocument();
  });

  it('shows the Voll badge when the group is full', () => {
    const fullGroup = { ...baseGroup, members_count: 8 };
    render(<GroupCard group={fullGroup} />);
    expect(screen.getByText('Voll')).toBeInTheDocument();
  });

  it('shows the Privat badge for private groups', () => {
    const privateGroup = { ...baseGroup, is_private: true };
    render(<GroupCard group={privateGroup} />);
    expect(screen.getByText(/Privat/)).toBeInTheDocument();
  });

  it('calls onClick when the card is clicked', () => {
    const onClick = vi.fn();
    const { container } = render(<GroupCard group={baseGroup} onClick={onClick} />);
    fireEvent.click(container.firstChild);
    expect(onClick).toHaveBeenCalled();
  });
});

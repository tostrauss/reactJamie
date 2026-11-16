import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import GroupDetailPills from '../components/GroupDetailPills';

// Event page head card (P2, Tina 16.11.2026): the grey category pill and,
// for a partner event, „☆ Partner" next to it — in one row that can never
// widen the page (S3). The small component instead of a test of the whole
// GroupDetail page (1,200 lines, a dozen API mocks).

describe('GroupDetailPills', () => {
  it('category only — the grey eyebrow, no partner pill', () => {
    const { container } = render(<GroupDetailPills category="Brettspiele" isPartner={false} />);
    expect(screen.getByText('Brettspiele')).toHaveClass('gd-category-eyebrow');
    expect(screen.queryByText('Partner')).not.toBeInTheDocument();
    expect(container.querySelector('.gd-pill-row')).toBeInTheDocument();
  });

  it('partner event — „☆ Partner" right next to the category, in the same row', () => {
    const { container } = render(<GroupDetailPills category="After Work" isPartner />);
    const row = container.querySelector('.gd-pill-row');
    expect(row.children).toHaveLength(2);
    expect(row.children[0]).toHaveTextContent('After Work');
    expect(row.children[1]).toHaveClass('partner-badge', 'partner-badge--pill');
    expect(screen.getByText('Partner')).toBeInTheDocument();
  });

  it('a partner event without a category still gets the pill', () => {
    const { container } = render(<GroupDetailPills category={null} isPartner />);
    expect(container.querySelector('.gd-category-eyebrow')).toBeNull();
    expect(screen.getByText('Partner')).toBeInTheDocument();
  });

  it('neither — no empty row', () => {
    const { container } = render(<GroupDetailPills category="" isPartner={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('event page CSS (group-detail.css)', () => {
  const css = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles/group-detail.css'), 'utf8');

  it('the partner head card is framed with the 55 % partner line', () => {
    expect(css).toMatch(/\n\.gd-content-card--partner\s*\{[^}]*border-color:\s*var\(--partner-line\)/);
  });

  it('the pill row may shrink and ellipsizes the category instead of widening the card', () => {
    expect(css).toMatch(/\n\.gd-pill-row\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.gd-pill-row \.gd-category-eyebrow\s*\{[^}]*text-overflow:\s*ellipsis/);
  });
});

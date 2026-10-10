import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { PinnwandMasonry } from '../components/PinnwandMasonry';

// The Pinnwand on a profile must read in the order set in ProfileEdit:
// left → right, then down. CSS `column-count` filled the first column top →
// bottom instead, so photo 2 sat under photo 1 (Wunsch 10.10.2026).
const columns = (container) => [...container.querySelectorAll('.pinnwand-col')]
  .map((c) => [...c.children].map((el) => el.querySelector('img')?.getAttribute('src') ?? 'ADD'));

afterEach(() => { delete window.matchMedia; });

describe('PinnwandMasonry — reading order', () => {
  it('deals the photos left → right into two columns and opens the right index', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <PinnwandMasonry photos={['/a', '/b', '/c', '/d', '/e']} onOpen={onOpen} itemAriaLabel="Foto ansehen" />,
    );
    expect(columns(container)).toEqual([['/a', '/c', '/e'], ['/b', '/d']]);
    fireEvent.click(container.querySelector('img[src="/d"]').closest('button'));
    expect(onOpen).toHaveBeenCalledWith(3);
  });

  it('puts the add tile into the next reading slot', () => {
    const { container } = render(
      <PinnwandMasonry photos={['/a', '/b', '/c']} onOpen={() => {}}
        addTile={<button type="button" className="pinnwand-masonry-add">+</button>} />,
    );
    expect(columns(container)).toEqual([['/a', '/c'], ['/b', 'ADD']]);
  });

  it('uses three columns from 480px', () => {
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { container } = render(<PinnwandMasonry photos={['/a', '/b', '/c', '/d']} onOpen={() => {}} />);
    expect(columns(container)).toEqual([['/a', '/d'], ['/b'], ['/c']]);
  });
});

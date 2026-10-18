import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttendanceTierBadge } from '../components/AttendanceTierBadge';

// Abzeichen-Stufen (tester 06.10.2026) — real German i18n (vitest.setup).
describe('AttendanceTierBadge', () => {
  it('renders nothing for no / unknown / out-of-range levels', () => {
    for (const tier of [0, undefined, null, 6, '2']) {
      const { container } = render(<AttendanceTierBadge tier={tier} />);
      expect(container.innerHTML).toBe('');
    }
  });

  it('pill: emoji + "5+ mal dabei", announced as an image with a full label', () => {
    render(<AttendanceTierBadge tier={1} variant="pill" />);
    expect(screen.getByRole('img', { name: 'Abzeichen: mindestens 5-mal bestätigt dabei' })).toBeTruthy();
    expect(screen.getByText('5+ mal dabei')).toBeTruthy();
    expect(screen.getByText('🏅')).toBeTruthy();
  });

  it('chip: language-neutral "10+" with 🏆', () => {
    render(<AttendanceTierBadge tier={2} variant="chip" />);
    expect(screen.getByText('10+')).toBeTruthy();
    expect(screen.getByText('🏆')).toBeTruthy();
  });

  it('corner: the emoji only', () => {
    const { container } = render(<AttendanceTierBadge tier={5} variant="corner" />);
    expect(container.textContent).toBe('🎆');
  });

  // 25 🌟 and 50 💎 (Lea, 18.10.2026) — the steps between 🏆 and 🎆.
  it('renders the new steps 3 and 4 as 🌟 25+ and 💎 50+', () => {
    const { unmount } = render(<AttendanceTierBadge tier={3} variant="pill" />);
    expect(screen.getByRole('img', { name: 'Abzeichen: mindestens 25-mal bestätigt dabei' })).toBeTruthy();
    expect(screen.getByText('🌟')).toBeTruthy();
    expect(screen.getByText('25+ mal dabei')).toBeTruthy();
    unmount();
    render(<AttendanceTierBadge tier={4} variant="chip" />);
    expect(screen.getByText('💎')).toBeTruthy();
    expect(screen.getByText('50+')).toBeTruthy();
  });

  it('with onClick the pill is a button that does not trigger the surrounding tap target', () => {
    const onClick = vi.fn();
    const outer = vi.fn();
    render(<div onClick={outer}><AttendanceTierBadge tier={1} variant="pill" onClick={onClick} /></div>);
    const btn = screen.getByRole('button', { name: /Abzeichen ansehen/ });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('the button is named by what it shows first ("Label in Name", voice control)', () => {
    render(<AttendanceTierBadge tier={2} variant="pill" onClick={() => {}} />);
    const btn = screen.getByRole('button', { name: '10+ mal dabei – Abzeichen ansehen' });
    expect(btn.getAttribute('title')).toBe('Abzeichen: mindestens 10-mal bestätigt dabei');
  });
});

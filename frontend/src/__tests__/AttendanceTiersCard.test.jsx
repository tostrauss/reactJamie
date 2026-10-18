import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttendanceTiersCard } from '../components/AttendanceTiersCard';

// The Abzeichen card in the Hall-of-Fame tab — real German i18n.
describe('AttendanceTiersCard (own)', () => {
  it('shows the count, what is missing for the next step and a progress bar', () => {
    render(<AttendanceTiersCard own tier={1} confirmedEvents={7} confirmers={3}
      next={{ tier: 2, events_missing: 3, confirmers_missing: 0 }} />);
    expect(screen.getByText('Du warst 7-mal bestätigt dabei.')).toBeTruthy();
    expect(screen.getByText('Noch 3 bis 🏆')).toBeTruthy();
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('7');
    expect(bar.getAttribute('aria-valuemin')).toBe('5');
    expect(bar.getAttribute('aria-valuemax')).toBe('10');
  });

  it('singular for one meetup', () => {
    render(<AttendanceTiersCard own tier={0} confirmedEvents={1} confirmers={1}
      next={{ tier: 1, events_missing: 4, confirmers_missing: 1 }} />);
    expect(screen.getByText('Du warst einmal bestätigt dabei.')).toBeTruthy();
  });

  it('motivates at zero: "Noch 5 bis 🏅"', () => {
    render(<AttendanceTiersCard own tier={0} confirmedEvents={0} confirmers={0}
      next={{ tier: 1, events_missing: 5, confirmers_missing: 2 }} />);
    expect(screen.getByText('Noch keine bestätigte Teilnahme.')).toBeTruthy();
    expect(screen.getByText('Noch 5 bis 🏅')).toBeTruthy();
  });

  it('explains the people floor instead of a bar when only confirmers are missing', () => {
    render(<AttendanceTiersCard own tier={1} confirmedEvents={12} confirmers={2}
      next={{ tier: 2, events_missing: 0, confirmers_missing: 1 }} />);
    expect(screen.getByText(/mindestens 3 verschiedene Personen/)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('says so at the top', () => {
    render(<AttendanceTiersCard own tier={5} confirmedEvents={120} confirmers={30} next={null} />);
    expect(screen.getByText('Höchste Stufe erreicht 🎆')).toBeTruthy();
  });

  // Lea (18.10.2026): the jump from 🏆 10 to 🎆 100 was far too big.
  it('the ladder has five steps — 🌟 25 and 💎 50 between 🏆 and 🎆', () => {
    const { container } = render(<AttendanceTiersCard own tier={3} confirmedEvents={30} confirmers={6}
      next={{ tier: 4, events_missing: 20, confirmers_missing: 1 }} />);
    const steps = [...container.querySelectorAll('.attend-step')];
    expect(steps.map((s) => s.textContent)).toEqual(['🏅5+', '🏆10+', '🌟25+', '💎50+', '🎆100+']);
    expect(steps.map((s) => s.getAttribute('aria-label'))).toEqual([
      '🏅 ab 5, erreicht', '🏆 ab 10, erreicht', '🌟 ab 25, erreicht', '💎 ab 50', '🎆 ab 100',
    ]);
    expect(screen.getByText('Noch 20 bis 💎')).toBeTruthy();
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuemin')).toBe('25');
    expect(bar.getAttribute('aria-valuemax')).toBe('50');
    // Level 3 is 🌟 now, not the top — no "Höchste Stufe".
    expect(screen.queryByText(/Höchste Stufe/)).toBeNull();
  });

  it('explains when a meetup shows up: once the "Wer war dabei?" round has closed', () => {
    const { rerender } = render(<AttendanceTiersCard own tier={0} confirmedEvents={0} confirmers={0}
      next={{ tier: 1, events_missing: 5, confirmers_missing: 2 }} windowDays={14} />);
    expect(screen.getByText(/14 Tage nach dem Event/)).toBeTruthy();
    rerender(<AttendanceTiersCard own tier={0} confirmedEvents={0} confirmers={0}
      next={{ tier: 1, events_missing: 5, confirmers_missing: 2 }} />);
    expect(screen.queryByText(/Tage nach dem Event/)).toBeNull();
  });

  it('the heading can take focus after the pill jump, without entering the tab order', () => {
    render(<AttendanceTiersCard own tier={1} confirmedEvents={5} confirmers={2} next={null} />);
    expect(screen.getByRole('heading', { name: 'Abzeichen' }).getAttribute('tabindex')).toBe('-1');
  });
});

describe('AttendanceTiersCard (someone else)', () => {
  it('shows the level only — no counts, no "Du warst"', () => {
    const { container } = render(<AttendanceTiersCard tier={2} />);
    expect(screen.getByText('Bei mindestens 10 Events als „dabei“ bestätigt.')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Du warst/);
    expect(container.querySelectorAll('.attend-step--on')).toHaveLength(2);
  });

  it('💎 lights four of the five steps', () => {
    const { container } = render(<AttendanceTiersCard tier={4} />);
    expect(screen.getByText('Bei mindestens 50 Events als „dabei“ bestätigt.')).toBeTruthy();
    expect(container.querySelectorAll('.attend-step')).toHaveLength(5);
    expect(container.querySelectorAll('.attend-step--on')).toHaveLength(4);
  });
});

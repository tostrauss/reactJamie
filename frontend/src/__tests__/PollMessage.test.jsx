import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PollMessage } from '../components/PollMessage';

// The poll bubble (B1) — real German i18n (vitest.setup).
const poll = (over = {}) => ({
  kind: 'choice', question: 'Was machen wir?', multi: false, closed: false, version: 1, voter_count: 2,
  options: [{ pos: 0, label: 'Bowling', votes: 0 }, { pos: 1, label: 'Kino', votes: 2 }],
  my_votes: [1], ...over,
});

afterEach(() => vi.useRealTimers());

describe('PollMessage', () => {
  it('renders question, options, counts and "x von y"', () => {
    render(<PollMessage poll={poll()} memberCount={5} onVote={() => {}} />);
    expect(screen.getByText('Was machen wir?')).toBeTruthy();
    expect(screen.getByText('Bowling')).toBeTruthy();
    expect(screen.getByText('2 von 5 haben abgestimmt')).toBeTruthy();
  });

  it('"Noch keine Stimmen" before the first vote', () => {
    render(<PollMessage poll={poll({ voter_count: 0, my_votes: [], options: poll().options.map((o) => ({ ...o, votes: 0 })) })} onVote={() => {}} />);
    expect(screen.getByText('Noch keine Stimmen')).toBeTruthy();
  });

  it('aria-pressed follows my selection', () => {
    render(<PollMessage poll={poll()} onVote={() => {}} />);
    expect(screen.getByRole('button', { name: /Kino/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Bowling/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('single choice: another option replaces, my own withdraws', () => {
    const onVote = vi.fn();
    render(<PollMessage poll={poll()} onVote={onVote} />);
    fireEvent.click(screen.getByRole('button', { name: /Bowling/ }));
    fireEvent.click(screen.getByRole('button', { name: /Kino/ }));
    expect(onVote.mock.calls).toEqual([[[0]], [[]]]);
  });

  it('multi: sorted toggle', () => {
    const onVote = vi.fn();
    render(<PollMessage poll={poll({ multi: true })} onVote={onVote} />);
    fireEvent.click(screen.getByRole('button', { name: /Bowling/ }));
    expect(onVote).toHaveBeenCalledWith([0, 1]);
  });

  it('closed: inert (aria-disabled), "Beendet", the winner marked "Ergebnis"', () => {
    const onVote = vi.fn();
    render(<PollMessage poll={poll({ closed: true })} onVote={onVote} />);
    const kino = screen.getByRole('button', { name: /Kino/ });
    expect(kino.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(kino);
    expect(onVote).not.toHaveBeenCalled();
    expect(screen.getByText(/Beendet/)).toBeTruthy();
    expect(screen.getByText('Ergebnis')).toBeTruthy();
  });

  it('a press on an option still reaches the bubble (long-press = report/react stays possible)', () => {
    const bubbleDown = vi.fn();
    render(<div onPointerDown={bubbleDown}><PollMessage poll={poll()} onVote={() => {}} /></div>);
    fireEvent.pointerDown(screen.getByRole('button', { name: /Bowling/ }));
    expect(bubbleDown).toHaveBeenCalled();
  });

  it('a click after a 500ms hold is NOT a vote; a keyboard click (no pointerdown) is', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    const onVote = vi.fn();
    render(<PollMessage poll={poll()} onVote={onVote} />);
    const btn = screen.getByRole('button', { name: /Bowling/ });
    fireEvent.pointerDown(btn);
    vi.setSystemTime(new Date('2026-10-06T10:00:00.600Z'));
    fireEvent.click(btn, { detail: 1 }); // the pointer click that ends the hold
    expect(onVote).not.toHaveBeenCalled();
    fireEvent.click(btn, { detail: 0 }); // keyboard-style: no pointerdown before it
    expect(onVote).toHaveBeenCalledWith([0]);
  });

  it('an ABORTED press (right-click, drag off, scroll) never swallows the next keyboard or screen-reader activation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    const onVote = vi.fn();
    render(<PollMessage poll={poll()} onVote={onVote} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: /Kino/ })); // no click follows
    vi.setSystemTime(new Date('2026-10-06T10:00:05Z'));
    fireEvent.click(screen.getByRole('button', { name: /Bowling/ }), { detail: 0 });
    expect(onVote).toHaveBeenCalledWith([0]);
  });

  it('a touch-scroll that starts on an option (pointercancel) resets the press', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
    const onVote = vi.fn();
    render(<PollMessage poll={poll()} onVote={onVote} />);
    const btn = screen.getByRole('button', { name: /Bowling/ });
    fireEvent.pointerDown(btn);
    fireEvent.pointerCancel(btn);
    vi.setSystemTime(new Date('2026-10-06T10:00:02Z'));
    fireEvent.click(btn, { detail: 1 });
    expect(onVote).toHaveBeenCalledWith([0]);
  });

  it('a closed poll names its winner to screen readers too', () => {
    render(<PollMessage poll={poll({ closed: true })} onVote={() => {}} />);
    expect(screen.getByRole('button', { name: 'Kino: 2 Stimmen, Ergebnis' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bowling: 0 Stimmen' })).toBeTruthy();
  });
});

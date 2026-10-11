import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StepProgress } from '../components/StepProgress';
import { FlowHeader } from '../components/FlowHeader';
import { StepTitle } from '../components/StepTitle';

// Onboarding-Umbau 11.10.2026 — the shared sign-up chrome. Real German i18n
// (vitest.setup), so the progressbar name is the string users hear.
const states = (container) =>
  [...container.querySelectorAll('.step-progress-seg')].map((el) =>
    ['done', 'active', 'upcoming'].filter((s) => el.classList.contains(`step-progress-seg--${s}`)).join('|'));

describe('StepProgress', () => {
  it('marks earlier steps done (green), the current one active (coral), the rest upcoming', () => {
    const { container } = render(<StepProgress current={2} total={4} />);
    expect(states(container)).toEqual(['done', 'active', 'upcoming', 'upcoming']);
    const bar = screen.getByRole('progressbar', { name: 'Schritt 2 von 4' });
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('4');
    expect(bar.classList.contains('step-progress--complete')).toBe(false);
  });

  it('first step: nothing done yet', () => {
    const { container } = render(<StepProgress current={1} total={4} />);
    expect(states(container)).toEqual(['active', 'upcoming', 'upcoming', 'upcoming']);
  });

  it('complete turns every segment green, the active one included', () => {
    const { container } = render(<StepProgress current={4} total={4} complete />);
    expect(states(container)).toEqual(['done', 'done', 'done', 'done']);
    const bar = screen.getByRole('progressbar', { name: 'Schritt 4 von 4' });
    expect(bar.classList.contains('step-progress--complete')).toBe(true);
    expect(bar.getAttribute('aria-valuenow')).toBe('4');
  });

  it('done without an active step: 3 green + 1 upcoming (clubs page, no avatar yet)', () => {
    const { container } = render(<StepProgress total={4} done={3} />);
    expect(states(container)).toEqual(['done', 'done', 'done', 'upcoming']);
    expect(screen.getByRole('progressbar', { name: 'Schritt 3 von 4' })).toBeTruthy();
  });

  it('the active segment stays coral even when `done` reaches past it', () => {
    const { container } = render(<StepProgress current={2} total={4} done={3} />);
    expect(states(container)).toEqual(['done', 'active', 'done', 'upcoming']);
  });

  it('clamps out-of-range input and renders nothing without segments', () => {
    const { container } = render(<StepProgress current={9} total={3} />);
    expect(states(container)).toEqual(['done', 'done', 'active']);
    const empty = render(<StepProgress current={1} total={0} />);
    expect(empty.container.innerHTML).toBe('');
  });
});

describe('FlowHeader', () => {
  it('without onBack there is no back button, only the counter and the progress line', () => {
    render(<FlowHeader current={2} total={4} />);
    expect(screen.queryByRole('button', { name: 'Zurück' })).toBeNull();
    expect(screen.getByText('2 / 4')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Schritt 2 von 4' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'JAMIE' })).toBeTruthy();
  });

  it('the back button calls onBack without arguments and never submits a surrounding form', () => {
    const onBack = vi.fn();
    const onSubmit = vi.fn((e) => e.preventDefault());
    render(<form onSubmit={onSubmit}><FlowHeader onBack={onBack} current={3} total={4} /></form>);
    const back = screen.getByRole('button', { name: 'Zurück' });
    expect(back.getAttribute('type')).toBe('button');
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledWith();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('showCounter={false} leaves the counter empty; done/complete reach the progress line', () => {
    const { container, rerender } = render(<FlowHeader total={4} done={3} showCounter={false} />);
    expect(container.querySelector('.flow-header-count').textContent).toBe('');
    expect(states(container)).toEqual(['done', 'done', 'done', 'upcoming']);
    rerender(<FlowHeader total={4} complete showCounter={false} />);
    expect(states(container)).toEqual(['done', 'done', 'done', 'done']);
  });
});

describe('StepTitle', () => {
  it('renders the two-tone heading with the second line accented', () => {
    render(<StepTitle line1="Was trifft" line2="zu?" />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.classList.contains('ob-title')).toBe(true);
    const lines = h1.querySelectorAll('.ob-title-line');
    expect([...lines].map((l) => l.textContent)).toEqual(['Was trifft', 'zu?']);
    expect(lines[1].classList.contains('ob-title-accent')).toBe(true);
  });

  it('reads as one sentence to a screen reader (a space between the lines)', () => {
    render(<StepTitle line1="Wer" line2="bist du?" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Wer bist du?' })).toBeTruthy();
  });
});

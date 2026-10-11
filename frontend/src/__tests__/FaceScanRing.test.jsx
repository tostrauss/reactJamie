import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FaceScanRing } from '../components/FaceScanRing';

// Face-ID-style tick ring of the onboarding photo step (Tina's checklist
// 10.10.2026: „Face-Scan mäßig? … komplett grün"). Pure markup — the colours
// and the sweep are CSS (styles/onboarding.css), so the tests pin which ticks
// are green and in which order they animate.
const ticks = (c) => [...c.querySelectorAll('.fsr-tick')];
const greenTicks = (c) => ticks(c).filter((el) => el.classList.contains('fsr-tick--on'));
const delayOf = (el) => parseInt(el.style.animationDelay, 10);

describe('FaceScanRing', () => {
  it('draws 56 ticks; done/total is the green share — 3 of 4 steps → 42 green', () => {
    const { container } = render(<FaceScanRing done={3} total={4} />);
    expect(ticks(container)).toHaveLength(56);
    expect(greenTicks(container)).toHaveLength(42);
    // Clockwise from 12 o'clock: the green ones are the first 42.
    expect(ticks(container).slice(0, 42).every((el) => el.classList.contains('fsr-tick--on'))).toBe(true);
    expect(container.querySelector('.fsr-badge')).toBeNull();
    expect(container.querySelector('.fsr').classList.contains('fsr--complete')).toBe(false);
  });

  it('complete: every tick green plus the check badge', () => {
    const { container } = render(<FaceScanRing done={3} total={4} complete />);
    expect(greenTicks(container)).toHaveLength(56);
    expect(container.querySelector('.fsr-badge')).not.toBeNull();
    expect(container.querySelector('.fsr').classList.contains('fsr--complete')).toBe(true);
  });

  it('completing later fills only the rest, in order, without restarting the first sweep', () => {
    const { container, rerender } = render(<FaceScanRing done={3} total={4} />);
    const before = ticks(container).map(delayOf);
    rerender(<FaceScanRing done={3} total={4} complete />);
    const all = ticks(container);
    expect(greenTicks(container)).toHaveLength(56);
    // The 42 arrival ticks keep their delay (a changed value would replay them).
    expect(all.slice(0, 42).map(delayOf)).toEqual(before.slice(0, 42));
    // The 14 new ones start at once and follow each other.
    const fill = all.slice(42).map(delayOf);
    expect(fill[0]).toBe(0);
    expect(fill.every((d, i) => i === 0 || d > fill[i - 1])).toBe(true);
  });

  it('arriving complete is ONE sweep from 12 o\'clock (no second fill running at the same time)', () => {
    const { container } = render(<FaceScanRing done={3} total={4} complete />);
    const delays = ticks(container).map(delayOf);
    expect(delays[0]).toBe(0);
    expect(delays.every((d, i) => i === 0 || d > delays[i - 1])).toBe(true);
  });

  it('puts the children in the round slot; the ring itself is hidden from screen readers', () => {
    const { container, getByAltText } = render(
      <FaceScanRing done={1} total={4}><img src="/media/uploads/me.webp" alt="Ich" /></FaceScanRing>,
    );
    expect(container.querySelector('.fsr-slot img')).toBe(getByAltText('Ich'));
    expect(container.querySelector('svg.fsr-ring').getAttribute('aria-hidden')).toBe('true');
    // Phrasing elements only — it sits inside a <button> in the wizard.
    expect(container.querySelector('div')).toBeNull();
  });

  it('clamps odd input and honours a custom tick count', () => {
    expect(greenTicks(render(<FaceScanRing done={9} total={4} />).container)).toHaveLength(56);
    expect(greenTicks(render(<FaceScanRing done={2} total={0} />).container)).toHaveLength(0);
    expect(greenTicks(render(<FaceScanRing done={-1} total={4} />).container)).toHaveLength(0);
    const { container } = render(<FaceScanRing done={1} total={2} ticks={10} />);
    expect(ticks(container)).toHaveLength(10);
    expect(greenTicks(container)).toHaveLength(5);
  });

  it('size sets the slot diameter inline; without it the stylesheet decides', () => {
    const sized = render(<FaceScanRing size={120} />).container.querySelector('.fsr');
    expect(sized.style.getPropertyValue('--fsr-slot')).toBe('120px');
    const plain = render(<FaceScanRing />).container.querySelector('.fsr');
    expect(plain.getAttribute('style')).toBeNull();
  });
});

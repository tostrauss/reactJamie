import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import StatusBarScrim from '../components/StatusBarScrim';

// Robert, 1.4.4 (13.10.2026): scrolled text ran under the iOS clock. The scrim
// must fade in only while scrolled content sits under the status bar — never
// at the top of a page (profile photos, headers stay as designed), never over
// a pinned header, and never at all without a top inset (web, Android).

let frames = [];
let extras = [];
const attach = (el) => { document.body.appendChild(el); extras.push(el); return el; };
const flushFrames = () => act(() => { while (frames.length) frames.shift()(0); });

function GoTo({ path }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(path)}>go</button>;
}

function setup({ inset = 59 } = {}) {
  const view = render(
    <MemoryRouter initialEntries={['/home']}>
      <StatusBarScrim />
      <GoTo path="/settings" />
    </MemoryRouter>,
  );
  const scrim = view.container.querySelector('.status-scrim');
  Object.defineProperty(scrim, 'offsetHeight', { configurable: true, get: () => inset });

  // The page's scroll region with a header and a card in it.
  const scroller = document.createElement('div');
  const header = document.createElement('header');
  const card = document.createElement('article');
  scroller.append(header, card);
  attach(scroller);
  let top = 0;
  Object.defineProperties(scroller, {
    scrollTop: { configurable: true, get: () => top, set: (v) => { top = v; } },
    scrollHeight: { configurable: true, value: 3000 },
    clientHeight: { configurable: true, value: 800 },
  });
  const under = { el: card };
  document.elementFromPoint = vi.fn(() => under.el);

  const scrollTo = (y, target = scroller) => {
    target.scrollTop = y;
    fireEvent.scroll(target);
    flushFrames();
  };
  const visible = () => scrim.classList.contains('is-visible');
  return { ...view, scrim, scroller, header, card, under, scrollTo, visible };
}

describe('StatusBarScrim', () => {
  beforeEach(() => {
    frames = [];
    extras = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete document.elementFromPoint;
    extras.forEach(el => el.remove());
  });

  it('fades in once scrolled content sits under the status bar, out again at the top', () => {
    const { scrollTo, visible } = setup();
    expect(visible()).toBe(false);

    scrollTo(240);
    expect(visible()).toBe(true);
    // Probed in the middle of the status bar, centred.
    expect(document.elementFromPoint).toHaveBeenLastCalledWith(window.innerWidth / 2, 29.5);

    scrollTo(0);
    expect(visible()).toBe(false);
  });

  it('never shows without a top inset (web, Android)', () => {
    const { scrollTo, visible } = setup({ inset: 0 });
    scrollTo(240);
    expect(visible()).toBe(false);
    expect(document.elementFromPoint).not.toHaveBeenCalled();
  });

  it('stays hidden under a header pinned to the top — it covers the clock itself', () => {
    const { scrollTo, visible, header, under } = setup();
    header.style.position = 'sticky';
    under.el = header;
    scrollTo(240);
    expect(visible()).toBe(false);
  });

  it('stays hidden when what sits under the status bar is not the scrolled content', () => {
    // Explore: the list scrolls below a header that never moves.
    const { scrollTo, visible, under } = setup();
    const fixedHeader = document.createElement('div');
    attach(fixedHeader);
    under.el = fixedHeader;
    scrollTo(240);
    expect(visible()).toBe(false);
  });

  it('is not switched off by a sideways scroller (chip row, gallery)', () => {
    const { scrollTo, visible } = setup();
    scrollTo(240);
    expect(visible()).toBe(true);

    const chips = document.createElement('div');
    attach(chips);
    Object.defineProperties(chips, {
      scrollHeight: { configurable: true, value: 40 },
      clientHeight: { configurable: true, value: 40 },
    });
    fireEvent.scroll(chips);
    flushFrames();
    expect(visible()).toBe(true);
  });

  it('starts hidden again on the next page', () => {
    const { scrollTo, visible, getByText } = setup();
    scrollTo(240);
    expect(visible()).toBe(true);

    fireEvent.click(getByText('go'));
    expect(visible()).toBe(false);
  });
});

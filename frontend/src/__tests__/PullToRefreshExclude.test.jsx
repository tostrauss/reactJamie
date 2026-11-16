import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PullToRefresh from '../components/PullToRefresh';

// Toasts and the offline banner swipe UP to dismiss (16.11.2026). A pull DOWN
// that starts on one of them must not refresh the page — before, it did on
// every pull-to-refresh route (the touch fell through to .app-viewport).
// PullToRefresh reads only touches[].clientX/Y/target, so a plain Event with
// a `touches` list stands in for jsdom's TouchEvent (which wants real Touch
// objects).

const touch = (type, target, y) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'touches', { value: [{ clientX: 50, clientY: y, target }] });
  act(() => { target.dispatchEvent(e); });
};

const pullDown = (el) => {
  touch('touchstart', el, 100);
  touch('touchmove', el, 120);
  touch('touchmove', el, 300);
  touch('touchend', el, 300);
};

const renderHome = () => render(
  <MemoryRouter initialEntries={['/home']}>
    <div className="app-viewport"><div data-testid="feed">Feed</div></div>
    <div className="toast-container"><div className="toast" data-testid="toast">Hallo</div></div>
    <div className="offline-banner" data-testid="offline">Keine Internetverbindung</div>
    <PullToRefresh />
  </MemoryRouter>
);

let listener;
afterEach(() => {
  window.removeEventListener('jamie:pull-refresh', listener);
});

describe('pull-to-refresh leaves the top notices alone', () => {
  it('a pull down on a toast or the offline banner refreshes nothing', () => {
    renderHome();
    listener = vi.fn();
    window.addEventListener('jamie:pull-refresh', listener);
    pullDown(screen.getByTestId('toast'));
    pullDown(screen.getByTestId('offline'));
    expect(listener).not.toHaveBeenCalled();
  });

  it('the same pull on the page itself still refreshes (control)', () => {
    renderHome();
    listener = vi.fn();
    window.addEventListener('jamie:pull-refresh', listener);
    pullDown(screen.getByTestId('feed'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

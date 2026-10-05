import { describe, it, expect, vi, afterEach } from 'vitest';
import { bindRoomToVisibility, isPageHidden } from '../utils/roomPresence';

// Tester 06.10.2026: "Die Push-Benachrichtigungen klappen leider immer noch
// nicht bei mir." The server suppresses a chat push for everyone with a socket
// in that chat's room ("reading it live"). A chat left open in a backgrounded
// TWA / locked phone / background tab kept the socket in the room, so that
// member got no push at all. Hidden must mean "not reading".
const setVisibility = (state) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('bindRoomToVisibility', () => {
  it('leaves the room when the page goes to the background', () => {
    const join = vi.fn(), leave = vi.fn(), onReturn = vi.fn();
    const unbind = bindRoomToVisibility({ join, leave, onReturn });
    setVisibility('hidden');
    expect(leave).toHaveBeenCalledTimes(1);
    expect(join).not.toHaveBeenCalled();
    expect(onReturn).not.toHaveBeenCalled();
    unbind();
  });

  it('re-joins and back-fills on return', () => {
    const join = vi.fn(), leave = vi.fn(), onReturn = vi.fn();
    const unbind = bindRoomToVisibility({ join, leave, onReturn });
    setVisibility('hidden');
    setVisibility('visible');
    expect(join).toHaveBeenCalledTimes(1);
    expect(onReturn).toHaveBeenCalledTimes(1);
    // join before back-fill: a message sent between the two lands via the
    // room broadcast instead of falling into the gap.
    expect(join.mock.invocationCallOrder[0]).toBeLessThan(onReturn.mock.invocationCallOrder[0]);
    unbind();
  });

  it('stops listening after cleanup (page unmounted)', () => {
    const join = vi.fn(), leave = vi.fn();
    const unbind = bindRoomToVisibility({ join, leave });
    unbind();
    setVisibility('hidden');
    setVisibility('visible');
    expect(leave).not.toHaveBeenCalled();
    expect(join).not.toHaveBeenCalled();
  });

  it('works without a back-fill callback', () => {
    const join = vi.fn(), leave = vi.fn();
    const unbind = bindRoomToVisibility({ join, leave });
    expect(() => setVisibility('visible')).not.toThrow();
    expect(join).toHaveBeenCalledTimes(1);
    unbind();
  });
});

describe('isPageHidden', () => {
  it('reflects document.visibilityState', () => {
    setVisibility('hidden');
    expect(isPageHidden()).toBe(true);
    setVisibility('visible');
    expect(isPageHidden()).toBe(false);
  });
});

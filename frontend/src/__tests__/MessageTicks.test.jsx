import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MessageTicks, tickState } from '../components/MessageTicks';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k, i18n: { language: 'de', resolvedLanguage: 'de' } }),
}));

const T0 = '2026-09-15T12:00:00.000Z';
const EARLIER = '2026-09-15T11:59:00.000Z';
const LATER = '2026-09-15T12:01:00.000Z';

const msg = (over = {}) => ({ id: 5, created_at: T0, ...over });

describe('tickState — watermark derivation', () => {
  it('shows nothing on somebody else’s message', () => {
    expect(tickState(msg(), { mine: false, readThrough: LATER })).toBe(null);
  });

  it('is pending while the row has no server id', () => {
    expect(tickState({ id: 'temp-123', created_at: T0, _pending: true }, { mine: true })).toBe('pending');
    // A failed send is its own state — it must never render as "sent".
    expect(tickState({ id: 'temp-123', created_at: T0, _failed: true }, { mine: true })).toBe('failed');
  });

  it('is sent when no watermark has reached the message yet', () => {
    expect(tickState(msg(), { mine: true, deliveredThrough: EARLIER, readThrough: EARLIER })).toBe('sent');
  });

  it('is delivered once the delivered watermark reaches it', () => {
    expect(tickState(msg(), { mine: true, deliveredThrough: T0 })).toBe('delivered');
    expect(tickState(msg(), { mine: true, deliveredThrough: LATER })).toBe('delivered');
  });

  it('is read once the read watermark reaches it, and read outranks delivered', () => {
    expect(tickState(msg(), { mine: true, deliveredThrough: LATER, readThrough: LATER })).toBe('read');
  });

  it('uses the DM row’s own fields when there is no watermark', () => {
    // A freshly loaded DM carries is_read / delivered_at per row; the group
    // path has only watermarks. Both must work through the same function.
    expect(tickState(msg({ is_read: true }), { mine: true })).toBe('read');
    expect(tickState(msg({ delivered_at: T0 }), { mine: true })).toBe('delivered');
  });

  it('heals a stale row from the live watermark', () => {
    // Both chat pages merge refetches by APPENDING unknown ids and never
    // rewrite a row already on screen — so a row that loaded as unread must
    // still be able to turn blue from the socket watermark alone.
    expect(tickState(msg({ is_read: false }), { mine: true, readThrough: LATER })).toBe('read');
  });

  it('never claims read from a watermark that predates the message', () => {
    expect(tickState(msg(), { mine: true, readThrough: EARLIER })).toBe('sent');
  });

  it('degrades to sent rather than throwing on an unparseable timestamp', () => {
    expect(tickState({ id: 5, created_at: 'nonsense' }, { mine: true, readThrough: LATER })).toBe('sent');
  });
});

describe('MessageTicks rendering', () => {
  it('renders one check for sent and two for delivered/read', () => {
    const paths = (state) => {
      const { container } = render(<MessageTicks state={state} />);
      return container.querySelectorAll('svg path').length;
    };
    expect(paths('sent')).toBe(1);
    expect(paths('delivered')).toBe(2);
    expect(paths('read')).toBe(2);
  });

  it('renders nothing at all for a failed send or no state', () => {
    expect(render(<MessageTicks state="failed" />).container.firstChild).toBe(null);
    expect(render(<MessageTicks state={null} />).container.firstChild).toBe(null);
  });

  it('names the state for screen readers', () => {
    const { container } = render(<MessageTicks state="read" />);
    expect(container.querySelector('[aria-label]').getAttribute('aria-label'))
      .toBe('chat.receipts.state.read');
  });
});

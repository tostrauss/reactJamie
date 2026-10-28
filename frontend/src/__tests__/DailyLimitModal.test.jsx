import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Tina's "Tageslimit erreicht" sheet (28.10.2026): the info comes FIRST, the
// Pro section only renders where buying is possible (App Review 3.1.1), and
// "Morgen wieder dabei" always offers the free way out. Real German i18n.
const platform = { upsell: true };
vi.mock('../utils/platform', () => ({ proUpsellAllowed: () => platform.upsell }));

const { DailyLimitModal } = await import('../components/DailyLimitModal');

beforeEach(() => { platform.upsell = true; });

describe('DailyLimitModal', () => {
  it('join variant: title, Tina’s copy, Pro bullets; the CTA closes and opens the Pro sheet with "joins"', () => {
    const onClose = vi.fn();
    const seen = vi.fn();
    window.addEventListener('jamie:open-pro-modal', seen, { once: true });
    render(<DailyLimitModal variant="join" onClose={onClose} />);
    expect(screen.getByText('Tageslimit erreicht')).toBeTruthy();
    expect(screen.getByText(/So bleibt JAMIE aktiv, persönlich und relevant/)).toBeTruthy();
    expect(screen.getByText('Mehr? Dann gerne Pro.')).toBeTruthy();
    expect(screen.getByText('Unbegrenzt Gruppen beitreten')).toBeTruthy();
    expect(screen.getByText('Mehr Gruppen erstellen')).toBeTruthy();
    expect(screen.getByText('Größere Sichtbarkeit')).toBeTruthy();
    fireEvent.click(screen.getByText('JAMIE Pro entdecken'));
    expect(onClose).toHaveBeenCalled();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].detail).toEqual({ feature: 'joins' });
  });

  it('create variant: its own body line, the CTA sends "creates"', () => {
    const seen = vi.fn();
    window.addEventListener('jamie:open-pro-modal', seen, { once: true });
    render(<DailyLimitModal variant="create" onClose={() => {}} />);
    expect(screen.getByText(/Du hast heute schon ein Treffen erstellt/)).toBeTruthy();
    fireEvent.click(screen.getByText('JAMIE Pro entdecken'));
    expect(seen.mock.calls[0][0].detail).toEqual({ feature: 'creates' });
  });

  it('"Morgen wieder dabei" closes without opening the Pro sheet', () => {
    const onClose = vi.fn();
    const seen = vi.fn();
    window.addEventListener('jamie:open-pro-modal', seen, { once: true });
    render(<DailyLimitModal variant="join" onClose={onClose} />);
    fireEvent.click(screen.getByText('Morgen wieder dabei'));
    expect(onClose).toHaveBeenCalled();
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener('jamie:open-pro-modal', seen);
  });

  it('without a purchase path (3.1.1) only the info and "Morgen wieder dabei" render', () => {
    platform.upsell = false;
    render(<DailyLimitModal variant="join" onClose={() => {}} />);
    expect(screen.getByText('Tageslimit erreicht')).toBeTruthy();
    expect(screen.queryByText('Mehr? Dann gerne Pro.')).toBeNull();
    expect(screen.queryByText('JAMIE Pro entdecken')).toBeNull();
    expect(screen.getByText('Morgen wieder dabei')).toBeTruthy();
  });
});

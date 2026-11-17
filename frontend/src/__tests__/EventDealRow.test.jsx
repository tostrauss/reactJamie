import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import EventDealRow from '../components/EventDealRow';

// The deal row on an event's head card (P4 v1, Tina 16.11.2026, Mock 4): the
// server-embedded group.deal, only drawn here. A tap lands where „Jetzt
// einlösen“ is — the deal's page, not the proof screen behind it — and never
// in a tappable card around the row. Real German i18n.
const DEAL = { id: 12, name: 'Café Soleá', deal_label: '1 Getränk gratis', photo: null, verified: true };

const renderRow = (deal, { onCard } = {}) => render(
  <MemoryRouter initialEntries={['/group/42']}>
    <Routes>
      <Route path="/group/:id" element={<div onClick={onCard}><EventDealRow deal={deal} /></div>} />
      <Route path="/deal/:id" element={<div>Deal-Seite</div>} />
      <Route path="/deal/:id/redeem" element={<div>Nachweis</div>} />
    </Routes>
  </MemoryRouter>,
);

describe('EventDealRow', () => {
  it('shows the shop, its ✓ as „Geprüfter Partner“ and the offer in the partner yellow', () => {
    const { container } = renderRow(DEAL);
    expect(screen.getByText('Café Soleá')).toBeInTheDocument();
    const check = screen.getByRole('img', { name: 'Geprüfter Partner' });
    expect(check).toBeInTheDocument();
    // Tina's picture 4: the ✓ is an OUTLINED rosette in the partner yellow —
    // not the filled purple VerifiedBadge the row carried until 17.11.2026.
    expect(check).toHaveClass('event-deal-row-check');
    expect(check.getAttribute('fill')).toBe('none');
    expect(check.getAttribute('stroke')).toBe('currentColor');
    expect(container.querySelector('.verified-badge')).toBeNull();
    expect(screen.getByText('1 Getränk gratis')).toHaveClass('event-deal-row-label');
  });

  it('no ✓ for a deal the server did not mark as checked', () => {
    renderRow({ ...DEAL, verified: false });
    expect(screen.getByText('Café Soleá')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Geprüfter Partner' })).not.toBeInTheDocument();
  });

  // Tina's picture 4 (audit GD-20): the round icon is ALWAYS the shop glyph.
  // Until 17.11.2026 a deal with a photo showed that photo there instead.
  it('always the shop glyph in the round icon — also for a deal with a photo, never an <img>', () => {
    const { container, unmount } = renderRow({ ...DEAL, photo: '/media/uploads/solea.webp' });
    expect(container.querySelector('.event-deal-row img')).toBeNull();
    expect(container.querySelector('.event-deal-row-icon svg')).toBeTruthy();
    unmount();
    const again = renderRow(DEAL);
    expect(again.container.querySelector('.event-deal-row img')).toBeNull();
    expect(again.container.querySelector('.event-deal-row-icon svg')).toBeTruthy();
  });

  it('a tap opens the deal page — and never the card around the row', () => {
    const onCard = vi.fn();
    renderRow(DEAL, { onCard });
    fireEvent.click(screen.getByRole('button', { name: /Café Soleá/ }));
    expect(screen.getByText('Deal-Seite')).toBeInTheDocument();
    expect(screen.queryByText('Nachweis')).not.toBeInTheDocument();
    expect(onCard).not.toHaveBeenCalled();
  });

  it('renders nothing without a deal (none attached, or none visible right now)', () => {
    const { container } = renderRow(null);
    expect(container.querySelector('.event-deal-row')).toBeNull();
  });
});

// The look of Tina's picture 4, pinned in the stylesheet (jsdom draws
// nothing): a frame in the partner line over a 10 % partner-yellow fill, the
// purple icon circle, and glyph, ✓, offer (weight 500) and arrow in the
// partner yellow — through the tokens, never as a colour literal.
describe('event-deal-row.css (Tina 17.11.2026, audit GD-18…25)', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../styles/event-deal-row.css'), 'utf8');
  // Every block that names the selector (alone or last in a list), joined.
  const rule = (selector) => {
    const blocks = [];
    for (let at = css.indexOf(`\n${selector} {`); at > -1; at = css.indexOf(`\n${selector} {`, at + 1)) {
      blocks.push(css.slice(at, css.indexOf('}', at)));
    }
    expect(blocks.length, `rule ${selector}`).toBeGreaterThan(0);
    return blocks.join('\n');
  };

  it('the row is framed in the partner line and filled with 10 % partner yellow', () => {
    const row = rule('.event-deal-row');
    expect(row).toMatch(/border:\s*1px solid var\(--partner-line\)/);
    expect(row).toMatch(/background:\s*rgba\(var\(--accent-partner-rgb\), 0\.10\)/);
    expect(row).toMatch(/--deal-icon-bg:\s*#584F88/);
    expect(row).not.toMatch(/border:\s*none/);
  });

  it('the icon circle is purple with a partner-yellow glyph; ✓ and arrow are partner yellow too', () => {
    const icon = rule('.event-deal-row-icon');
    expect(icon).toMatch(/background:\s*var\(--deal-icon-bg\)/);
    expect(icon).toMatch(/color:\s*var\(--partner-text\)/);
    expect(rule('.event-deal-row-check')).toMatch(/color:\s*var\(--partner-text\)/);
    expect(rule('.event-deal-row-arrow')).toMatch(/color:\s*var\(--partner-text\)/);
  });

  it('the offer is medium weight, not bold', () => {
    const label = rule('.event-deal-row-label');
    expect(label).toMatch(/font-weight:\s*500/);
    expect(label).toMatch(/color:\s*var\(--partner-text\)/);
  });

  it('no partner-yellow literal: the colour lives in the tokens of global.css', () => {
    expect(css).not.toMatch(/#F9E296/i);
    expect(css).not.toMatch(/249,\s*226,\s*150/);
  });
});

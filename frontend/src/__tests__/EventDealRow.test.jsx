import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    renderRow(DEAL);
    expect(screen.getByText('Café Soleá')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Geprüfter Partner' })).toBeInTheDocument();
    expect(screen.getByText('1 Getränk gratis')).toHaveClass('event-deal-row-label');
  });

  it('no ✓ for a deal the server did not mark as checked', () => {
    renderRow({ ...DEAL, verified: false });
    expect(screen.getByText('Café Soleá')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Geprüfter Partner' })).not.toBeInTheDocument();
  });

  it('the deal photo in the round icon when it has one (as a thumb), else the shop glyph', () => {
    const { container, unmount } = renderRow({ ...DEAL, photo: '/media/uploads/solea.webp' });
    expect(container.querySelector('.event-deal-row-icon img')).toHaveAttribute('src', '/media/uploads/solea.webp?size=thumb');
    unmount();
    const again = renderRow(DEAL);
    expect(again.container.querySelector('.event-deal-row-icon img')).toBeNull();
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

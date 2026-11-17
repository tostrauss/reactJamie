import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

// A club in Entdecken → Community → Clubs (Tina 17.11.2026, Bilder 14/15):
// as big as a community card, „Events entdecken“ under the picture, and the ✓
// beside the name ONLY for a paying partner. Real German i18n.
const { ClubCard } = await import('../components/ClubCard');

const club = (over = {}) => ({
  id: 2, name: 'Café Krieau', type: 'club', club_type: 'official', approval_status: 'approved',
  members_count: 37, category: 'Bar', categories: ['Bar', 'Clubbing'], category_label: 'Bar-Hopping · Rooftop',
  image_url: 'https://app.jamie-app.com/media/uploads/krieau.webp', is_private: false, is_paid_partner: false, ...over,
});
const onOpen = vi.fn();
const emojiFor = (c) => ({ Bar: '🍸', Laufen: '🏃' }[c] || '✨');
const renderCard = (over, props = {}) => render(<ClubCard club={club(over)} emojiFor={emojiFor} onOpen={onOpen} {...props} />);
const card = () => document.querySelector('.club-card');
const bubble = () => document.querySelector('.community-card-category')?.textContent ?? null;
const tick = () => document.querySelector('.club-card-verified');

beforeEach(() => { vi.clearAllMocks(); });

describe('ClubCard — the same card as a community', () => {
  it('bubble, title, member count and the cover across the card', () => {
    renderCard();
    expect(card().classList.contains('group-card')).toBe(true);
    expect(card().classList.contains('community-card')).toBe(true);
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Café Krieau');
    expect(screen.getByText('37 Mitglieder')).toBeTruthy();
    const img = card().querySelector('.card-photo-grid img');
    expect(img.getAttribute('src')).toContain('krieau.webp');
    expect(img.getAttribute('alt')).toBe('Café Krieau');
    // No „N anstehende Events“ line any more.
    expect(card().textContent).not.toMatch(/anstehende/);
  });

  it('the bubble: the club\'s own category line first, else the first category with its emoji, else the plain category', () => {
    renderCard();
    expect(bubble()).toBe('Bar-Hopping · Rooftop');
    document.body.innerHTML = '';
    renderCard({ category_label: null });
    expect(bubble()).toBe('🍸 Bar');
    document.body.innerHTML = '';
    renderCard({ category_label: '', categories: [], category: 'Laufen' });
    expect(bubble()).toBe('🏃 Laufen');
    document.body.innerHTML = '';
    renderCard({ category_label: null, categories: null, category: null });
    expect(bubble()).toBeNull();
  });

  it('one member is „1 Mitglied“; member_count is read as well', () => {
    renderCard({ members_count: undefined, member_count: 1 });
    expect(screen.getByText('1 Mitglied')).toBeTruthy();
  });

  it('a hyphenated name does not break at the hyphen; a club without a cover shows its initial', () => {
    renderCard({ name: 'Bar-Hopping Wien', image_url: null, category_label: null });
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Bar‑Hopping Wien');
    expect(card().querySelector('.card-photo-grid img')).toBeNull();
    expect(card().querySelector('.avatar-placeholder').textContent).toBe('B');
  });

  it('a private club keeps the lock beside the member count', () => {
    renderCard({ is_private: true });
    expect(card().querySelector('.community-card-lock').getAttribute('title')).toBe('Beitritt auf Anfrage');
  });
});

describe('ClubCard — the ✓ is for paying partners only', () => {
  it('an official, approved club that does not pay: no tick', () => {
    renderCard({ club_type: 'official', approval_status: 'approved', is_paid_partner: false });
    expect(tick()).toBeNull();
  });

  it('a paying partner: the tick beside the name, announced as „JAMIE-Partner“', () => {
    renderCard({ is_paid_partner: true });
    expect(tick()).toBeTruthy();
    expect(tick().getAttribute('aria-label')).toBe('JAMIE-Partner');
    // Beside the name: on the title's own line.
    expect(tick().parentElement.classList.contains('club-card-title-line')).toBe(true);
    expect(tick().parentElement.querySelector('h3')).toBeTruthy();
  });

  it('fail-closed: a server that does not send the field, or sends anything but true, means no tick', () => {
    for (const value of [undefined, null, 'true', 1, 't']) {
      document.body.innerHTML = '';
      renderCard({ is_paid_partner: value });
      expect(tick()).toBeNull();
    }
  });
});

describe('ClubCard — opening the club', () => {
  it('„Events entdecken“ under the picture opens the club — exactly once', () => {
    renderCard();
    const cta = screen.getByRole('button', { name: 'Events entdecken' });
    expect(cta.classList.contains('club-card-cta')).toBe(true);
    // Under the picture: after it in the card.
    const photo = card().querySelector('.card-photo-grid');
    expect(photo.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(cta);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('a tap on the card opens it too — exactly once', () => {
    renderCard();
    fireEvent.click(card());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('keyboard: Enter or Space on the card opens it; Enter on the button inside does not open it twice', () => {
    renderCard();
    fireEvent.keyDown(card(), { key: 'Enter' });
    fireEvent.keyDown(card(), { key: ' ' });
    expect(onOpen).toHaveBeenCalledTimes(2);
    onOpen.mockClear();
    // A key press on the button bubbles up to the card — which must ignore it.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Events entdecken' }), { key: 'Enter' });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(card(), { key: 'a' });
    expect(onOpen).not.toHaveBeenCalled();
  });
});

// jsdom loads no stylesheet: the rules that make the card a card are pinned
// on the file (pattern of profileCardWidth.test.js).
describe('club-card.css', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../styles/club-card.css'), 'utf8');
  const block = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    return m ? m[1] : null;
  };

  it('the card takes its height from its content, the picture is 2:1 and the button a full 44px tap target', () => {
    expect(block('.clubs-grid .group-card.club-card')).toMatch(/aspect-ratio:\s*auto/);
    expect(block('.club-card .card-photo-grid')).toMatch(/aspect-ratio:\s*2\s*\/\s*1/);
    expect(block('.club-card .card-photo-grid')).toMatch(/flex:\s*none/);
    expect(block('.club-card-cta')).toMatch(/min-height:\s*44px/);
  });

  it('the old row styles are gone from home.css, the deal rows kept theirs', () => {
    const home = fs.readFileSync(path.resolve(__dirname, '../styles/home.css'), 'utf8');
    expect(home).not.toMatch(/\.club-row\b/);
    expect(home).not.toMatch(/\.club-rows\b/);
    expect(home).toMatch(/\.deal-rows\s*\{/);
  });
});

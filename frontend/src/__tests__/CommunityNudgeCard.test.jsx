import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// „Hey, [Community] hat Potenzial! ✨“ — the card for a community without a
// meetup (Tina 17.11.2026, her Bild 17): the community's own picture on the
// left, „Treffen erstellen“ and an X. Real German i18n; the api is mocked.
const api = vi.hoisted(() => ({ communityNudgeApi: { dismiss: vi.fn() } }));
vi.mock('../utils/api', () => api);

const { default: CommunityNudgeCard } = await import('../components/CommunityNudgeCard');

const NUDGE = { id: 9, name: 'Punsch & Rave 2', image_url: 'https://app.jamie-app.com/media/uploads/cover.webp', due_at: '2026-11-16T10:00:00.000Z' };

const Where = () => {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}</div>;
};
const onClose = vi.fn();
const renderCard = (nudge = NUDGE) => render(
  <MemoryRouter initialEntries={['/home']}>
    <Routes><Route path="*" element={<Where />} /></Routes>
    <CommunityNudgeCard nudge={nudge} onClose={onClose} />
  </MemoryRouter>,
);
const where = () => screen.getByTestId('where').textContent;
const tap = async (el) => { await act(async () => { fireEvent.click(el); }); };

beforeEach(() => {
  vi.clearAllMocks();
  api.communityNudgeApi.dismiss.mockResolvedValue({ data: { success: true } });
});

describe('CommunityNudgeCard — what it shows (Bild 17)', () => {
  it('Tina\'s text, character for character, with the community\'s name in coral', () => {
    renderCard();
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('Hey, Punsch & Rave 2 hat Potenzial! ✨');
    expect(heading.textContent.endsWith('✨')).toBe(true);
    const name = heading.querySelector('.pe-nudge-name');
    expect(name.textContent).toBe('Punsch & Rave 2');
    expect(screen.getByText('Jetzt fehlt nur noch das erste Treffen. Leg los!')).toBeTruthy();
    // A dialog named by that sentence.
    const dialog = screen.getByRole('dialog', { name: 'Hey, Punsch & Rave 2 hat Potenzial! ✨' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('button', { name: 'Treffen erstellen' })).toBeTruthy();
  });

  it('the picture on the left is the community\'s own cover', () => {
    renderCard();
    const img = document.querySelector('.pe-nudge-img');
    expect(img.getAttribute('src')).toBe('https://app.jamie-app.com/media/uploads/cover.webp?size=thumb');
    expect(document.querySelector('.pe-nudge-fallback')).toBeNull();
    // The three coral strokes of the mock are decoration.
    expect(document.querySelector('.pe-nudge-spark').getAttribute('aria-hidden')).toBe('true');
  });

  it('a community without a cover: the people icon of the mock instead', () => {
    renderCard({ ...NUDGE, image_url: null });
    expect(document.querySelector('.pe-nudge-img')).toBeNull();
    expect(document.querySelector('.pe-nudge-fallback svg')).toBeTruthy();
  });

  it('a cover that does not load falls back to the icon too', () => {
    renderCard();
    fireEvent.error(document.querySelector('.pe-nudge-img'));
    expect(document.querySelector('.pe-nudge-img')).toBeNull();
    expect(document.querySelector('.pe-nudge-fallback svg')).toBeTruthy();
  });

  it('the name is text, never markup — whatever a community is called', () => {
    renderCard({ ...NUDGE, name: '<1>x</1> <b>f</b> {{name}} <img>' });
    const name = document.querySelector('.pe-nudge-name');
    expect(name.textContent).toBe('<1>x</1> <b>f</b> {{name}} <img>');
    expect(name.children).toHaveLength(0);
    expect(document.querySelector('.pe-nudge-title img, .pe-nudge-title b')).toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).textContent)
      .toBe('Hey, <1>x</1> <b>f</b> {{name}} <img> hat Potenzial! ✨');
  });

  // Sichtprüfung 17.11.2026: a long name pushed „hat Potenzial! ✨“ out of the card.
  it('a very long name is shortened, so the sentence keeps its ending', () => {
    renderCard({ ...NUDGE, name: 'Südtiroler Stammtisch & Wanderfreunde in Wien-Leopoldstadt' });
    const name = document.querySelector('.pe-nudge-name').textContent;
    expect(Array.from(name)).toHaveLength(36);
    expect(name).toBe('Südtiroler Stammtisch & Wanderfreun…');
    expect(screen.getByRole('heading', { level: 2 }).textContent.endsWith(' hat Potenzial! ✨')).toBe(true);
    // A name of exactly 36 characters is left alone.
    document.body.innerHTML = '';
    renderCard({ ...NUDGE, name: 'x'.repeat(36) });
    expect(document.querySelector('.pe-nudge-name').textContent).toBe('x'.repeat(36));
  });

  it('no nudge: renders nothing', () => {
    const { container } = renderCard(null);
    expect(container.querySelector('.pe-nudge-backdrop')).toBeNull();
  });
});

describe('CommunityNudgeCard — the two ways out', () => {
  it('„Treffen erstellen“ closes the card for good and opens the community with its event form', async () => {
    renderCard();
    await tap(screen.getByRole('button', { name: 'Treffen erstellen' }));
    expect(api.communityNudgeApi.dismiss).toHaveBeenCalledWith(9);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(where()).toBe('/club/9?newEvent=1');
  });

  it('the X closes it for good and stays on the home screen', async () => {
    renderCard();
    await tap(screen.getByRole('button', { name: 'Schließen' }));
    expect(api.communityNudgeApi.dismiss).toHaveBeenCalledWith(9);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(where()).toBe('/home');
  });

  it('Escape does the same as the X', async () => {
    renderCard();
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(api.communityNudgeApi.dismiss).toHaveBeenCalledWith(9);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(where()).toBe('/home');
  });

  it('a tap on the dimmed background does nothing', async () => {
    renderCard();
    await tap(document.querySelector('.pe-nudge-backdrop'));
    expect(api.communityNudgeApi.dismiss).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closing never waits for the network: a failing dismiss still closes and still navigates', async () => {
    api.communityNudgeApi.dismiss.mockRejectedValue(new Error('Network Error'));
    renderCard();
    await tap(screen.getByRole('button', { name: 'Treffen erstellen' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(where()).toBe('/club/9?newEvent=1');
  });

  // V-17 Nr. 10: an api module without the new export must not crash the card.
  it('an api module WITHOUT communityNudgeApi: both ways out still work', async () => {
    const { communityNudgeApi } = api;
    delete api.communityNudgeApi;
    try {
      renderCard();
      await tap(screen.getByRole('button', { name: 'Schließen' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      api.communityNudgeApi = communityNudgeApi;
    }
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// „Wie war’s bei X?“ — stars + an optional line of feedback a day after an
// event (Tina 17.11.2026, her Bild 16), with an X to close it for good. Real
// German i18n; the api is mocked.
const api = vi.hoisted(() => ({ postEventApi: { submitRating: vi.fn(), dismissRating: vi.fn() } }));
vi.mock('../utils/api', () => api);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }));

const { default: EventRatingModal } = await import('../components/EventRatingModal');

const EVENT = { group_id: 12, group_name: 'Punsch & Rave 2', event_date: '2026-11-15T19:00:00.000Z', image_url: null };
const SECOND = { group_id: 13, group_name: 'Lauftreff', event_date: '2026-11-14T00:00:00.000Z', image_url: null };

const onDone = vi.fn();
const renderModal = (items = [EVENT]) => render(<EventRatingModal items={items} onDone={onDone} />);
const title = () => screen.getByRole('heading', { level: 2 }).textContent;
const stars = () => screen.getAllByRole('radio');
const star = (n) => screen.getByRole('radio', { name: n === 1 ? '1 Stern' : `${n} Sterne` });
const submitBtn = () => screen.getByRole('button', { name: 'Feedback senden' });
const field = () => screen.getByPlaceholderText('Feedback (optional) …');
const tap = async (el) => { await act(async () => { fireEvent.click(el); }); };

beforeEach(() => {
  vi.clearAllMocks();
  api.postEventApi.submitRating.mockResolvedValue({ data: { success: true } });
  api.postEventApi.dismissRating.mockResolvedValue({ data: { success: true } });
});

describe('EventRatingModal — what it shows (Bild 16)', () => {
  it('the title asks about the event, with the typographic ’ of Tina\'s mock', () => {
    renderModal();
    expect(title()).toBe('Wie war’s bei Punsch & Rave 2?');
    expect(title()).toContain('’');
    const dialog = screen.getByRole('dialog', { name: 'Wie war’s bei Punsch & Rave 2?' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Wir hoffen, du hattest eine gute Zeit!')).toBeTruthy();
  });

  it('five stars as one radio group, none chosen — and „Feedback senden“ waits for a star', () => {
    renderModal();
    expect(screen.getByRole('radiogroup', { name: 'Bewertung' })).toBeTruthy();
    expect(stars()).toHaveLength(5);
    expect(stars().map((s) => s.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'false', 'false']);
    expect(stars().map((s) => s.getAttribute('aria-label'))).toEqual(['1 Stern', '2 Sterne', '3 Sterne', '4 Sterne', '5 Sterne']);
    expect(document.querySelectorAll('.pe-rating-star.is-on')).toHaveLength(0);
    expect(submitBtn().disabled).toBe(true);
  });

  it('the feedback field: optional, a small text box, at most 1000 characters — „…“ is one character', () => {
    renderModal();
    expect(field().tagName).toBe('TEXTAREA');
    expect(field().getAttribute('maxlength')).toBe('1000');
    expect(field().getAttribute('rows')).toBe('2');
    expect(field().getAttribute('placeholder')).toBe('Feedback (optional) …');
  });

  it('nothing to ask: renders nothing', () => {
    const { container } = renderModal([]);
    expect(container.firstChild).toBeNull();
  });
});

describe('EventRatingModal — choosing stars', () => {
  it('star 4: checked, every star up to it lit, the button is live', async () => {
    renderModal();
    await tap(star(4));
    expect(stars().map((s) => s.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'true', 'false']);
    expect(stars().map((s) => s.classList.contains('is-on'))).toEqual([true, true, true, true, false]);
    expect(submitBtn().disabled).toBe(false);
    // Changing one's mind.
    await tap(star(2));
    expect(stars().map((s) => s.classList.contains('is-on'))).toEqual([true, true, false, false, false]);
  });

  it('the arrow keys move the choice like native radios', async () => {
    renderModal();
    await tap(star(3));
    fireEvent.keyDown(star(3), { key: 'ArrowRight' });
    expect(star(4).getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(star(4));
    fireEvent.keyDown(star(4), { key: 'ArrowLeft' });
    fireEvent.keyDown(star(3), { key: 'ArrowLeft' });
    expect(star(2).getAttribute('aria-checked')).toBe('true');
    // One tab stop for the group: the chosen star.
    expect(stars().map((s) => s.getAttribute('tabindex'))).toEqual(['-1', '0', '-1', '-1', '-1']);
  });
});

describe('EventRatingModal — sending', () => {
  it('stars + text: submitRating(id, 4, text), a thank-you, then the next event', async () => {
    renderModal([EVENT, SECOND]);
    await tap(star(4));
    fireEvent.change(field(), { target: { value: 'Super' } });
    await tap(submitBtn());
    expect(api.postEventApi.submitRating).toHaveBeenCalledWith(12, 4, 'Super');
    expect(toast.success).toHaveBeenCalledWith('Danke für dein Feedback!');
    expect(onDone).not.toHaveBeenCalled();
    // The next question starts empty.
    expect(title()).toBe('Wie war’s bei Lauftreff?');
    expect(document.querySelectorAll('.pe-rating-star.is-on')).toHaveLength(0);
    expect(field().value).toBe('');
    expect(submitBtn().disabled).toBe(true);
    await tap(star(5));
    await tap(submitBtn());
    expect(api.postEventApi.submitRating).toHaveBeenLastCalledWith(13, 5, '');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('stars only: the empty field goes out as an empty string (the server stores NULL)', async () => {
    renderModal();
    await tap(star(1));
    await tap(submitBtn());
    expect(api.postEventApi.submitRating).toHaveBeenCalledWith(12, 1, '');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('while sending the button is disabled — no double rating', async () => {
    let finish;
    api.postEventApi.submitRating.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderModal();
    await tap(star(5));
    await tap(submitBtn());
    expect(submitBtn().disabled).toBe(true);
    fireEvent.click(submitBtn());
    expect(api.postEventApi.submitRating).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ data: { success: true } }); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it.each([409, 403])('%i (rated elsewhere / no longer open): on to the next without a word', async (status) => {
    api.postEventApi.submitRating.mockRejectedValue({ response: { status, data: { code: 'ALREADY_RATED' } } });
    renderModal();
    await tap(star(3));
    await tap(submitBtn());
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a server error: the question stays, an error line under the button, a second try works', async () => {
    api.postEventApi.submitRating.mockRejectedValueOnce({ response: { status: 500, data: { error: 'Interner Serverfehler' } } });
    renderModal();
    await tap(star(4));
    fireEvent.change(field(), { target: { value: 'War gut' } });
    await tap(submitBtn());
    expect(screen.getByRole('alert').textContent).toBe('Senden fehlgeschlagen. Bitte erneut versuchen.');
    expect(onDone).not.toHaveBeenCalled();
    // Stars and text are still there.
    expect(star(4).getAttribute('aria-checked')).toBe('true');
    expect(field().value).toBe('War gut');
    expect(submitBtn().disabled).toBe(false);
    await tap(submitBtn());
    expect(api.postEventApi.submitRating).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('offline (no answer at all): the same error line', async () => {
    api.postEventApi.submitRating.mockRejectedValue(new Error('Network Error'));
    renderModal();
    await tap(star(4));
    await tap(submitBtn());
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('EventRatingModal — closing', () => {
  it('the X closes the question for this event on the server and moves on; after the last one onDone', async () => {
    renderModal([EVENT, SECOND]);
    await tap(screen.getByRole('button', { name: 'Schließen' }));
    expect(api.postEventApi.dismissRating).toHaveBeenCalledWith(12);
    expect(api.postEventApi.submitRating).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(title()).toBe('Wie war’s bei Lauftreff?');
    await tap(screen.getByRole('button', { name: 'Schließen' }));
    expect(api.postEventApi.dismissRating).toHaveBeenLastCalledWith(13);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('Escape does the same', async () => {
    renderModal();
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(api.postEventApi.dismissRating).toHaveBeenCalledWith(12);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('a tap on the dimmed background does nothing', async () => {
    renderModal();
    await tap(document.querySelector('.pe-rating-backdrop'));
    expect(api.postEventApi.dismissRating).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closing never waits for the network: a failing dismiss still moves on', async () => {
    api.postEventApi.dismissRating.mockRejectedValue(new Error('Network Error'));
    renderModal();
    await tap(screen.getByRole('button', { name: 'Schließen' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

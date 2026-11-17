import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';

// The queue of everything the app asks after an event (Tina 17.11.2026), and
// the reload that was missing (audit S4-frage-kommt-ios): the questions used
// to be fetched once per login, so a tap on the review push in a running app
// brought up nothing. Real German i18n; the api is mocked.
const api = vi.hoisted(() => ({
  reviews: { getPending: vi.fn(), submit: vi.fn(), dismiss: vi.fn(), notHeld: vi.fn() },
  postEventApi: { getConnectPending: vi.fn(), getRatingsPending: vi.fn() },
  communityNudgeApi: { getMine: vi.fn() },
}));
vi.mock('../utils/api', () => api);

const { default: PostEventPrompts, nextPrompt, PROMPT_ORDER, CHECK_EVERY_MS } =
  await import('../components/PostEventPrompts');

const USER = { id: 7, name: 'Olga' };
const review = (id, name) => ({
  group_id: id, group_name: name, event_date: '2026-11-15T19:00:00.000Z',
  members: [{ id: 21, name: 'Mia', avatar_url: null, age: 27 }],
});
const ok = (data) => Promise.resolve({ data });

const Where = () => {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.search}</div>;
};
const onActiveChange = vi.fn();
const renderAt = async (entry = '/home', props = {}) => {
  const utils = render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
      <PostEventPrompts user={USER} onActiveChange={onActiveChange} {...props} />
    </MemoryRouter>,
  );
  await act(async () => {});
  return utils;
};
const where = () => screen.getByTestId('where').textContent;
const calls = () => [
  api.reviews.getPending, api.postEventApi.getConnectPending,
  api.postEventApi.getRatingsPending, api.communityNudgeApi.getMine,
].map((fn) => fn.mock.calls.length);
const comeBack = async () => {
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
};
const reviewTitle = () => screen.queryByRole('heading', { level: 2 })?.textContent ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T09:00:00.000Z'));
  api.reviews.getPending.mockImplementation(() => ok([]));
  api.postEventApi.getConnectPending.mockImplementation(() => ok([]));
  api.postEventApi.getRatingsPending.mockImplementation(() => ok([]));
  api.communityNudgeApi.getMine.mockImplementation(() => ok([]));
});
afterEach(() => { vi.useRealTimers(); });

describe('nextPrompt — one dialog at a time, in a fixed order', () => {
  const full = { reviews: [1], connect: [1], ratings: [1], community: [1] };

  it('review before connect before rating before the community card', () => {
    expect(PROMPT_ORDER).toEqual(['reviews', 'connect', 'ratings', 'community']);
    expect(nextPrompt(full, { pathname: '/home' })).toBe('reviews');
    expect(nextPrompt({ ...full, reviews: [] }, { pathname: '/home' })).toBe('connect');
    expect(nextPrompt({ ...full, reviews: [], connect: [] }, { pathname: '/home' })).toBe('ratings');
    expect(nextPrompt({ ...full, reviews: [], connect: [], ratings: [] }, { pathname: '/home' })).toBe('community');
    expect(nextPrompt({ reviews: [], connect: [], ratings: [], community: [] }, { pathname: '/home' })).toBeNull();
  });

  it('the community card only on the home screen, and only one per session', () => {
    const only = { reviews: [], connect: [], ratings: [], community: [1] };
    expect(nextPrompt(only, { pathname: '/home' })).toBe('community');
    expect(nextPrompt(only, { pathname: '/profile' })).toBeNull();
    expect(nextPrompt(only, { pathname: '/group/5' })).toBeNull();
    expect(nextPrompt(only, { pathname: '/home', communitySeen: true })).toBeNull();
    // …but the dialogs come on every screen.
    expect(nextPrompt({ ...only, ratings: [1] }, { pathname: '/profile' })).toBe('ratings');
  });

  it('a part nothing can render yet is skipped, never blocking the ones after it', () => {
    expect(nextPrompt(full, { pathname: '/home', can: ['reviews', 'ratings'] })).toBe('reviews');
    expect(nextPrompt({ ...full, reviews: [] }, { pathname: '/home', can: ['reviews', 'ratings'] })).toBe('ratings');
    expect(nextPrompt({ ...full, reviews: [] }, { pathname: '/home', can: ['reviews'] })).toBeNull();
  });
});

describe('PostEventPrompts — when the lists are fetched', () => {
  it('once the user is known: all four lists, each exactly once', async () => {
    await renderAt();
    expect(calls()).toEqual([1, 1, 1, 1]);
  });

  it('no user, or a guest: nothing is fetched', async () => {
    await renderAt('/home', { user: null });
    await renderAt('/home', { user: { id: 3, isGuest: true } });
    expect(calls()).toEqual([0, 0, 0, 0]);
  });

  // S4: back in the foreground the questions are looked up again — throttled.
  it('returning to the app within 5 minutes fetches nothing; after 5 minutes it does', async () => {
    await renderAt();
    expect(calls()).toEqual([1, 1, 1, 1]);
    vi.setSystemTime(new Date(Date.now() + CHECK_EVERY_MS - 1000));
    await comeBack();
    expect(calls()).toEqual([1, 1, 1, 1]);
    vi.setSystemTime(new Date(Date.now() + 2000));
    await comeBack();
    expect(calls()).toEqual([2, 2, 2, 2]);
  });

  it('a hidden tab does not fetch', async () => {
    await renderAt();
    vi.setSystemTime(new Date(Date.now() + CHECK_EVERY_MS + 1000));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await comeBack();
    expect(calls()).toEqual([1, 1, 1, 1]);
    visibility.mockRestore();
  });

  // S4: the review push opens /home?review=1 — in a running app that is only
  // a navigation, so the parameter itself has to trigger the fetch.
  it('?review=1 fetches at once, throttle or not, and the parameter is gone afterwards', async () => {
    function Push() {
      const navigate = useNavigate();
      return <button onClick={() => navigate('/home?review=1&tab=clubs')}>push</button>;
    }
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <Routes><Route path="*" element={<><Where /><Push /></>} /></Routes>
        <PostEventPrompts user={USER} onActiveChange={onActiveChange} />
      </MemoryRouter>,
    );
    await act(async () => {});
    expect(calls()).toEqual([1, 1, 1, 1]);
    // The creator's question fell due meanwhile; ten seconds later the push is tapped.
    api.reviews.getPending.mockImplementation(() => ok([review(12, 'Spieleabend')]));
    vi.setSystemTime(new Date(Date.now() + 10_000));
    await act(async () => { fireEvent.click(screen.getByText('push')); });
    await act(async () => {});
    expect(calls()).toEqual([2, 2, 2, 2]);
    expect(where()).toBe('/home?tab=clubs');          // only OUR parameter is removed
    expect(reviewTitle()).toBe('Spieleabend');
  });

  it('a cold start on /home?review=1 fetches once and cleans the URL', async () => {
    api.reviews.getPending.mockImplementation(() => ok([review(12, 'Spieleabend')]));
    await renderAt('/home?review=1');
    expect(where()).toBe('/home');
    expect(api.reviews.getPending).toHaveBeenCalledTimes(1);
    expect(reviewTitle()).toBe('Spieleabend');
  });

  it('?connect=1 on an event page fetches at once and cleans the URL too', async () => {
    await renderAt('/group/41?connect=1');
    expect(where()).toBe('/group/41');
    expect(calls()).toEqual([1, 1, 1, 1]);
  });

  it('another parameter is none of our business', async () => {
    await renderAt('/home?tab=clubs&review=0');
    expect(where()).toBe('/home?tab=clubs&review=0');
  });
});

describe('PostEventPrompts — what is shown', () => {
  it('„Wer war dabei?“ for the creator; onActiveChange says a dialog is up, and down again when it is done', async () => {
    api.reviews.getPending.mockImplementation(() => ok([review(12, 'Spieleabend')]));
    api.reviews.dismiss.mockResolvedValue({ data: { success: true } });
    await renderAt();
    expect(reviewTitle()).toBe('Spieleabend');
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Überspringen' })); });
    expect(reviewTitle()).toBeNull();
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it('nothing due: nothing rendered, onActiveChange(false)', async () => {
    const { container } = await renderAt();
    expect(container.querySelector('h2')).toBeNull();
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
    expect(onActiveChange).not.toHaveBeenCalledWith(true);
  });

  it('an open dialog is never replaced by a later fetch', async () => {
    api.reviews.getPending.mockImplementation(() => ok([review(12, 'Spieleabend')]));
    await renderAt();
    expect(reviewTitle()).toBe('Spieleabend');
    api.reviews.getPending.mockImplementation(() => ok([review(13, 'Lauftreff')]));
    vi.setSystemTime(new Date(Date.now() + CHECK_EVERY_MS + 1000));
    await comeBack();
    expect(api.reviews.getPending).toHaveBeenCalledTimes(2);
    expect(reviewTitle()).toBe('Spieleabend');
  });

  it('suppressed (sign-up, onboarding): nothing shown, the queue waits', async () => {
    api.reviews.getPending.mockImplementation(() => ok([review(12, 'Spieleabend')]));
    const { rerender } = await renderAt('/home', { suppressed: true });
    expect(reviewTitle()).toBeNull();
    expect(onActiveChange).not.toHaveBeenCalledWith(true);
    rerender(
      <MemoryRouter initialEntries={['/home']}>
        <Routes><Route path="*" element={<Where />} /></Routes>
        <PostEventPrompts user={USER} onActiveChange={onActiveChange} suppressed={false} />
      </MemoryRouter>,
    );
    await act(async () => {});
    expect(reviewTitle()).toBe('Spieleabend');
    expect(api.reviews.getPending).toHaveBeenCalledTimes(1);   // not fetched a second time
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
  });

  it('another account starts with an empty queue and its own fetch', async () => {
    api.reviews.getPending.mockImplementation(() => ok([review(12, 'Spieleabend')]));
    const { rerender } = await renderAt();
    expect(reviewTitle()).toBe('Spieleabend');
    api.reviews.getPending.mockImplementation(() => ok([]));
    rerender(
      <MemoryRouter initialEntries={['/home']}>
        <Routes><Route path="*" element={<Where />} /></Routes>
        <PostEventPrompts user={{ id: 8, name: 'Max' }} onActiveChange={onActiveChange} />
      </MemoryRouter>,
    );
    await act(async () => {});
    expect(api.reviews.getPending).toHaveBeenCalledTimes(2);
    expect(reviewTitle()).toBeNull();
  });
});

describe('PostEventPrompts — each list stands alone', () => {
  it('an older server (404 for the friends list): no crash, the creator\'s question still comes', async () => {
    api.reviews.getPending.mockImplementation(() => ok([review(12, 'Spieleabend')]));
    api.postEventApi.getConnectPending.mockImplementation(() => Promise.reject({ response: { status: 404 } }));
    api.postEventApi.getRatingsPending.mockImplementation(() => Promise.reject(new Error('Network Error')));
    await renderAt();
    expect(reviewTitle()).toBe('Spieleabend');
  });

  it('an answer that is not a list is ignored', async () => {
    api.reviews.getPending.mockImplementation(() => ok({ error: 'Internal server error' }));
    await renderAt();
    expect(reviewTitle()).toBeNull();
    expect(onActiveChange).not.toHaveBeenCalledWith(true);
  });

  // V-17 Nr. 10: existing tests mock ../utils/api without the new exports.
  it('an api mock WITHOUT postEventApi / communityNudgeApi: no crash, the creator\'s question still comes', async () => {
    const { postEventApi, communityNudgeApi } = api;
    delete api.postEventApi;
    delete api.communityNudgeApi;
    try {
      api.reviews.getPending.mockImplementation(() => ok([review(12, 'Spieleabend')]));
      await renderAt();
      expect(reviewTitle()).toBe('Spieleabend');
    } finally {
      api.postEventApi = postEventApi;
      api.communityNudgeApi = communityNudgeApi;
    }
  });
});

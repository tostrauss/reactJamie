import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';

// „Event-Bewertungen“ in the admin dashboard: the stars and feedback from
// „Wie war’s bei X?“ (Tina 17.11.2026), grouped by event. Real German i18n;
// the api is mocked.
const api = vi.hoisted(() => ({ postEventApi: { getRatingsAdmin: vi.fn() } }));
vi.mock('../utils/api', () => api);

const { AdminEventRatingsSection } = await import('../components/AdminEventRatingsSection');

const rating = (group_id, group_name, stars, over = {}) => ({
  group_id, group_name, event_date: '2026-11-15T19:00:00.000Z', type: 'group', club_name: null,
  stars, feedback: null, created_at: '2026-11-16T20:15:00.000Z', user_id: 100 + stars, user_name: `Person ${stars}`, ...over,
});
// Newest first, as the endpoint answers.
const ROWS = [
  rating(12, 'Punsch & Rave 2', 5, { feedback: 'Mega Abend! 🎉', user_id: 1, user_name: 'Rita' }),
  rating(13, 'Clubabend', 2, { type: 'event', club_name: 'Café Soleá', feedback: 'Zu laut', user_id: 4, user_name: 'Jo' }),
  rating(12, 'Punsch & Rave 2', 4, { user_id: 2, user_name: 'Max' }),
  rating(12, 'Punsch & Rave 2', 4, { feedback: 'Gern wieder', user_id: 3, user_name: 'Mia' }),
];

const renderSection = async () => {
  const utils = render(<AdminEventRatingsSection />);
  await act(async () => {});
  return utils;
};
const cards = () => screen.getAllByTestId('rating-event');

beforeEach(() => {
  vi.clearAllMocks();
  api.postEventApi.getRatingsAdmin.mockResolvedValue({ data: { ratings: ROWS, total: 4, limit: 100, offset: 0 } });
});

describe('AdminEventRatingsSection', () => {
  it('loads the newest 100 and shows them grouped by event — name · date · club, the average and the count', async () => {
    await renderSection();
    expect(api.postEventApi.getRatingsAdmin).toHaveBeenCalledWith({ limit: 100 });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Event-Bewertungen (4)');
    expect(cards()).toHaveLength(2);
    // 5 + 4 + 4 = 13 / 3 = 4,33… → „4,3“ (German decimal comma).
    expect(cards()[0].textContent).toContain('Punsch & Rave 2 · 15.11.26');
    expect(cards()[0].textContent).toContain('4,3');
    expect(within(cards()[0]).getByText('3 Bewertungen')).toBeTruthy();
    expect(cards()[1].textContent).toContain('Clubabend · 15.11.26 · Café Soleá');
    expect(cards()[1].textContent).toContain('2,0');
    expect(within(cards()[1]).getByText('1 Bewertung')).toBeTruthy();
  });

  it('under each event the written feedbacks with stars and name — a rating without text only counts', async () => {
    await renderSection();
    const first = within(cards()[0]);
    expect(first.getByText('Mega Abend! 🎉')).toBeTruthy();
    expect(first.getByText('Rita')).toBeTruthy();
    expect(first.getByText('Gern wieder')).toBeTruthy();
    expect(first.getByText('Mia')).toBeTruthy();
    expect(first.queryByText('Max')).toBeNull();          // 4 ★ without text
    expect(within(cards()[1]).getByText('Zu laut')).toBeTruthy();
  });

  it('feedback is shown as text, never as markup', async () => {
    api.postEventApi.getRatingsAdmin.mockResolvedValue({ data: {
      ratings: [rating(12, 'X', 1, { feedback: '<img src=x onerror=alert(1)>' })], total: 1 } });
    await renderSection();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('no ratings yet: the section says so', async () => {
    api.postEventApi.getRatingsAdmin.mockResolvedValue({ data: { ratings: [], total: 0, limit: 100, offset: 0 } });
    await renderSection();
    expect(screen.getByText('Noch keine Bewertungen.')).toBeTruthy();
    expect(screen.queryByTestId('rating-event')).toBeNull();
  });

  it('an older server, a failed request or an answer marked unavailable: nothing is rendered', async () => {
    api.postEventApi.getRatingsAdmin.mockRejectedValue({ response: { status: 404 } });
    const a = await renderSection();
    expect(a.container.firstChild).toBeNull();
    a.unmount();
    api.postEventApi.getRatingsAdmin.mockResolvedValue({ data: { ratings: [], total: 0, unavailable: true } });
    const b = await renderSection();
    expect(b.container.firstChild).toBeNull();
    b.unmount();
    api.postEventApi.getRatingsAdmin.mockResolvedValue({ data: { error: 'Internal server error' } });
    const c = await renderSection();
    expect(c.container.firstChild).toBeNull();
  });

  // V-17 Nr. 10: the dashboard's older tests mock ../utils/api without it.
  it('an api module WITHOUT postEventApi: no crash, nothing rendered', async () => {
    const { postEventApi } = api;
    delete api.postEventApi;
    try {
      const { container } = await renderSection();
      expect(container.firstChild).toBeNull();
    } finally {
      api.postEventApi = postEventApi;
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';

// The „Neues Angebot in Wien“ push createDeal fires is advertising: it may only
// reach people who opted in to news & deals pushes (users.push_news, default
// OFF — App Store Guideline 4.5.4, 16.11.2026), exactly like the news push.
// A missing column (boot window) is never consent: no push at all.
const queries = [];
let recipientsError = null;

vi.mock('../../src/config/database.js', () => ({
  default: {
    query: vi.fn(async (text, params) => {
      queries.push({ text, params });
      if (text.includes('INSERT INTO deals')) {
        return { rows: [{ id: 9, name: 'Café Soleá', deal_label: '2 für 1', address: params[4] }] };
      }
      if (text.includes('JOIN push_subscriptions')) {
        if (recipientsError) throw recipientsError;
        return { rows: [{ id: 3 }, { id: 4 }] };
      }
      return { rows: [] };
    }),
  },
}));

const pushMock = vi.fn(async () => {});
vi.mock('../../src/controllers/pushController.js', () => ({
  sendPushToUsers: (...a) => pushMock(...a),
}));
vi.mock('../../src/utils/geocode.js', () => ({
  resolveCreateLocation: vi.fn(async () => ({ ok: true, coords: { lat: 48.2, lng: 16.35 } })),
}));

const { createDeal } = await import('../../src/controllers/dealController.js');

const makeRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};
const body = { name: 'Café Soleá', deal_label: '2 für 1', address: 'Gumpendorfer Straße 1, 1060 Wien', lat: 48.2, lng: 16.35 };

let warnSpy;
let errSpy;
beforeEach(() => {
  queries.length = 0;
  recipientsError = null;
  pushMock.mockClear();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('deal city push: only with the push_news opt-in', () => {
  it('asks only opted-in accounts in the deal’s city, then pushes them', async () => {
    const res = makeRes();
    await createDeal({ userId: 1, body }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    // fire-and-forget: wait for the fan-out
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalled());
    const sel = queries.find((q) => q.text.includes('JOIN push_subscriptions'));
    expect(sel.text).toContain('u.push_news = TRUE');
    expect(sel.text).toContain('u.is_active = TRUE');
    expect(sel.params).toEqual(['%Wien%']);
    expect(pushMock).toHaveBeenCalledWith([3, 4], expect.any(Function), null, '/deal/9');
    expect(pushMock.mock.calls[0][1]('de')).toEqual({ title: 'Neues Angebot in Wien', body: 'Café Soleá — 2 für 1' });
  });

  it('fails CLOSED without the column (boot window): no push, a warning, no error', async () => {
    recipientsError = Object.assign(new Error('column "push_news" does not exist'), { code: '42703' });
    const res = makeRes();
    await createDeal({ userId: 1, body }, res);
    expect(res.status).toHaveBeenCalledWith(201); // the deal itself is saved
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(warnSpy.mock.calls[0][0]).toContain('push_news missing');
    expect(pushMock).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('any other failure is logged and contained — the create still answers 201', async () => {
    recipientsError = new Error('connection reset');
    const res = makeRes();
    await createDeal({ userId: 1, body }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    await vi.waitFor(() => expect(errSpy).toHaveBeenCalled());
    expect(errSpy.mock.calls[0][0]).toContain('notifyNearbyUsersAboutDeal failed');
    expect(pushMock).not.toHaveBeenCalled();
  });
});

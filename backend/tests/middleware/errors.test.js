import { describe, it, expect, vi } from 'vitest';
import { AppError, asyncHandler, finalErrorHandler } from '../../src/middleware/errors.js';

const makeRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

describe('finalErrorHandler', () => {
  it('lets an AppError speak: its status, message, and code reach the client', () => {
    const res = makeRes();
    finalErrorHandler(new AppError(404, 'Gruppe nicht gefunden', 'GROUP_MISSING'), {}, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Gruppe nicht gefunden', code: 'GROUP_MISSING' });
  });

  it('masks EVERYTHING untyped as 500 — even errors carrying status/code of their own', () => {
    // body-parser 400s, pg SQLSTATEs, http-errors from deps: none may leak.
    const pgish = new Error('bind message supplies 2 parameters');
    pgish.code = '42P08';
    pgish.status = 400;
    const res = makeRes();
    finalErrorHandler(pgish, {}, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Etwas ist schiefgelaufen!' });
  });
});

describe('asyncHandler', () => {
  it('routes an async rejection into next() instead of hanging the request', async () => {
    const boom = new AppError(400, 'Ungültige ID');
    const next = vi.fn();
    await asyncHandler(async () => { throw boom; })({}, makeRes(), next);
    expect(next).toHaveBeenCalledWith(boom);
  });

  it('passes a resolving handler through untouched', async () => {
    const next = vi.fn();
    const res = makeRes();
    await asyncHandler(async (_req, r) => r.json({ ok: true }))({}, res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });
});

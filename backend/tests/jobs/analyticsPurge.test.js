import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const release = vi.fn();
vi.mock('../../src/config/database.js', () => ({
  default: { pool: { connect: async () => ({ query, release }) }, query },
}));

const { runAnalyticsPurge, PURGE_LOCK_ID, PURGE_MAX_ITERATIONS } =
  await import('../../src/jobs/analyticsPurge.js');

const lockOk = { rows: [{ ok: true }] };

/** Queue DELETE rowCounts; the lock/unlock calls are answered automatically. */
const scriptDeletes = (counts) => {
  let i = 0;
  query.mockImplementation(async (sql) => {
    if (sql.includes('pg_try_advisory_lock')) return lockOk;
    if (sql.includes('pg_advisory_unlock')) return { rows: [] };
    return { rowCount: counts[i++] ?? 0 };
  });
};

describe('analytics purge (audit 2026-09-15, finding 7)', () => {
  beforeEach(() => { query.mockReset(); release.mockReset(); });

  it('deletes in bounded chunks until a chunk comes back empty', async () => {
    scriptDeletes([20000, 20000, 7]);
    const r = await runAnalyticsPurge();
    expect(r).toMatchObject({ status: 'ok', deleted: 40007, caughtUp: true });
    // 3 deletes that removed rows + 1 that returned 0 and ended the loop.
    expect(r.iterations).toBe(4);
    const deletes = query.mock.calls.filter(([sql]) => sql.startsWith('DELETE'));
    // Every statement is LIMITed — this is what keeps it under statement_timeout.
    for (const [sql, params] of deletes) {
      expect(sql).toContain('LIMIT $1');
      expect(params[0]).toBe(20000);
    }
  });

  it('skips entirely when another replica holds the advisory lock', async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ ok: false }] };
      return { rowCount: 0 };
    });
    const r = await runAnalyticsPurge();
    expect(r.status).toBe('skipped-lock');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(false);
    // Not holding the lock means not releasing it either.
    expect(query.mock.calls.some(([sql]) => sql.includes('pg_advisory_unlock'))).toBe(false);
  });

  it('stops on its wall-clock budget and says so instead of claiming success', async () => {
    scriptDeletes(new Array(1000).fill(20000));
    let t = 0;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // First call is the start stamp; jump past the 10-minute budget after one chunk.
    const r = await runAnalyticsPurge({ now: () => (t++ === 0 ? 0 : 11 * 60_000) });
    expect(r.caughtUp).toBe(false);
    expect(r.iterations).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('REMAIN'));
    warn.mockRestore();
  });

  it('cannot loop forever even if every chunk keeps finding rows', async () => {
    scriptDeletes(new Array(2000).fill(20000));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await runAnalyticsPurge({ now: () => 0 });   // budget never elapses
    expect(r.iterations).toBe(PURGE_MAX_ITERATIONS);
    expect(r.caughtUp).toBe(false);
    warn.mockRestore();
  });

  it('always releases the lock and the client', async () => {
    scriptDeletes([0]);
    await runAnalyticsPurge();
    const unlock = query.mock.calls.find(([sql]) => sql.includes('pg_advisory_unlock'));
    expect(unlock?.[1]).toEqual([PURGE_LOCK_ID]);
    expect(release).toHaveBeenCalled();
  });

  it('releases the lock even when a DELETE throws', async () => {
    query.mockImplementation(async (sql) => {
      if (sql.includes('pg_try_advisory_lock')) return lockOk;
      if (sql.includes('pg_advisory_unlock')) return { rows: [] };
      throw new Error('deadlock detected');
    });
    await expect(runAnalyticsPurge()).rejects.toThrow('deadlock detected');
    expect(query.mock.calls.some(([sql]) => sql.includes('pg_advisory_unlock'))).toBe(true);
    expect(release).toHaveBeenCalled();
  });
});

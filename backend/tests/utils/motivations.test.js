import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MOTIVATION_KEYS,
  MOTIVATIONS_INVALID,
  MOTIVATIONS_SELECT,
  parseMotivations,
  saveMotivations,
} from '../../src/utils/motivations.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_MIRROR = path.resolve(here, '../../../frontend/src/utils/motivations.js');

// ── The contract that keeps client and server from drifting ───────────────
// The onboarding checklist offers what the frontend list contains; the server
// stores only what its own list contains and silently DROPS the rest. A key
// that exists on one side only is therefore an answer that vanishes without
// any error — invisible in review, so the two files are compared directly.
describe('client/server motivation key mirror', () => {
  const parseKeys = (src) => {
    const body = src.match(/export const MOTIVATION_KEYS\s*=\s*(?:Object\.freeze\(\s*)?\[([\s\S]*?)\]/)?.[1];
    if (!body) throw new Error('MOTIVATION_KEYS literal not found in the frontend mirror');
    return [...body.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  };

  it('frontend/src/utils/motivations.js lists exactly the same keys, in the same order', () => {
    const mirror = parseKeys(fs.readFileSync(FRONTEND_MIRROR, 'utf8'));
    // Order matters too: it is the order the checklist renders and the order
    // the admin dashboard lists the counts in.
    expect(mirror).toEqual([...MOTIVATION_KEYS]);
  });

  it('is the five options of Tina\'s checklist, frozen and without duplicates', () => {
    expect(MOTIVATION_KEYS).toEqual([
      'new_in_town', 'new_friends', 'activity_partners', 'discover_places', 'more_active',
    ]);
    expect(Object.isFrozen(MOTIVATION_KEYS)).toBe(true);
    expect(new Set(MOTIVATION_KEYS).size).toBe(MOTIVATION_KEYS.length);
  });
});

describe('parseMotivations', () => {
  it('absent or null means "keep what is stored"', () => {
    expect(parseMotivations(undefined)).toEqual({ provided: false });
    expect(parseMotivations(null)).toEqual({ provided: false });
  });

  it('[] is a real answer and clears the stored one', () => {
    expect(parseMotivations([])).toEqual({ provided: true, value: [] });
  });

  it('normalises: allowlist order, deduped, trimmed', () => {
    expect(parseMotivations(['more_active', ' new_in_town ', 'more_active', 'new_in_town']))
      .toEqual({ provided: true, value: ['new_in_town', 'more_active'] });
  });

  it('drops unknown keys instead of rejecting the save (old bundles, retired keys)', () => {
    expect(parseMotivations(['retired_key', 'new_friends', 'Neue Freundschaften schließen']))
      .toEqual({ provided: true, value: ['new_friends'] });
    expect(parseMotivations(['nope'])).toEqual({ provided: true, value: [] });
  });

  it('rejects anything that is not a short array of strings', () => {
    for (const bad of ['new_friends', 5, true, {}, { 0: 'new_friends' }, [1], [null], ['new_friends', {}]]) {
      expect(parseMotivations(bad), JSON.stringify(bad)).toEqual({ provided: true, error: true });
    }
    const twenty = Array.from({ length: 20 }, () => 'new_friends');
    expect(parseMotivations(twenty)).toEqual({ provided: true, value: ['new_friends'] });
    expect(parseMotivations([...twenty, 'more_active'])).toEqual({ provided: true, error: true });
  });

  it('the 400 body carries a code for the frontend error mapping', () => {
    expect(MOTIVATIONS_INVALID).toMatchObject({ code: 'MOTIVATIONS_INVALID', error: expect.any(String) });
  });
});

describe('saveMotivations', () => {
  it('writes one stringified jsonb array — a raw JS array would reach Postgres as {a,b}', async () => {
    const db = { query: vi.fn(async () => ({ rowCount: 1, rows: [] })) };
    await expect(saveMotivations(db, 7, ['new_in_town', 'more_active'])).resolves.toBe(true);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toBe('UPDATE users SET motivations = $2::jsonb WHERE id = $1');
    expect(params).toEqual([7, '["new_in_town","more_active"]']);
  });

  it('a missing column (boot window, 42703) drops the answer without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = { query: vi.fn(async () => { throw Object.assign(new Error('column "motivations" does not exist'), { code: '42703' }); }) };
    await expect(saveMotivations(db, 7, ['new_friends'])).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('any other error is the caller\'s problem', async () => {
    const db = { query: vi.fn(async () => { throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }); }) };
    await expect(saveMotivations(db, 7, ['new_friends'])).rejects.toThrow('connection reset');
  });
});

describe('MOTIVATIONS_SELECT', () => {
  it('reads the column through the row image, so a missing column is NULL instead of a 500', () => {
    expect(MOTIVATIONS_SELECT).toBe(`(to_jsonb(users) -> 'motivations') AS motivations`);
  });
});

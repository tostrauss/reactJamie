import { describe, it, expect } from 'vitest';
import { clubAliveSql, partnerSql } from '../../src/utils/clubGate.js';

// „☆ Partner“ (Tina 16.11.2026, rule decided by Tobi): an event a live OFFICIAL
// club put up itself. The SQL is pinned here; the real-Postgres smoke test runs
// it (owner / co-manager / plain member / community / plain group).
describe('partnerSql', () => {
  const sql = partnerSql('g');

  it('is about club EVENTS of a live official parent club', () => {
    expect(sql).toContain("g.type = 'event'");
    expect(sql).toContain('pc.id = g.parent_club_id');
    expect(sql).toContain(clubAliveSql('pc'));
    expect(sql).toContain("pc.club_type = 'official'");
  });

  it('only what the club itself put up: the event creator is its owner or a co-manager', () => {
    expect(sql).toContain('pc.owner_id = g.owner_id');
    expect(sql).toContain("mgr.user_id = g.owner_id AND mgr.role = 'admin'");
  });

  it('never reads the event row’s own (NULL) club_type, never treats a set club_type as official', () => {
    expect(sql).not.toContain('g.club_type');
    expect(sql).not.toMatch(/COALESCE/i);
    expect(sql).not.toMatch(/club_type IS NOT NULL/i);
    expect(sql).not.toContain("'community'");
  });

  it('is a plain boolean expression usable in any SELECT list', () => {
    expect(sql.startsWith('(')).toBe(true);
    expect(sql.endsWith(')')).toBe(true);
    // Substrings other controllers' unit-test mocks route on.
    for (const routed of ['FROM group_members gm', 'LEFT JOIN group_members gm ON gm.group_id = g.id',
      'FROM group_join_requests jr', 'attendance-tiers']) {
      expect(sql).not.toContain(routed);
    }
  });
});

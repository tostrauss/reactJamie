import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const query = vi.fn();
vi.mock('../../src/config/database.js', () => ({ default: { query } }));

const { runPartnerLeadsPurge, partnerLeadsRetentionMonths, PARTNER_LEADS_RETENTION_DEFAULT } =
  await import('../../src/jobs/partnerLeadsPurge.js');

describe('partner_leads retention (P-3, Tobi 18.11.2026: 12 months)', () => {
  let log, error;
  beforeEach(() => {
    query.mockReset();
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PARTNER_LEADS_RETENTION_MONTHS;
  });

  it('the env value: unset, empty or garbage → 12; a whole number counts; 0 = off', () => {
    expect(PARTNER_LEADS_RETENTION_DEFAULT).toBe(12);
    expect(partnerLeadsRetentionMonths(undefined)).toBe(12);
    expect(partnerLeadsRetentionMonths('')).toBe(12);
    expect(partnerLeadsRetentionMonths('zwölf')).toBe(12);
    expect(partnerLeadsRetentionMonths('-3')).toBe(12);
    expect(partnerLeadsRetentionMonths('1.5')).toBe(12);
    expect(partnerLeadsRetentionMonths(' 24 ')).toBe(24);
    expect(partnerLeadsRetentionMonths('0')).toBe(0);
    process.env.PARTNER_LEADS_RETENTION_MONTHS = '6';
    expect(partnerLeadsRetentionMonths()).toBe(6);
  });

  it('by default: one DELETE by the date the request came in, 12 months, and the count is logged', async () => {
    query.mockResolvedValueOnce({ rowCount: 3 });
    expect(await runPartnerLeadsPurge()).toEqual({ status: 'ok', deleted: 3, months: 12 });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM partner_leads\s+WHERE created_at < NOW\(\) - make_interval\(months => \$1::int\)/);
    expect(params).toEqual([12]);
    expect(log.mock.calls.flat().join(' ')).toContain('3 request(s) older than 12 months deleted');
  });

  it('the env value sets the months', async () => {
    process.env.PARTNER_LEADS_RETENTION_MONTHS = '18';
    query.mockResolvedValueOnce({ rowCount: 0 });
    expect(await runPartnerLeadsPurge()).toEqual({ status: 'ok', deleted: 0, months: 18 });
    expect(query.mock.calls[0][1]).toEqual([18]);
  });

  it('0 = off: the database is not touched', async () => {
    process.env.PARTNER_LEADS_RETENTION_MONTHS = '0';
    expect(await runPartnerLeadsPurge()).toEqual({ status: 'off', deleted: 0, months: 0 });
    expect(await runPartnerLeadsPurge({ months: -1 })).toMatchObject({ status: 'off' });
    expect(await runPartnerLeadsPurge({ months: NaN })).toMatchObject({ status: 'off' });
    expect(query).not.toHaveBeenCalled();
  });

  it('a missing table (42P01) is no error and does not throw', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('relation "partner_leads" does not exist'), { code: '42P01' }));
    expect(await runPartnerLeadsPurge()).toEqual({ status: 'no-table', deleted: 0, months: 12 });
    expect(error).not.toHaveBeenCalled();
  });

  it('any other failure is logged and never thrown', async () => {
    query.mockRejectedValueOnce(new Error('connection terminated'));
    expect(await runPartnerLeadsPurge()).toEqual({ status: 'error', deleted: 0, months: 12 });
    expect(error.mock.calls.flat().join(' ')).toContain('connection terminated');
  });
});

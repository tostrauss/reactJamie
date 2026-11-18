import db from '../config/database.js';

/**
 * Daily retention for `partner_leads` („JAMIE Anfrage“ / Partner-Anfragen,
 * controllers/partnerController.js). Tobi, 18.11.2026: a request is deleted
 * 12 months after it came in.
 *
 * A request carries a name, a company, an e-mail address and a phone number.
 * The admin list only ever shows the newest 200, so without this job old
 * requests would stay in the table for good, unseen.
 *
 * PARTNER_LEADS_RETENTION_MONTHS: unset or not a whole number ≥ 0 → 12;
 * 0 → the job deletes nothing (emergency switch).
 *
 * One plain DELETE: the table gets a handful of rows a week (one request per
 * club and person a day, 5 an hour per account), and idx_partner_leads_created
 * carries the range. Running it twice, or on two replicas at once, is
 * harmless — the second run finds nothing.
 *
 * Never throws: a missing table (boot window, 42P01) or any other error is
 * logged and reported in the result.
 */

export const PARTNER_LEADS_RETENTION_DEFAULT = 12;

// The env value → months. '' / garbage / negative → the default; '0' → 0 (off).
export function partnerLeadsRetentionMonths(raw = process.env.PARTNER_LEADS_RETENTION_MONTHS) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,4}$/.test(text)) return PARTNER_LEADS_RETENTION_DEFAULT;
  return Number(text);
}

/**
 * @returns {{status: 'ok'|'off'|'no-table'|'error', deleted: number, months: number}}
 */
export async function runPartnerLeadsPurge({ months = partnerLeadsRetentionMonths() } = {}) {
  if (!Number.isInteger(months) || months <= 0) {
    return { status: 'off', deleted: 0, months: 0 };
  }
  try {
    const res = await db.query(
      `DELETE FROM partner_leads
        WHERE created_at < NOW() - make_interval(months => $1::int)`,
      [months]
    );
    const deleted = res?.rowCount || 0;
    console.log(`[partner-leads-purge] ${deleted} request(s) older than ${months} months deleted`);
    return { status: 'ok', deleted, months };
  } catch (err) {
    if (err?.code === '42P01') {
      console.log('[partner-leads-purge] partner_leads is not there yet — nothing to do');
      return { status: 'no-table', deleted: 0, months };
    }
    console.error('[partner-leads-purge] failed:', err?.message);
    return { status: 'error', deleted: 0, months };
  }
}

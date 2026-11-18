/**
 * Partner requests („JAMIE Anfrage“, table partner_leads) and account deletion.
 *
 * Tobi 18.11.2026: a request goes with the account. The FK alone only clears
 * user_id (ON DELETE SET NULL), so name, e-mail and phone would stay until the
 * 12-month purge (jobs/partnerLeadsPurge.js). Both deletion paths (the user's
 * own and the admin's) call this inside their transaction, right before
 * DELETE FROM users.
 *
 * Inside a SAVEPOINT: in the boot window the table may not exist yet (42P01),
 * and any error here must never abort the transaction — the account deletion
 * itself is what matters.
 */
export async function deletePartnerLeadsOfUser(client, userId) {
  try {
    await client.query('SAVEPOINT partner_leads_of_user');
    await client.query('DELETE FROM partner_leads WHERE user_id = $1', [userId]);
    await client.query('RELEASE SAVEPOINT partner_leads_of_user');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT partner_leads_of_user').catch(() => {});
    if (err?.code !== '42P01') console.error('[partner-leads] delete with account failed:', err?.message);
  }
}

// Monthly Executive renewal (founder's decision 2026-10-09): the subscription renews every month
// automatically on the card saved at sign-up/upgrade. Turning auto-renewal off means the Customer
// drops back to Regular when the month they already paid for ends - they keep Executive until then.
//
// Run by the scheduler through POST /internal/renew-subscriptions (see jobs/renewExecutiveSubscriptions.js).
// Safe to run more than once: each renewal has its own deterministic charge reference, and
// executive_subscriptions.paystack_charge_reference is unique, so a period can only be renewed once.
//
// A renewal's price is the CURRENT admin_settings Executive price (same as a new sign-up), locked
// into that period's row.
//
// ASSUMPTION (not yet confirmed with the founder): if the renewal charge is declined, the Customer
// drops back to Regular straight away - there is no grace period or retry yet.

const { pool, withTransaction } = require('../../db/pool');
const payments = require('../payments');
const checkoutService = require('../checkout/checkoutService');
const { toKobo } = require('../checkout/checkoutMath');

const JOB_LOCK_KEY = 704201; // arbitrary constant: only one renewal run at a time

async function downgrade(client, subscriptionId, customerUserId) {
  await client.query(
    `UPDATE executive_subscriptions SET status = 'expired' WHERE id = $1`,
    [subscriptionId]
  );
  await client.query(`UPDATE customers SET tier = 'regular' WHERE user_id = $1`, [customerUserId]);
}

async function renewOne(sub) {
  // Auto-renew off, or no reusable saved card: the paid month simply ends.
  if (!sub.auto_renew || !sub.paystack_authorization_code || sub.card_reusable === false) {
    await withTransaction((client) => downgrade(client, sub.id, sub.customer_user_id));
    return 'downgraded';
  }

  const reference = `renewal_${sub.id}`;
  const already = await pool.query(
    'SELECT 1 FROM executive_subscriptions WHERE paystack_charge_reference = $1',
    [reference]
  );
  if (already.rows.length > 0) {
    // Renewed on an earlier run but the old row was not closed out - finish that.
    await pool.query(`UPDATE executive_subscriptions SET status = 'expired' WHERE id = $1`, [sub.id]);
    return 'renewed';
  }

  const preview = await checkoutService.getExecutiveSubscriptionPreview();
  const charge = await payments.chargeAuthorization({
    amountKobo: toKobo(preview.totalChargedNaira),
    email: sub.email,
    authorizationCode: sub.paystack_authorization_code,
    reference,
    metadata: {
      kind: 'executive_subscription_renewal',
      customerUserId: sub.customer_user_id,
      previousSubscriptionId: sub.id,
      totalChargedNaira: preview.totalChargedNaira,
    },
  });

  if (charge.status !== 'success') {
    await withTransaction((client) => downgrade(client, sub.id, sub.customer_user_id));
    return 'declined_downgraded';
  }

  await withTransaction(async (client) => {
    await client.query(`UPDATE executive_subscriptions SET status = 'expired' WHERE id = $1`, [sub.id]);
    await client.query(
      `INSERT INTO executive_subscriptions
         (customer_user_id, status, base_fee_naira, admin_costs_naira, vat_naira, total_charged_naira,
          started_at, current_period_ends_at, paystack_charge_reference,
          paystack_authorization_code, card_brand, card_last4, card_reusable, auto_renew)
       VALUES ($1, 'active', $2, $3, $4, $5, $6, $6::timestamptz + interval '1 month', $7, $8, $9, $10, $11, true)
       ON CONFLICT (paystack_charge_reference) WHERE paystack_charge_reference IS NOT NULL DO NOTHING`,
      [
        sub.customer_user_id,
        preview.baseFeeNaira,
        preview.adminCostsNaira,
        preview.vatNaira,
        preview.totalChargedNaira,
        sub.current_period_ends_at, // the new month starts exactly where the last one ended
        reference,
        sub.paystack_authorization_code,
        sub.card_brand,
        sub.card_last4,
        sub.card_reusable,
      ]
    );
  });
  return 'renewed';
}

/**
 * Renews (or lets lapse) every Executive period that has ended.
 * @param {{now?:Date}} [options]
 * @returns {Promise<{checked:number, renewed:number, downgraded:number, declined:number, failed:number}>}
 */
async function runRenewals({ now = new Date() } = {}) {
  const lock = await pool.connect();
  const result = { checked: 0, renewed: 0, downgraded: 0, declined: 0, failed: 0 };
  try {
    const got = await lock.query('SELECT pg_try_advisory_lock($1) AS ok', [JOB_LOCK_KEY]);
    if (!got.rows[0].ok) return { ...result, skipped: 'another renewal run is in progress' };

    const { rows } = await pool.query(
      `SELECT s.*, u.email
         FROM executive_subscriptions s
         JOIN users u ON u.id = s.customer_user_id
        WHERE s.status = 'active' AND s.current_period_ends_at <= $1
        ORDER BY s.current_period_ends_at`,
      [now]
    );

    for (const sub of rows) {
      result.checked += 1;
      try {
        const outcome = await renewOne(sub);
        if (outcome === 'renewed') result.renewed += 1;
        else if (outcome === 'downgraded') result.downgraded += 1;
        else result.declined += 1;
      } catch (err) {
        // One bad record must not stop everyone else's renewal; it stays 'active' and is retried
        // on the next run.
        result.failed += 1;
        console.error(`Renewal failed for subscription ${sub.id}:`, err.message);
      }
    }
    return result;
  } finally {
    try {
      await lock.query('SELECT pg_advisory_unlock($1)', [JOB_LOCK_KEY]);
    } finally {
      lock.release();
    }
  }
}

module.exports = { runRenewals };

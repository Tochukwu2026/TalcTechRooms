// Lets a signed-in Regular Customer upgrade to Executive by paying the first month's
// subscription through Paystack - same two-step shape as bookings (see
// src/modules/booking/bookingService.js): initialize a charge, then finalize it once Paystack
// confirms the payment, from either the Paystack webhook or the app's own "verify" call.
//
// Nothing about the Customer changes until the charge actually succeeds - the tier only flips
// inside finalizeUpgrade, after payments.verifyCharge says 'success'.
//
// Also used at sign-up: registering "as Executive" creates a Regular account and the app sends the
// Customer straight into this same payment flow (see customerService.registerCustomer).
//
// The card used is saved (Paystack's reusable authorization token + brand + last 4 - never the card
// number) so next month's charge can be taken without re-entering it.
//
// NOT built yet: the monthly renewal charge itself, and dropping the tier back to 'regular' when a
// period lapses unpaid. This version charges and records one month (current_period_ends_at = +1 month).

const { pool, withTransaction } = require('../../db/pool');
const ApiError = require('../../utils/ApiError');
const payments = require('../payments');
const checkoutService = require('../checkout/checkoutService');
const { toKobo } = require('../checkout/checkoutMath');
const { assertCustomerIdVerified } = require('../booking/bookingService');

async function initializeUpgrade(customerUserId, customerEmail) {
  const { rows } = await pool.query('SELECT tier FROM customers WHERE user_id = $1', [customerUserId]);
  if (rows.length === 0) {
    throw new ApiError(404, 'Customer account not found.');
  }
  if (rows[0].tier === 'executive') {
    throw new ApiError(409, 'You are already an Executive Customer.');
  }

  await assertCustomerIdVerified(customerUserId);

  // Priced at the CURRENT admin_settings rates and locked into the charge's metadata, same as a
  // booking - so what the Customer saw is what they are charged and what gets recorded.
  const preview = await checkoutService.getExecutiveSubscriptionPreview();

  const reference = payments.generateReference('subscription');
  const metadata = {
    kind: 'executive_subscription',
    customerUserId,
    baseFeeNaira: preview.baseFeeNaira,
    adminCostsNaira: preview.adminCostsNaira,
    vatNaira: preview.vatNaira,
    totalChargedNaira: preview.totalChargedNaira,
  };

  const charge = await payments.initializeCharge({
    amountKobo: toKobo(preview.totalChargedNaira),
    email: customerEmail,
    reference,
    metadata,
  });

  return {
    reference: charge.reference,
    authorizationUrl: charge.authorizationUrl,
    totalChargedNaira: preview.totalChargedNaira,
  };
}

function toSubscriptionResponse(row) {
  return {
    id: row.id,
    customerUserId: row.customer_user_id,
    status: row.status,
    baseFeeNaira: Number(row.base_fee_naira),
    adminCostsNaira: Number(row.admin_costs_naira),
    vatNaira: Number(row.vat_naira),
    totalChargedNaira: Number(row.total_charged_naira),
    startedAt: row.started_at,
    currentPeriodEndsAt: row.current_period_ends_at,
    paystackChargeReference: row.paystack_charge_reference,
    autoRenew: row.auto_renew,
    card: row.card_last4 ? { brand: row.card_brand, last4: row.card_last4 } : null,
  };
}

/**
 * Finalizes a previously-initialized upgrade charge. Idempotent - safe to call twice for the
 * same reference (the webhook and the Customer's own verify call can both arrive).
 * @returns {Promise<{status:'upgraded'|'already_finalized'|'payment_failed'|'not_found', subscription?:object}>}
 */
async function finalizeUpgrade(reference) {
  const existing = await pool.query(
    'SELECT * FROM executive_subscriptions WHERE paystack_charge_reference = $1',
    [reference]
  );
  if (existing.rows.length > 0) {
    return { status: 'already_finalized', subscription: toSubscriptionResponse(existing.rows[0]) };
  }

  const verified = await payments.verifyCharge(reference);
  if (verified.status === 'not_found') {
    return { status: 'not_found' };
  }
  if (verified.status !== 'success') {
    return { status: 'payment_failed' };
  }

  const meta = verified.metadata;
  if (!meta || meta.kind !== 'executive_subscription') {
    // Never silently upgrade someone off a foreign/malformed reference.
    throw new ApiError(500, 'Charge succeeded but is missing the expected subscription metadata.');
  }
  if (verified.amountKobo !== null && verified.amountKobo !== toKobo(meta.totalChargedNaira)) {
    throw new ApiError(500, 'Charge amount does not match the quoted subscription price.');
  }

  // The card Paystack just charged, saved for next month's renewal (token + brand + last 4 only).
  const auth = verified.raw && verified.raw.authorization ? verified.raw.authorization : null;

  return withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO executive_subscriptions
         (customer_user_id, status, base_fee_naira, admin_costs_naira, vat_naira, total_charged_naira,
          current_period_ends_at, paystack_charge_reference,
          paystack_authorization_code, card_brand, card_last4, card_reusable)
       VALUES ($1, 'active', $2, $3, $4, $5, now() + interval '1 month', $6, $7, $8, $9, $10)
       ON CONFLICT (paystack_charge_reference) WHERE paystack_charge_reference IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        meta.customerUserId,
        meta.baseFeeNaira,
        meta.adminCostsNaira,
        meta.vatNaira,
        meta.totalChargedNaira,
        reference,
        auth ? auth.authorization_code : null,
        auth ? auth.brand : null,
        auth ? auth.last4 : null,
        auth ? Boolean(auth.reusable) : null,
      ]
    );

    if (inserted.rows.length === 0) {
      // Lost a race with the other finalize path - it already did the work.
      const raced = await client.query(
        'SELECT * FROM executive_subscriptions WHERE paystack_charge_reference = $1',
        [reference]
      );
      return { status: 'already_finalized', subscription: toSubscriptionResponse(raced.rows[0]) };
    }

    await client.query(`UPDATE customers SET tier = 'executive' WHERE user_id = $1`, [meta.customerUserId]);
    return { status: 'upgraded', subscription: toSubscriptionResponse(inserted.rows[0]) };
  });
}

module.exports = { initializeUpgrade, finalizeUpgrade };

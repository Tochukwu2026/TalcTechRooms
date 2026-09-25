// Real booking creation, on top of a Paystack charge - see spec/decisions-and-phasing.md >
// Build Phasing > "Deliberately NOT built yet" note (now being built).
//
// Two-step flow, matching how Paystack's own Initialize/Verify transaction API works:
//   1. initializeBooking(...) - validates the request (listing exists, units available,
//      computes the cost breakdown at CURRENT admin_settings rates), then asks Paystack to
//      start a charge. Nothing is written to the `bookings` table yet - per the decisions log,
//      "a booking only exists after payment", and the bookings schema has no "pending" status
//      to represent an unpaid attempt. The full cost breakdown is locked into the charge's
//      `metadata` at this point, so whatever rates were in effect when the Customer started
//      checkout are what they're actually charged and what the booking is created with later,
//      even if Admin changes commission/VAT/fees in between.
//   2. finalizeBooking(reference) - checks what Paystack says actually happened to that charge
//      and, if it succeeded, creates the `bookings` row. Called from two places that both lead
//      here (webhookRoutes.js for Paystack's own webhook, bookingRoutes.js for a Customer-
//      triggered manual "verify my payment" check) - safe to call more than once for the same
//      reference; the second call is a no-op that returns the already-created booking.
//
// Renter payout (the two-path 9pm-WAT hold/release logic) is NOT built yet - every booking
// created here just sits at payout_status='held' (Path A's starting state) until that's built.
// Refunding a Customer when availability changes between initialize and finalize (see the
// conflict case below) is also not built yet, for the same reason - flagged in the return
// value so the caller can tell the Customer to contact support for now.

const { pool } = require('../../db/pool');
const ApiError = require('../../utils/ApiError');
const payments = require('../payments');
const availability = require('./availabilityService');
const checkoutService = require('../checkout/checkoutService');
const { toKobo } = require('../checkout/checkoutMath');

/**
 * Per spec/decisions-and-phasing.md > Business Rules > ID verification: a Customer whose ID
 * verification failed is not yet allowed to book (registration still creates the account, per
 * customerService's own comment, but booking is gated here rather than at signup). Only the
 * MOST RECENT verification attempt counts, so a Customer who re-submits after an initial
 * failure isn't stuck forever - there's no "resubmit ID" endpoint yet, but this check is
 * already written to accommodate one when it exists.
 */
async function assertCustomerIdVerified(customerUserId) {
  const { rows } = await pool.query(
    `SELECT status FROM id_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [customerUserId]
  );
  if (rows.length === 0 || rows[0].status !== 'verified') {
    throw new ApiError(403, 'Your ID verification has not passed yet, so you cannot book a stay.');
  }
}

/**
 * Starts a booking's payment. Returns what the client needs to send the Customer to Paystack's
 * hosted checkout page (or, in mock mode, a fake stand-in for it) - not a booking, since none
 * exists yet.
 */
async function initializeBooking(customerUserId, customerEmail, accommodationId, { checkIn, checkOut, units }) {
  await assertCustomerIdVerified(customerUserId);
  const quote = await checkoutService.resolveBookingQuote(accommodationId, checkIn, checkOut, units);
  const { breakdown } = quote;

  const reference = payments.generateReference('booking');
  const metadata = {
    kind: 'booking',
    accommodationId,
    customerUserId,
    checkIn,
    checkOut,
    units,
    numberOfUnits: quote.numberOfUnits,
    rentNaira: breakdown.baseAmountNaira,
    adminCostsNaira: breakdown.adminCostsNaira,
    vatNaira: breakdown.vatNaira,
    totalChargedNaira: breakdown.totalChargedNaira,
    commissionNaira: breakdown.commissionNaira,
    renterGrossPayoutNaira: breakdown.payoutGrossNaira,
  };

  const charge = await payments.initializeCharge({
    amountKobo: toKobo(breakdown.totalChargedNaira),
    email: customerEmail,
    reference,
    metadata,
  });

  return {
    reference: charge.reference,
    authorizationUrl: charge.authorizationUrl,
    accommodationId,
    checkIn,
    checkOut,
    units,
    totalChargedNaira: breakdown.totalChargedNaira,
  };
}

async function findBookingByReference(reference) {
  const { rows } = await pool.query(`SELECT * FROM bookings WHERE paystack_charge_reference = $1`, [reference]);
  return rows[0] || null;
}

function toBookingResponse(row) {
  return {
    id: row.id,
    accommodationId: row.accommodation_id,
    customerUserId: row.customer_user_id,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    unitsBooked: row.units_booked,
    rentNaira: Number(row.rent_naira),
    adminCostsNaira: Number(row.admin_costs_naira),
    vatNaira: Number(row.vat_naira),
    totalChargedNaira: Number(row.total_charged_naira),
    commissionNaira: Number(row.commission_naira),
    renterGrossPayoutNaira: Number(row.renter_gross_payout_naira),
    renterNetPayoutNaira: Number(row.renter_net_payout_naira),
    status: row.status,
    payoutStatus: row.payout_status,
    paystackChargeReference: row.paystack_charge_reference,
    createdAt: row.created_at,
  };
}

/**
 * Finalizes a previously-initialized charge: verifies it with Paystack, and if (and only if)
 * it succeeded, creates the booking. Idempotent - safe to call twice for the same reference
 * (e.g. both the webhook and a Customer's manual verify call land for the same payment).
 * @returns {Promise<{status:'created'|'already_finalized'|'payment_failed'|'not_found'|'availability_conflict', booking?:object}>}
 */
async function finalizeBooking(reference) {
  const existing = await findBookingByReference(reference);
  if (existing) {
    return { status: 'already_finalized', booking: toBookingResponse(existing) };
  }

  const verified = await payments.verifyCharge(reference);

  if (verified.status === 'not_found') {
    return { status: 'not_found' };
  }
  if (verified.status !== 'success') {
    return { status: 'payment_failed' };
  }

  const meta = verified.metadata;
  if (!meta || meta.kind !== 'booking') {
    // Defensive - shouldn't happen for a reference this module generated itself, but a
    // malformed/foreign reference should never silently create a booking.
    throw new ApiError(500, 'Charge succeeded but is missing the expected booking metadata.');
  }

  // Re-check availability at finalize time (time has passed since initialize, and someone else
  // may have booked in the meantime) - the Rent/Admin Costs/VAT figures stay LOCKED to what was
  // computed and charged at initialize time regardless, since that's what Paystack actually
  // charged the Customer's card.
  const stillAvailable = await availability.getUnitsAvailable(
    meta.accommodationId,
    meta.numberOfUnits,
    meta.checkIn,
    meta.checkOut
  );
  if (meta.units > stillAvailable) {
    // The Customer has already been charged but the units are gone - refunding this
    // automatically needs the Paystack refund/transfer plumbing, which isn't built yet (see
    // module header). Surface this clearly rather than silently creating an invalid booking or
    // silently dropping the Customer's money.
    return { status: 'availability_conflict', reference, totalChargedNaira: meta.totalChargedNaira };
  }

  const renterNetPayoutNaira = meta.renterGrossPayoutNaira; // no Paystack transfer fee logic yet (payout module not built) - see decisions log Renter Payout > Fee handling.

  const { rows } = await pool.query(
    `INSERT INTO bookings (
       accommodation_id, customer_user_id, check_in_date, check_out_date, units_booked,
       rent_naira, admin_costs_naira, vat_naira, total_charged_naira,
       commission_naira, renter_gross_payout_naira, renter_net_payout_naira,
       status, payout_status, paystack_charge_reference
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', 'held', $13)
     RETURNING *`,
    [
      meta.accommodationId,
      meta.customerUserId,
      meta.checkIn,
      meta.checkOut,
      meta.units,
      meta.rentNaira,
      meta.adminCostsNaira,
      meta.vatNaira,
      meta.totalChargedNaira,
      meta.commissionNaira,
      meta.renterGrossPayoutNaira,
      renterNetPayoutNaira,
      reference,
    ]
  );

  return { status: 'created', booking: toBookingResponse(rows[0]) };
}

async function getBookingForCustomer(bookingId, customerUserId) {
  const { rows } = await pool.query(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
  if (rows.length === 0) {
    throw new ApiError(404, 'Booking not found.');
  }
  // Compared in SQL, not JS, since customer_user_id is a Postgres BIGINT (returned to Node as a
  // string) - matches the ownership-check pattern used elsewhere (e.g. accommodationService's
  // `WHERE id = $1 AND renter_user_id = $2`) rather than risking a string/number mismatch here.
  const owned = await pool.query(`SELECT 1 FROM bookings WHERE id = $1 AND customer_user_id = $2`, [
    bookingId,
    customerUserId,
  ]);
  if (owned.rows.length === 0) {
    throw new ApiError(403, 'You do not have permission to view this booking.');
  }
  return toBookingResponse(rows[0]);
}

module.exports = { initializeBooking, finalizeBooking, getBookingForCustomer };

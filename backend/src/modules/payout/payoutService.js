// Two-path Renter payout - see spec/decisions-and-phasing.md > Business Rules > Renter Payout.
// Path A: an active booking's funds are held until 9pm WAT on check-in day, released the moment
// the Customer confirms check-in (not literally at 9pm - "by 9pm" just means the deadline for
// the Customer to act; a confirmation fires the payout immediately, whenever it happens before
// the deadline). If the Customer instead reports a problem, the payout stays held and an Admin
// review case is opened. If neither happens by 9pm, the check-in-day evaluation job (see
// src/jobs/evaluateCheckInDayPayouts.js) flags the booking for Admin review itself.
// Path B: a confirmed no-refund cancellation (<7 days before check-in, or on/after check-in)
// releases the payout instantly, independent of check-in day - see cancelBooking below.
//
// Everything here is in scope per the founder's "Everything except real scheduling" answer:
// built and tested, EXCEPT the 9pm trigger is a standalone script an external scheduler (cron,
// GCP Cloud Scheduler) will invoke later - see src/jobs/evaluateCheckInDayPayouts.js - not wired
// to any real cron infrastructure here.

const { pool } = require('../../db/pool');
const ApiError = require('../../utils/ApiError');
const payments = require('../payments');
const { toKobo } = require('../checkout/checkoutMath');

const NO_REFUND_WINDOW_DAYS = 7; // Cancellation/Refund: full refund if >=7 days before check-in.

/** "Today" as a plain 'YYYY-MM-DD' string in WAT (UTC+1, fixed offset, no DST) - matches how
 * check_in_date/check_out_date are stored and compared elsewhere (plain ISO date strings, see
 * db/pool.js's DATE type-parser override). Deliberately NOT `new Date().toISOString().slice(0,
 * 10)`, which would give the date in UTC, not WAT - a booking whose check-in is "today" in
 * Lagos could still read as "yesterday" or "tomorrow" in UTC depending on the time of day. */
function todayInWat() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Whole days between today (WAT) and an ISO date string - negative once that date is in the
 * past. Both sides are plain 'YYYY-MM-DD' strings, so this compares via Date at UTC midnight for
 * both, which is safe here since only the DIFFERENCE in days matters, not either date's own
 * timezone-of-day - unlike todayInWat() itself, which does need the +1h WAT adjustment. */
function daysUntil(isoDateString) {
  const today = new Date(`${todayInWat()}T00:00:00Z`);
  const target = new Date(`${isoDateString}T00:00:00Z`);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

/**
 * Fetches a booking together with the Renter's bank details and user id (needed for the
 * Paystack Transfer call and for admin_review_cases bookkeeping) - joins through
 * accommodations.renter_user_id, since bookings itself has no renter reference.
 */
async function getBookingWithRenter(bookingId) {
  const { rows } = await pool.query(
    `SELECT b.*, a.renter_user_id,
            r.bank_name, r.bank_account_number, r.bank_account_name
     FROM bookings b
     JOIN accommodations a ON a.id = b.accommodation_id
     JOIN renters r ON r.user_id = a.renter_user_id
     WHERE b.id = $1`,
    [bookingId]
  );
  if (rows.length === 0) {
    throw new ApiError(404, 'Booking not found.');
  }
  return rows[0];
}

/**
 * Opens (or reuses, if one is already open for this booking) an Admin review case.
 */
async function openReviewCase(client, bookingId, reason, notes) {
  const existing = await client.query(
    `SELECT id FROM admin_review_cases WHERE booking_id = $1 AND status = 'open'`,
    [bookingId]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }
  const { rows } = await client.query(
    `INSERT INTO admin_review_cases (booking_id, reason, notes) VALUES ($1, $2, $3) RETURNING id`,
    [bookingId, reason, notes || null]
  );
  return rows[0].id;
}

/**
 * Actually pays the Renter - shared by both paths (Path A's confirm-check-in release and the
 * evaluation job's release side isn't used - the job only ever flags, never releases - and
 * Path B's instant release on a no-refund cancellation). Runs the Transfer, then either marks
 * the booking released or, if the transfer itself fails (e.g. bad bank details), opens an Admin
 * review case rather than silently losing track of an unpaid Renter - same "never silently
 * mishandle money" approach as the availability-conflict case in bookingService.finalizeBooking.
 * @returns {Promise<{payoutStatus:'released'|'admin_review'}>}
 */
async function releasePayoutForBooking(booking) {
  if (booking.payout_status === 'released') {
    return { payoutStatus: 'released' }; // idempotent - already paid
  }

  if (!booking.bank_account_number || !booking.bank_name || !booking.bank_account_name) {
    // No point even calling Paystack - fail fast into the same admin-review path a real
    // transfer failure would take, so an Admin can chase the Renter for bank details.
    return withReviewCase(booking.id, 'other', 'Renter has not supplied bank details yet.');
  }

  const transferReference = payments.generateReference('payout');
  const result = await payments.initiateTransfer({
    amountKobo: toKobo(booking.renter_net_payout_naira),
    accountNumber: booking.bank_account_number,
    bankName: booking.bank_name,
    accountName: booking.bank_account_name,
    reference: transferReference,
    reason: `TalcTech Rooms payout - booking #${booking.id}`,
  });

  if (result.status !== 'success') {
    return withReviewCase(
      booking.id,
      'other',
      `Payout transfer failed (reference ${transferReference}) - see server logs / Paystack dashboard.`
    );
  }

  await pool.query(
    `UPDATE bookings
     SET payout_status = 'released', payout_released_at = now(), paystack_transfer_reference = $2
     WHERE id = $1`,
    [booking.id, result.transferReference]
  );
  return { payoutStatus: 'released' };
}

async function withReviewCase(bookingId, reason, notes) {
  await pool.query(`UPDATE bookings SET payout_status = 'admin_review' WHERE id = $1`, [bookingId]);
  await openReviewCase(pool, bookingId, reason, notes);
  return { payoutStatus: 'admin_review' };
}

function assertOwnedByCustomer(booking, customerUserId) {
  // BIGINT columns round-trip as strings from node-pg (see decisions log) - compare as strings,
  // never bare ===, matching the pattern already used in bookingService.getBookingForCustomer.
  if (String(booking.customer_user_id) !== String(customerUserId)) {
    throw new ApiError(403, 'You do not have permission to act on this booking.');
  }
}

/**
 * Customer confirms they checked in - Path A's "everything's fine" outcome. Releases the
 * payout immediately (the decisions log's "by 9pm" is the deadline for the Customer to act, not
 * a reason to wait until 9pm once they already have).
 */
async function confirmCheckIn(bookingId, customerUserId) {
  const booking = await getBookingWithRenter(bookingId);
  assertOwnedByCustomer(booking, customerUserId);

  if (booking.status !== 'active') {
    throw new ApiError(409, `Booking is '${booking.status}' - check-in can only be confirmed for an active booking.`);
  }

  await pool.query(`UPDATE bookings SET status = 'checked_in_confirmed' WHERE id = $1`, [bookingId]);
  const payoutResult = await releasePayoutForBooking(booking);
  return { status: 'checked_in_confirmed', ...payoutResult };
}

/**
 * Customer reports a problem/fraud instead of confirming check-in - Path A's other outcome.
 * Payout stays held; an Admin review case is opened for manual investigation (see decisions
 * log's Fraud override - if fraud is confirmed, the Admin later resolves this case as
 * refund_customer via resolveReviewCase below, which is where the actual refund happens).
 */
async function reportProblem(bookingId, customerUserId, notes) {
  const booking = await getBookingWithRenter(bookingId);
  assertOwnedByCustomer(booking, customerUserId);

  if (booking.status !== 'active') {
    throw new ApiError(409, `Booking is '${booking.status}' - a problem can only be reported for an active booking.`);
  }

  await pool.query(`UPDATE bookings SET status = 'fraud_reported' WHERE id = $1`, [bookingId]);
  await openReviewCase(pool, bookingId, 'fraud_report', notes);
  return { status: 'fraud_reported', payoutStatus: booking.payout_status };
}

/**
 * Customer cancels. Branches on the >=7-days-before-check-in cutoff (Cancellation/Refund in the
 * decisions log): refundable cancellations refund the Rent portion only (never VAT/Admin Costs
 * - see Refund scope) and never pay the Renter; no-refund cancellations pay the Renter and
 * TalcTech instantly (Path B), independent of check-in day/the 9pm job.
 */
async function cancelBooking(bookingId, customerUserId) {
  const booking = await getBookingWithRenter(bookingId);
  assertOwnedByCustomer(booking, customerUserId);

  if (booking.status !== 'active') {
    throw new ApiError(409, `Booking is '${booking.status}' - only an active booking can be cancelled.`);
  }

  const refundable = daysUntil(booking.check_in_date) >= NO_REFUND_WINDOW_DAYS;

  if (refundable) {
    await pool.query(
      `UPDATE bookings SET status = 'canceled_refundable', payout_status = 'not_applicable' WHERE id = $1`,
      [bookingId]
    );
    await pool.query(
      `INSERT INTO refunds (booking_id, amount_naira, reason) VALUES ($1, $2, 'customer_cancellation')`,
      [bookingId, booking.rent_naira]
    );
    return { status: 'canceled_refundable', payoutStatus: 'not_applicable', refundedRentNaira: Number(booking.rent_naira) };
  }

  await pool.query(`UPDATE bookings SET status = 'canceled_no_refund' WHERE id = $1`, [bookingId]);
  const payoutResult = await releasePayoutForBooking(booking);
  return { status: 'canceled_no_refund', ...payoutResult };
}

/**
 * Admin resolves an open review case - either by releasing the held payout (the report/no-show
 * turned out to be unfounded) or by refunding the Customer (fraud confirmed - see Fraud override
 * in the decisions log: full refund of the Rent portion only, Renter never paid). Uses
 * 'fraud_confirmed' as the refund reason code for BOTH a fraud-report case and a no-show case
 * resolved this way, since a customer-initiated cancellation (the 'customer_cancellation' reason
 * code) is a distinct, separate path - see cancelBooking above.
 */
async function resolveReviewCase(caseId, adminUserId, { resolution, notes }) {
  const { rows } = await pool.query(`SELECT * FROM admin_review_cases WHERE id = $1`, [caseId]);
  if (rows.length === 0) {
    throw new ApiError(404, 'Review case not found.');
  }
  const reviewCase = rows[0];
  if (reviewCase.status !== 'open') {
    throw new ApiError(409, 'This review case has already been resolved.');
  }

  const booking = await getBookingWithRenter(reviewCase.booking_id);
  let result;

  if (resolution === 'release_payout') {
    result = await releasePayoutForBooking(booking);
  } else {
    await pool.query(
      `UPDATE bookings SET status = 'canceled_no_refund', payout_status = 'not_applicable' WHERE id = $1`,
      [booking.id]
    );
    await pool.query(
      `INSERT INTO refunds (booking_id, amount_naira, reason) VALUES ($1, $2, 'fraud_confirmed')`,
      [booking.id, booking.rent_naira]
    );
    result = { payoutStatus: 'not_applicable', refundedRentNaira: Number(booking.rent_naira) };
  }

  await pool.query(
    `UPDATE admin_review_cases
     SET status = 'resolved', resolved_by = $2, resolved_at = now(), notes = COALESCE($3, notes)
     WHERE id = $1`,
    [caseId, adminUserId, notes || null]
  );

  return { caseId, resolution, ...result };
}

async function listReviewCases(status = 'open') {
  const { rows } = await pool.query(
    `SELECT c.id, c.booking_id, c.reason, c.status, c.notes, c.opened_at, c.resolved_at,
            b.check_in_date, b.check_out_date, b.status AS booking_status, b.payout_status,
            b.renter_net_payout_naira
     FROM admin_review_cases c
     JOIN bookings b ON b.id = c.booking_id
     WHERE c.status = $1
     ORDER BY c.opened_at ASC`,
    [status]
  );
  return rows;
}

module.exports = {
  todayInWat,
  daysUntil,
  getBookingWithRenter,
  releasePayoutForBooking,
  confirmCheckIn,
  reportProblem,
  cancelBooking,
  resolveReviewCase,
  listReviewCases,
};

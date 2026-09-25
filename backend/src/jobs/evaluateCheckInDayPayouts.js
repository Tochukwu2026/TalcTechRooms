#!/usr/bin/env node
// Standalone script for the 9pm-WAT check-in-day payout evaluation - see spec/decisions-and-
// phasing.md > Renter Payout, Path A's third outcome: "Neither a confirmation nor a complaint by
// 9pm -> the booking is flagged for Admin review rather than auto-paid".
//
// Deliberately NOT an HTTP endpoint and NOT wired to any real cron infrastructure - the founder's
// own explicit choice ("A standalone script" over "Admin-triggered endpoint", 2026-09-25). This
// is meant to be invoked once a day, at/after 9pm WAT, by an external scheduler once one exists
// (a cron entry, GCP Cloud Scheduler hitting `node src/jobs/evaluateCheckInDayPayouts.js` via
// SSH/a Cloud Run job, etc.) - see package.json's "evaluate-payouts" script for the exact command.
// Running it more than once on the same day, or re-running it for a day already evaluated, is
// safe: a booking that's no longer 'active'/'held' (already confirmed, reported, or cancelled)
// is simply skipped, so there's no harm in the external scheduler firing this twice or the job
// being retried after a crash.
//
// What it does NOT do: release any payout. Path A's release happens the moment the Customer
// confirms check-in (see payoutService.confirmCheckIn) - by the time 9pm rolls around, a booking
// still sitting here is BY DEFINITION one the Customer neither confirmed nor reported, so the
// only outcome this job ever produces is flagging for Admin review, never a payout.

const { pool } = require('../db/pool');
const { todayInWat } = require('../modules/payout/payoutService');

/**
 * Finds every still-active, still-held booking whose check-in date is today (WAT) or earlier
 * (the "or earlier" guards against the job not having run on the actual check-in day for some
 * reason - e.g. the scheduler was down - so a booking never falls through the cracks entirely),
 * flags each one for Admin review, and opens a review case for it.
 * @returns {Promise<{evaluatedDate:string, flaggedBookingIds:number[]}>}
 */
async function evaluateCheckInDayPayouts() {
  const evaluatedDate = todayInWat();

  const { rows } = await pool.query(
    `SELECT id FROM bookings
     WHERE status = 'active' AND payout_status = 'held' AND check_in_date <= $1`,
    [evaluatedDate]
  );

  const flaggedBookingIds = [];
  for (const row of rows) {
    await pool.query(`UPDATE bookings SET payout_status = 'admin_review' WHERE id = $1`, [row.id]);
    await pool.query(
      `INSERT INTO admin_review_cases (booking_id, reason, notes)
       SELECT $1, 'no_show_no_response', 'Neither confirmed nor reported by 9pm WAT on check-in day.'
       WHERE NOT EXISTS (
         SELECT 1 FROM admin_review_cases WHERE booking_id = $1 AND status = 'open'
       )`,
      [row.id]
    );
    flaggedBookingIds.push(row.id);
  }

  return { evaluatedDate, flaggedBookingIds };
}

// CLI entrypoint - only runs when this file is executed directly (`node
// src/jobs/evaluateCheckInDayPayouts.js` / `npm run evaluate-payouts`), not when required by a
// test file, so tests can call evaluateCheckInDayPayouts() directly without also triggering a
// process.exit().
if (require.main === module) {
  evaluateCheckInDayPayouts()
    .then((result) => {
      // eslint-disable-next-line no-console
      console.log(
        `[evaluate-payouts] ${result.evaluatedDate}: flagged ${result.flaggedBookingIds.length} booking(s) for admin review` +
          (result.flaggedBookingIds.length ? ` (ids: ${result.flaggedBookingIds.join(', ')})` : '')
      );
      return pool.end();
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[evaluate-payouts] failed:', err);
      process.exitCode = 1;
      return pool.end();
    });
}

module.exports = { evaluateCheckInDayPayouts };

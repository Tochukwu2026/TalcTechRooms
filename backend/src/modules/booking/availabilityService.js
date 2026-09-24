const { pool } = require('../../db/pool');

/**
 * How many of an accommodation's units are still free for a given [checkInDate, checkOutDate)
 * stay, i.e. number_of_units minus units already held by bookings that overlap that range and
 * haven't been canceled.
 *
 * Two half-open date ranges [aIn, aOut) and [bIn, bOut) overlap exactly when aIn < bOut AND
 * aOut > bIn - so a checkout on the same day as another booking's check-in does NOT overlap
 * (the unit turns over same-day), matching how hotel/Airbnb-style booking calendars normally
 * work and matching spec/requirements-v1.md's "Units tab ... depleting as units are booked".
 *
 * Every non-canceled booking status (active, checked_in_confirmed, fraud_reported, completed)
 * still counts as occupying the unit for its dates - only the two canceled statuses free it up.
 * No booking-creation endpoint exists yet (see decisions log), so today this will always
 * return number_of_units until that's built, but the query is correct for when it is.
 */
async function getUnitsAvailable(accommodationId, numberOfUnits, checkInDate, checkOutDate, client = pool) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(units_booked), 0) AS booked
     FROM bookings
     WHERE accommodation_id = $1
       AND status NOT IN ('canceled_refundable', 'canceled_no_refund')
       AND check_in_date < $3
       AND check_out_date > $2`,
    [accommodationId, checkInDate, checkOutDate]
  );
  const booked = Number(rows[0].booked);
  return Math.max(numberOfUnits - booked, 0);
}

module.exports = { getUnitsAvailable };

const { Pool, types } = require('pg');
const config = require('../config');

// By default node-postgres parses a plain DATE column (OID 1082, e.g. bookings.check_in_date)
// into a JS Date object at LOCAL MIDNIGHT in the server process's own timezone, then that Date
// gets serialized back out however the caller happens to print it - which, depending on the
// server's TZ, can silently shift the calendar date by a day when converted to/compared as
// UTC. Found while building the payout feature's check-in-day math (spec/decisions-and-
// phasing.md > Renter Payout - "day of check-in" has to mean the exact date, unambiguously,
// regardless of what timezone the process happens to be running in). Keeping it as the plain
// 'YYYY-MM-DD' string Postgres itself sends is simpler and exactly matches how the rest of the
// app already treats check-in/check-out dates (as ISO date strings, never Date objects) - see
// checkoutService.resolveBookingQuote and availabilityService.getUnitsAvailable.
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: config.db.connectionString,
});

pool.on('error', (err) => {
  // A background/idle client error should not crash the whole process.
  // eslint-disable-next-line no-console
  console.error('Unexpected error on idle PostgreSQL client', err);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };

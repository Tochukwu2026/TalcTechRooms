// Admin-controlled list of states where Executive Feature Viewings (Live/Video) are switched off
// because TalcTech has no staff physically present there. Everything else (rentals, Regular
// Customers, Executive membership itself) keeps working in those states.
//
// Founder's request (2026-10-14). Keyed by the listing's state (price_caps.state), since a viewing
// happens at the listing. Viewings already booked before a state was restricted are left alone
// (the Admin can reassign/cancel those by hand); only NEW availability lookups and bookings are
// blocked.

const { pool } = require('../../db/pool');
const ApiError = require('../../utils/ApiError');

async function listStatesWithStatus() {
  const { rows } = await pool.query(
    `SELECT s.state, (r.state IS NOT NULL) AS restricted, r.restricted_at
     FROM (SELECT DISTINCT state FROM price_caps) s
     LEFT JOIN viewing_restricted_states r ON r.state = s.state
     ORDER BY s.state ASC`
  );
  return rows.map((r) => ({ state: r.state, restricted: r.restricted, restrictedAt: r.restricted_at }));
}

async function listRestrictedStates() {
  const { rows } = await pool.query('SELECT state FROM viewing_restricted_states ORDER BY state ASC');
  return rows.map((r) => r.state);
}

async function setRestriction({ state, restricted, adminUserId }) {
  const known = await pool.query('SELECT 1 FROM price_caps WHERE state = $1 LIMIT 1', [state]);
  if (known.rowCount === 0) {
    throw new ApiError(404, `"${state}" is not a supported state.`);
  }
  if (restricted) {
    await pool.query(
      `INSERT INTO viewing_restricted_states (state, restricted_by_user_id) VALUES ($1, $2)
       ON CONFLICT (state) DO NOTHING`,
      [state, adminUserId]
    );
  } else {
    await pool.query('DELETE FROM viewing_restricted_states WHERE state = $1', [state]);
  }
  return { state, restricted: Boolean(restricted) };
}

/** Throws 403 if the accommodation sits in a state where viewings are switched off. */
async function assertViewingsOfferedFor(client, accommodationId) {
  const { rows } = await client.query(
    `SELECT pc.state FROM accommodations a
     JOIN price_caps pc ON pc.id = a.price_cap_id
     JOIN viewing_restricted_states r ON r.state = pc.state
     WHERE a.id = $1`,
    [accommodationId]
  );
  if (rows.length > 0) {
    throw new ApiError(
      403,
      `Executive viewings aren't available in ${rows[0].state} yet. Booking and renting there works as normal.`
    );
  }
}

module.exports = { listStatesWithStatus, listRestrictedStates, setRestriction, assertViewingsOfferedFor };

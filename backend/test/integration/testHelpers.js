const { pool } = require('../../src/db/pool');

// Order matters: children before parents (FK constraints).
const TABLES_TO_CLEAN = [
  'notifications_log',
  'viewing_bookings',
  'refunds',
  'admin_review_cases',
  'bookings',
  'accommodation_amenities',
  'accommodation_images',
  'viewing_availability',
  'accommodations',
  'executive_subscriptions',
  'id_verifications',
  'customers',
  'renters',
  'users',
];

async function cleanDatabase() {
  for (const table of TABLES_TO_CLEAN) {
    await pool.query(`DELETE FROM ${table}`);
  }
}

async function closeDatabase() {
  await pool.end();
}

module.exports = { cleanDatabase, closeDatabase };

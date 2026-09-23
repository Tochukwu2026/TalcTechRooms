const { Pool } = require('pg');
const config = require('../config');

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

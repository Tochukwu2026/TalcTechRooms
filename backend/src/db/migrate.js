#!/usr/bin/env node
/**
 * Minimal migration runner.
 *
 * Migrations live in src/db/migrations as pairs of files:
 *   0001_description.up.sql
 *   0001_description.down.sql
 *
 * Usage:
 *   node src/db/migrate.js up            # apply all pending migrations
 *   node src/db/migrate.js up 0003        # apply up to and including 0003_*
 *   node src/db/migrate.js down           # roll back the single most recent migration
 *   node src/db/migrate.js down 0001      # roll back down to (and including) 0002.., stop before 0001
 *   node src/db/migrate.js status         # list applied vs pending migrations
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

function listMigrationFiles() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.up.sql'));
  const names = files.map((f) => f.replace(/\.up\.sql$/, '')).sort();
  return names;
}

async function getAppliedMigrations() {
  const { rows } = await pool.query('SELECT name FROM schema_migrations ORDER BY name ASC');
  return rows.map((r) => r.name);
}

async function up(targetName) {
  await ensureMigrationsTable();
  const all = listMigrationFiles();
  const applied = new Set(await getAppliedMigrations());
  const pending = all.filter((n) => !applied.has(n));

  if (pending.length === 0) {
    console.log('No pending migrations. Database is up to date.');
    return;
  }

  for (const name of pending) {
    const filePath = path.join(MIGRATIONS_DIR, `${name}.up.sql`);
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log(`Applying ${name} ...`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      console.log(`  -> applied.`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  -> FAILED: ${err.message}`);
      throw err;
    } finally {
      client.release();
    }

    if (targetName && name.startsWith(targetName)) {
      break;
    }
  }
  console.log('Migrations complete.');
}

async function down(targetName) {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  if (applied.length === 0) {
    console.log('No migrations to roll back.');
    return;
  }

  const toRollback = [...applied].reverse();

  for (const name of toRollback) {
    const filePath = path.join(MIGRATIONS_DIR, `${name}.down.sql`);
    if (!fs.existsSync(filePath)) {
      console.error(`Missing down migration for ${name}, stopping.`);
      break;
    }
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log(`Rolling back ${name} ...`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('DELETE FROM schema_migrations WHERE name = $1', [name]);
      await client.query('COMMIT');
      console.log(`  -> rolled back.`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  -> FAILED: ${err.message}`);
      throw err;
    } finally {
      client.release();
    }

    // Without a target, only roll back the single most recent migration.
    if (!targetName) break;
    if (targetName && name === targetName) break;
  }
}

async function status() {
  await ensureMigrationsTable();
  const all = listMigrationFiles();
  const applied = new Set(await getAppliedMigrations());
  for (const name of all) {
    console.log(`${applied.has(name) ? '[applied] ' : '[pending] '}${name}`);
  }
}

async function main() {
  const [, , cmd, arg] = process.argv;
  try {
    if (cmd === 'up') await up(arg);
    else if (cmd === 'down') await down(arg);
    else if (cmd === 'status') await status();
    else {
      console.log('Usage: node src/db/migrate.js <up|down|status> [migration-name-prefix]');
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

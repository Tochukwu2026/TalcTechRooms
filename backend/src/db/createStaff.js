#!/usr/bin/env node
/**
 * Creates (or updates the password of) a Staff user. Staff conduct Live/Video Viewings and get
 * a limited-permission view inside the Admin web dashboard (see spec/decisions-and-phasing.md >
 * Platform & Stack > Staff access) - not a mobile account type, and there is deliberately no
 * public self-registration endpoint, same reasoning and same pattern as createAdmin.js.
 *
 * Usage:
 *   node src/db/createStaff.js --email staff@talctechrooms.com --password "a-strong-password" --name "Staff Name"
 *   npm run create-staff -- --email staff@talctechrooms.com --password "a-strong-password" --name "Staff Name"
 *
 * Re-running with the same email updates that staff member's name/password rather than
 * erroring, so this also doubles as a "reset the staff password" tool.
 */
const { pool } = require('./pool');
const { hashPassword } = require('../modules/auth/passwords');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email;
  const password = args.password;
  const fullName = args.name || 'Staff';
  const phone = args.phone || null;

  if (!email || !password) {
    console.error('Usage: node src/db/createStaff.js --email <email> --password <password> [--name "Full Name"] [--phone <phone>]');
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);

  const { rows } = await pool.query(
    `INSERT INTO users (role, email, phone, password_hash, full_name)
     VALUES ('staff', $1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           full_name = EXCLUDED.full_name,
           role = 'staff'
     RETURNING id, email, full_name, role`,
    [email, phone, passwordHash, fullName]
  );

  console.log(`Staff ready: ${JSON.stringify(rows[0])}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
